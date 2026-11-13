import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { DatabaseService } from './database.service.js';
import { fail } from '../../common/http.js';
import { profileComplete } from '../../common/profile-completeness.js';
import { features } from '../policy.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { trustedClientIp } from '../client-ip.js';
import {
  normalizeAddContactRequest,
  normalizeForgotPasswordRequest,
  normalizeLinkIdentityRequest,
  normalizeLoginRequest,
  normalizeRefreshTokenRequest,
  normalizeResetPasswordRequest,
  normalizeVerifyEmailRequest,
  normalizeVerifyPhoneRequest,
} from '../registration.dto.js';
import type { Request } from 'express';
import { SessionApprovalService } from './session-approval.service.js';
import { OtpSecretStore } from './otp-secret-store.service.js';
import { EmailRegistrationProvider } from './email-registration.provider.js';
import { TextBeeSmsProvider, maskPhone } from './textbee-sms.provider.js';
export interface JwtIdentity {
  sub: string;
  sessionId: string;
  authProvider?: string;
  amr?: Array<{ method: string; timestamp?: number; provider?: string }>;
}
export interface AuthIdentity {
  provider: string;
  id: string;
  identity_data?: { sub?: string };
  last_sign_in_at?: string;
  updated_at?: string;
  created_at?: string;
}
interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  email_confirmed_at?: string;
  phone_confirmed_at?: string;
  identities?: AuthIdentity[];
}
interface ProviderSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
type ProviderLoginResult = ProviderSession | { unverified: true };
/** Values accepted by the public.auth_provider enum (001_enums.sql). */
const SUPPORTED_AUTH_PROVIDERS: readonly string[] = [
  'email',
  'phone',
  'google',
  'facebook',
];
const EXACT_OAUTH_AMR_MATCH_WINDOW_SEC = 5;

export function isPgUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code =
    'code' in error && typeof (error as { code: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  if (code === '23505') {
    return true;
  }
  if ('driverError' in error) {
    const driverError = (error as { driverError: unknown }).driverError;
    if (driverError && typeof driverError === 'object') {
      const driverCode =
        'code' in driverError &&
        typeof (driverError as { code: unknown }).code === 'string'
          ? (driverError as { code: string }).code
          : undefined;
      if (driverCode === '23505') {
        return true;
      }
    }
  }
  return false;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly oauthSessionProviders = new Map<string, string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly abuse: AuthAbuseControl,
    private readonly approvals: SessionApprovalService,
    @Optional() private readonly otpStore?: OtpSecretStore,
    @Optional() private readonly emailProvider?: EmailRegistrationProvider,
    @Optional() private readonly smsProvider?: TextBeeSmsProvider,
  ) {}

  private async authUser(authorization: string): Promise<AuthUser> {
    const response = await fetch(
      `${this.config.getOrThrow<string>('SUPABASE_URL').replace(/\/$/, '')}/auth/v1/user`,
      {
        headers: {
          Authorization: authorization,
          apikey: this.config.getOrThrow<string>('SUPABASE_ANON_KEY'),
        },
        signal: AbortSignal.timeout(10000),
      },
    ).catch(() =>
      fail(503, 'SERVICE_UNAVAILABLE', 'Auth service is unavailable'),
    );
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        fail(401, 'INVALID_TOKEN', 'Auth session is unavailable');
      fail(503, 'SERVICE_UNAVAILABLE', 'Auth service is unavailable');
    }
    return (await response.json()) as AuthUser;
  }

  private sessionIdentity(accessToken: string): JwtIdentity {
    try {
      const parts = accessToken.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT');
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf8'),
      ) as { sub?: unknown; session_id?: unknown; exp?: unknown };
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.session_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          payload.session_id,
        ) ||
        typeof payload.exp !== 'number' ||
        payload.exp <= Date.now() / 1000
      )
        throw new Error('Invalid JWT claims');
      return { sub: payload.sub, sessionId: payload.session_id };
    } catch {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Auth service returned an invalid session',
      );
    }
  }

  async login(body: unknown, request: Request) {
    const input = normalizeLoginRequest(body);
    const providerResult = await this.abuse.login<ProviderLoginResult>(
      { channel: input.channel, identifier: input.identifier },
      trustedClientIp(request),
      async () => {
        const response = await fetch(
          `${this.config.getOrThrow<string>('SUPABASE_URL').replace(/\/$/, '')}/auth/v1/token?grant_type=password`,
          {
            method: 'POST',
            headers: {
              apikey: this.config.getOrThrow<string>('SUPABASE_ANON_KEY'),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              [input.channel]: input.identifier,
              password: input.password,
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (response.status === 400 || response.status === 401) {
          const error = (await response.json().catch(() => null)) as {
            code?: unknown;
            error_code?: unknown;
          } | null;
          if (
            ['email_not_confirmed', 'phone_not_confirmed'].includes(
              String(error?.code),
            ) ||
            ['email_not_confirmed', 'phone_not_confirmed'].includes(
              String(error?.error_code),
            )
          )
            return {
              success: true as const,
              value: { unverified: true as const },
            };
          return { success: false as const };
        }
        if (!response.ok) throw new Error('Auth provider unavailable');
        return {
          success: true as const,
          value: (await response.json()) as ProviderSession,
        };
      },
    );
    if ('unverified' in providerResult)
      fail(403, 'UNVERIFIED_ACCOUNT', 'Verify the account before login');
    const providerSession = providerResult;
    const identity = this.sessionIdentity(providerSession.access_token);
    const user = await this.authUser(`Bearer ${providerSession.access_token}`);
    if (user.id !== identity.sub)
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Auth service returned an invalid session',
      );
    const result = await this.database.transaction(
      identity.sub,
      async (db) => {
        const [account] = await db.query(
          `SELECT u.verified_contact,p.verified_at,p.contact_value
             FROM public.users u
             LEFT JOIN public.user_auth_providers p
               ON p.user_id=u.id AND p.provider=$2::public.auth_provider
            WHERE u.id=$1`,
          [identity.sub, input.channel],
        );
        if (
          !account?.verified_contact ||
          !account.verified_at ||
          account.contact_value !== input.identifier
        )
          fail(403, 'UNVERIFIED_ACCOUNT', 'Verify the account before login');
        await this.approvals.approve(
          db,
          identity.sub,
          identity.sessionId,
          'password_login',
        );
        await db.query(
          'UPDATE public.users SET last_login_at=now() WHERE id=$1',
          [identity.sub],
        );
        return this.meInTransaction(db, identity.sub);
      },
      false,
      true,
    );
    return {
      access_token: providerSession.access_token,
      refresh_token: providerSession.refresh_token,
      expires_in: providerSession.expires_in,
      token_type: 'Bearer' as const,
      user: result.user,
      profile_complete: result.profile_complete,
      next_step: result.profile_complete
        ? ('app_home' as const)
        : ('profile_setup' as const),
    };
  }
  async bootstrap(
    identity: JwtIdentity,
    authorization: string,
    provider?: string,
  ) {
    // A live Auth lookup is required before provisioning. Never trust user metadata or JWT contacts.
    const user = await this.authUser(authorization);
    if (user.id !== identity.sub)
      fail(401, 'INVALID_TOKEN', 'Identity mismatch');
    const identities = (user.identities || []).filter((i) =>
      ['email', 'phone', 'google', 'facebook'].includes(i.provider),
    );
    const boundOAuthProvider = identity.sessionId
      ? this.oauthSessionProviders.get(identity.sessionId)
      : undefined;
    if (
      provider &&
      boundOAuthProvider &&
      boundOAuthProvider !== provider.toLowerCase()
    ) {
      fail(
        422,
        'PROVIDER_MISMATCH',
        'Requested OAuth provider does not match the bound session provider',
      );
    }
    let amr = identity.amr;
    let payload:
      | {
          amr?: unknown;
          email?: string;
          phone?: string;
          app_metadata?: { provider?: string; providers?: string[] };
        }
      | undefined;
    if (authorization?.startsWith('Bearer ')) {
      try {
        const parts = authorization.slice(7).split('.');
        if (parts.length === 3) {
          payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
          );
          if (!amr && Array.isArray(payload?.amr)) {
            amr = payload.amr as Array<{
              method: string;
              timestamp?: number;
              provider?: string;
            }>;
          }
        }
      } catch {
        // Ignore token parsing failure; amr remains undefined
      }
    }

    let activeProvider: string;
    let activeContact: string | null = null;
    let needsDbOAuthProviderCheck = false;

    if (provider) {
      if (!['google', 'facebook'].includes(provider))
        fail(422, 'PROVIDER_MISMATCH', 'Unsupported OAuth provider');
      if (!identities.some((i) => i.provider === provider))
        fail(
          422,
          'PROVIDER_MISMATCH',
          'Provider is not linked to this Auth identity',
        );

      const oauthAmrEntries = (amr || []).filter(
        (entry) => entry.method === 'oauth',
      );
      if (oauthAmrEntries.length === 0) {
        fail(
          422,
          'PROVIDER_MISMATCH',
          'Session was not authenticated via the requested OAuth provider',
        );
      }

      const explicitProviderEntries = oauthAmrEntries.filter(
        (entry) => typeof entry.provider === 'string' && entry.provider.trim(),
      );
      if (explicitProviderEntries.length > 0) {
        const matchesExplicit = explicitProviderEntries.some(
          (entry) => entry.provider?.toLowerCase() === provider.toLowerCase(),
        );
        if (!matchesExplicit) {
          fail(
            422,
            'PROVIDER_MISMATCH',
            'Session was not authenticated via the requested OAuth provider',
          );
        }
      } else {
        needsDbOAuthProviderCheck = true;
      }
      activeProvider = provider.toLowerCase();
      activeContact = user.email || null;
    } else {
      const oauthEntry = amr?.find((entry) => entry.method === 'oauth');
      if (oauthEntry) {
        const explicitOAuthProvider = oauthEntry.provider?.toLowerCase();
        if (boundOAuthProvider) {
          activeProvider = boundOAuthProvider;
          needsDbOAuthProviderCheck = true;
        } else if (explicitOAuthProvider) {
          if (!['google', 'facebook'].includes(explicitOAuthProvider)) {
            fail(
              422,
              'PROVIDER_MISMATCH',
              'OAuth session is ambiguous or missing an explicit provider in AMR',
            );
          }
          activeProvider = explicitOAuthProvider;
        } else {
          const metaProvider = payload?.app_metadata?.provider?.toLowerCase();
          if (metaProvider && ['google', 'facebook'].includes(metaProvider)) {
            activeProvider = metaProvider;
          } else {
            const oauthIdentities = identities.filter((i) =>
              ['google', 'facebook'].includes(i.provider),
            );
            activeProvider =
              oauthIdentities.length === 1 ? oauthIdentities[0].provider : '';
          }
          needsDbOAuthProviderCheck = true;
        }
        activeContact = user.email || payload?.email || null;
      } else if (amr?.some((entry) => entry.method === 'sms')) {
        activeProvider = 'phone';
        activeContact = user.phone || payload?.phone || null;
      } else if (amr?.some((entry) => entry.method === 'password')) {
        const phoneOnly = Boolean(user.phone && !user.email);
        activeProvider = phoneOnly ? 'phone' : 'email';
        activeContact = phoneOnly
          ? user.phone || null
          : user.email || payload?.email || null;
      } else if (amr?.some((entry) => entry.method === 'otp')) {
        if (user.phone || payload?.phone) {
          activeProvider = 'phone';
          activeContact = user.phone || payload?.phone || null;
        } else {
          activeProvider = 'email';
          activeContact = user.email || payload?.email || null;
        }
      } else if (payload?.app_metadata?.provider) {
        const metaProvider = payload.app_metadata.provider.toLowerCase();
        if (['google', 'facebook'].includes(metaProvider)) {
          needsDbOAuthProviderCheck = true;
        }
        activeProvider = metaProvider;
        activeContact =
          activeProvider === 'phone'
            ? user.phone || payload?.phone || null
            : user.email || payload?.email || null;
      } else if (user.phone && !user.email) {
        activeProvider = 'phone';
        activeContact = user.phone;
      } else {
        activeProvider = 'email';
        activeContact = user.email || payload?.email || null;
      }
    }

    const email = user.email_confirmed_at ? user.email || null : null;
    const phone = user.phone_confirmed_at
      ? user.phone?.startsWith('+')
        ? user.phone
        : `+${user.phone}`
      : null;
    if (provider && phone && !/^\+8801[3-9][0-9]{8}$/.test(phone))
      fail(
        422,
        'VALIDATION_FAILED',
        'Only Bangladesh mobile contacts are supported',
      );

    const incomingEmail = provider ? (email || '').trim().toLowerCase() : '';
    const incomingDigits = provider ? phone?.replace(/\D/g, '') || null : null;
    const txResult = await this.database
      .transaction(
        null,
        async (db) => {
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
            user.id,
          ]);
          const [authUserState] = await db.query(
            'SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1::uuid) AS auth_user_exists',
            [user.id],
          );
          if (authUserState?.auth_user_exists === false) {
            fail(401, 'INVALID_TOKEN', 'Invalid or expired token');
          }

          const oauthIdentities = needsDbOAuthProviderCheck
            ? await db.query(
                `SELECT provider,
                          last_sign_in_at,
                          updated_at,
                          created_at,
                          GREATEST(
                            COALESCE(last_sign_in_at, '-infinity'::timestamptz),
                            COALESCE(updated_at, '-infinity'::timestamptz),
                            COALESCE(created_at, '-infinity'::timestamptz)
                          ) AS max_activity_at
                     FROM auth.identities
                    WHERE user_id = $1::uuid`,
                [user.id],
              )
            : [];
          const emailCollisions = incomingEmail
            ? await db.query(
                `SELECT i.user_id
                     FROM auth.identities i
                     JOIN auth.users au ON au.id = i.user_id
                    WHERE LOWER(i.identity_data->>'email') = $1
                      AND au.email_confirmed_at IS NOT NULL
                      AND (
                        LOWER(au.email) = $1
                        OR LOWER(COALESCE(i.identity_data->>'email_verified', 'false')) = 'true'
                      )
                      AND i.user_id <> $2
                    LIMIT 1`,
                [incomingEmail, user.id],
              )
            : [];
          const phoneCollisions = incomingDigits
            ? await db.query(
                `SELECT i.user_id
                     FROM auth.identities i
                     JOIN auth.users au ON au.id = i.user_id
                    WHERE i.provider = 'phone'
                      AND (i.identity_data->>'phone' = $1 OR i.identity_data->>'phone' = $2)
                      AND au.phone_confirmed_at IS NOT NULL
                      AND i.user_id <> $3
                    LIMIT 1`,
                [`+${incomingDigits}`, incomingDigits, user.id],
              )
            : [];
          const privilegedReads = {
            oauthIdentities,
            emailCollisions,
            phoneCollisions,
          };

          await db.query('SET LOCAL ROLE service_role');

          if (needsDbOAuthProviderCheck) {
            const dbOAuthRows = (
              Array.isArray(privilegedReads.oauthIdentities)
                ? privilegedReads.oauthIdentities
                : []
            ).filter(
              (row: { provider?: string }) =>
                row?.provider && ['google', 'facebook'].includes(row.provider),
            );
            const candidateOAuth = (
              dbOAuthRows.length > 0 ? dbOAuthRows : identities
            ).filter((i: { provider: string }) =>
              ['google', 'facebook'].includes(i.provider),
            );

            const toEpochSec = (val?: string | Date | null): number => {
              if (!val) return -Infinity;
              const ms =
                val instanceof Date ? val.getTime() : Date.parse(String(val));
              return Number.isNaN(ms) ? -Infinity : Math.floor(ms / 1000);
            };

            const getIdentityActivitySec = (row: unknown): number => {
              if (!row || typeof row !== 'object') return -Infinity;
              const r = row as {
                max_activity_at?: unknown;
                last_sign_in_at?: unknown;
                updated_at?: unknown;
                created_at?: unknown;
              };
              if (
                typeof r.max_activity_at === 'string' ||
                r.max_activity_at instanceof Date
              ) {
                const sec = toEpochSec(r.max_activity_at);
                if (sec !== -Infinity) return sec;
              }
              const lastSignIn =
                typeof r.last_sign_in_at === 'string' ||
                r.last_sign_in_at instanceof Date
                  ? r.last_sign_in_at
                  : null;
              const updated =
                typeof r.updated_at === 'string' || r.updated_at instanceof Date
                  ? r.updated_at
                  : null;
              const created =
                typeof r.created_at === 'string' || r.created_at instanceof Date
                  ? r.created_at
                  : null;
              return Math.max(
                toEpochSec(lastSignIn),
                toEpochSec(updated),
                toEpochSec(created),
              );
            };

            const getIdentityEvidenceSecs = (row: unknown): number[] => {
              if (!row || typeof row !== 'object') return [];
              const value = row as {
                max_activity_at?: unknown;
                last_sign_in_at?: unknown;
                updated_at?: unknown;
                created_at?: unknown;
              };
              return [
                value.last_sign_in_at,
                value.updated_at,
                value.created_at,
                value.max_activity_at,
              ]
                .map((timestamp) =>
                  typeof timestamp === 'string' || timestamp instanceof Date
                    ? toEpochSec(timestamp)
                    : -Infinity,
                )
                .filter((timestamp) => timestamp !== -Infinity);
            };

            if (provider) {
              if (
                !candidateOAuth.some(
                  (i: { provider: string }) => i.provider === activeProvider,
                )
              ) {
                fail(
                  422,
                  'PROVIDER_MISMATCH',
                  'Session was not authenticated via the requested OAuth provider',
                );
              }

              if (candidateOAuth.length > 1) {
                const oauthAmrEntry = (amr || []).find(
                  (entry) => entry.method === 'oauth',
                );
                const amrOAuthTimestampSec =
                  typeof oauthAmrEntry?.timestamp === 'number'
                    ? oauthAmrEntry.timestamp > 1e11
                      ? Math.floor(oauthAmrEntry.timestamp / 1000)
                      : oauthAmrEntry.timestamp
                    : undefined;

                const hasInlineProvider = Boolean(oauthAmrEntry?.provider);
                const sessionBoundToRequested =
                  boundOAuthProvider === activeProvider;
                if (!hasInlineProvider && !sessionBoundToRequested) {
                  const requestedRow = candidateOAuth.find(
                    (i: { provider: string }) => i.provider === activeProvider,
                  );
                  const requestedHasExactEvidence =
                    typeof amrOAuthTimestampSec === 'number' && requestedRow
                      ? getIdentityEvidenceSecs(requestedRow).some(
                          (timestamp) =>
                            Math.abs(timestamp - amrOAuthTimestampSec) <=
                            EXACT_OAUTH_AMR_MATCH_WINDOW_SEC,
                        )
                      : false;
                  if (!requestedHasExactEvidence) {
                    fail(
                      422,
                      'PROVIDER_MISMATCH',
                      'Requested OAuth provider does not match session authentication evidence',
                    );
                  }
                }
              }
            } else {
              if (candidateOAuth.length === 0) {
                fail(
                  422,
                  'PROVIDER_MISMATCH',
                  'Session was not authenticated via the requested OAuth provider',
                );
              }

              if (boundOAuthProvider) {
                if (
                  !candidateOAuth.some(
                    (row: { provider: string }) =>
                      row.provider === boundOAuthProvider,
                  )
                ) {
                  fail(
                    422,
                    'PROVIDER_MISMATCH',
                    'Bound session provider is no longer linked',
                  );
                }
                activeProvider = boundOAuthProvider;
              } else if (candidateOAuth.length === 1) {
                activeProvider = candidateOAuth[0].provider;
              } else {
                const verifiedAuthRows = await db.query(
                  `SELECT provider, contact_value
                     FROM public.user_auth_providers
                    WHERE user_id = $1 AND verified_at IS NOT NULL`,
                  [user.id],
                );
                const verifiedProviderMap = new Map(
                  (Array.isArray(verifiedAuthRows) ? verifiedAuthRows : []).map(
                    (r: { provider: string; contact_value: string }) => [
                      r.provider,
                      r.contact_value,
                    ],
                  ),
                );
                const oauthAmrEntry = (amr || []).find(
                  (entry) => entry.method === 'oauth',
                );
                const amrOAuthTimestampSec =
                  typeof oauthAmrEntry?.timestamp === 'number'
                    ? oauthAmrEntry.timestamp > 1e11
                      ? Math.floor(oauthAmrEntry.timestamp / 1000)
                      : oauthAmrEntry.timestamp
                    : undefined;

                let selectedProvider: string | null = null;

                if (typeof amrOAuthTimestampSec === 'number') {
                  const matchingRows = candidateOAuth
                    .map((row) => ({
                      provider: row.provider,
                      verified: verifiedProviderMap.has(row.provider),
                      diff: Math.min(
                        ...getIdentityEvidenceSecs(row).map((timestamp) =>
                          Math.abs(timestamp - amrOAuthTimestampSec),
                        ),
                      ),
                    }))
                    .filter(
                      (item) => item.diff <= EXACT_OAUTH_AMR_MATCH_WINDOW_SEC,
                    )
                    .sort(
                      (a, b) =>
                        a.diff - b.diff ||
                        Number(b.verified) - Number(a.verified) ||
                        Number(b.provider === activeProvider) -
                          Number(a.provider === activeProvider),
                    );

                  if (matchingRows.length > 0) {
                    selectedProvider = matchingRows[0].provider;
                  }
                }

                if (!selectedProvider) {
                  const sortedCandidates = [...candidateOAuth].sort((a, b) => {
                    const aVerified = verifiedProviderMap.has(a.provider)
                      ? 1
                      : 0;
                    const bVerified = verifiedProviderMap.has(b.provider)
                      ? 1
                      : 0;
                    if (bVerified !== aVerified) return bVerified - aVerified;

                    const activityDifference =
                      getIdentityActivitySec(b) - getIdentityActivitySec(a);
                    if (activityDifference !== 0) return activityDifference;

                    if (activeContact) {
                      const aMatch =
                        verifiedProviderMap.get(a.provider)?.toLowerCase() ===
                        activeContact.toLowerCase()
                          ? 1
                          : 0;
                      const bMatch =
                        verifiedProviderMap.get(b.provider)?.toLowerCase() ===
                        activeContact.toLowerCase()
                          ? 1
                          : 0;
                      if (bMatch !== aMatch) return bMatch - aMatch;
                    }

                    return (
                      Number(b.provider === activeProvider) -
                      Number(a.provider === activeProvider)
                    );
                  });

                  selectedProvider = sortedCandidates[0].provider;
                }

                activeProvider = selectedProvider || '';
              }

              if (
                !activeProvider ||
                !['google', 'facebook'].includes(activeProvider) ||
                !candidateOAuth.some(
                  (i: { provider: string }) => i.provider === activeProvider,
                )
              ) {
                fail(
                  422,
                  'PROVIDER_MISMATCH',
                  'Session was not authenticated via the requested OAuth provider',
                );
              }
            }
          }
          if (!provider) {
            if (!SUPPORTED_AUTH_PROVIDERS.includes(activeProvider)) {
              fail(
                403,
                'UNVERIFIED_ACCOUNT',
                'Application account verification is incomplete',
              );
            }
            const lookupContact =
              activeProvider === 'phone' && activeContact
                ? activeContact.startsWith('+')
                  ? activeContact
                  : `+${activeContact}`
                : activeContact;
            if (!lookupContact) {
              fail(
                403,
                'UNVERIFIED_ACCOUNT',
                'Application account verification is incomplete',
              );
            }
            const isOAuthSync = ['google', 'facebook'].includes(activeProvider);
            const oauthSubject = isOAuthSync
              ? String(
                  identities.find(
                    (i: { provider: string }) => i.provider === activeProvider,
                  )?.identity_data?.sub || '',
                ).trim()
              : '';
            const [existing] = isOAuthSync
              ? await db.query(
                  `SELECT u.verified_contact, p.verified_at
                     FROM public.users u
                     JOIN public.user_auth_providers p
                       ON p.user_id = u.id AND p.provider = $2 AND p.verified_at IS NOT NULL
                    WHERE u.id = $1
                      AND ($3 = '' OR p.provider_subject = $3)`,
                  [user.id, activeProvider, oauthSubject],
                )
              : await db.query(
                  `SELECT u.verified_contact, p.verified_at
                     FROM public.users u
                     JOIN public.user_auth_providers p
                       ON p.user_id = u.id AND p.provider = $2 AND p.verified_at IS NOT NULL
                    WHERE u.id = $1
                      AND LOWER(p.contact_value) = LOWER($3)`,
                  [user.id, activeProvider, lookupContact],
                );
            if (!existing?.verified_contact || !existing?.verified_at) {
              fail(
                403,
                'UNVERIFIED_ACCOUNT',
                'Application account verification is incomplete',
              );
            }
            return this.meInTransaction(db, user.id);
          }
          const [pendingEmail] = await db.query(
            `SELECT 1 FROM public.user_auth_providers
              WHERE user_id=$1 AND provider='email' AND verified_at IS NULL`,
            [user.id],
          );
          if (pendingEmail)
            fail(
              403,
              'UNVERIFIED_ACCOUNT',
              'Pending email registration must complete through verification',
            );

          const verifiedContactMappings = await db.query(
            `SELECT provider, contact_value
               FROM public.user_auth_providers
              WHERE user_id = $1
                AND provider IN ('email', 'phone', 'google', 'facebook')
                AND verified_at IS NOT NULL
              FOR UPDATE`,
            [user.id],
          );
          for (const mapping of Array.isArray(verifiedContactMappings)
            ? verifiedContactMappings
            : []) {
            const contactValue = String(mapping.contact_value || '');
            if (
              mapping.provider === 'email' &&
              contactValue &&
              email &&
              contactValue.toLowerCase() !== email.toLowerCase()
            ) {
              fail(
                409,
                'IDENTITY_LINK_CONFLICT',
                'Account already has a different verified email mapped',
              );
            }
            if (
              mapping.provider === 'phone' &&
              contactValue &&
              phone &&
              contactValue.replace(/\D/g, '') !== phone.replace(/\D/g, '')
            ) {
              fail(
                409,
                'PHONE_CONFLICT',
                'Account already has a different verified phone mapped',
              );
            }
          }

          // Pre-flight check: ensure none of the incoming identities belong to another user account
          for (const i of identities) {
            const subject = (i.identity_data?.sub || i.id || '').trim();
            if (subject) {
              const [conflict] = await db.query(
                `SELECT user_id FROM public.user_auth_providers
                  WHERE provider = $1::public.auth_provider
                    AND provider_subject = $2
                    AND user_id <> $3
                  LIMIT 1`,
                [i.provider, subject, user.id],
              );
              if (conflict) {
                fail(
                  409,
                  'IDENTITY_LINK_CONFLICT',
                  'Identity belongs to another application account',
                );
              }
            }
          }

          // Reject cross-user email collision: a verified account or verified provider mapping with this email
          // already exists under a different user ID (in public.users, public.user_auth_providers, or auth.identities).
          const [existingPublicEmailCollision] = incomingEmail
            ? await db.query(
                `SELECT user_id FROM (
                   SELECT u.id AS user_id
                     FROM public.users u
                    WHERE LOWER(u.email) = $1
                      AND u.id <> $2
                      AND EXISTS (
                        SELECT 1 FROM public.user_auth_providers p
                         WHERE p.user_id = u.id
                           AND p.provider = 'email'
                           AND LOWER(p.contact_value) = $1
                           AND p.verified_at IS NOT NULL
                      )
                   UNION
                   SELECT user_id FROM public.user_auth_providers WHERE provider = 'email' AND LOWER(contact_value) = $1 AND verified_at IS NOT NULL AND user_id <> $2
                 ) AS email_collisions LIMIT 1`,
                [incomingEmail, user.id],
              )
            : [null];

          let existingEmailCollision = existingPublicEmailCollision;
          if (!existingEmailCollision && incomingEmail) {
            const [authEmailCollision] = Array.isArray(
              privilegedReads.emailCollisions,
            )
              ? privilegedReads.emailCollisions
              : [];
            if (authEmailCollision) {
              existingEmailCollision = authEmailCollision;
            }
          }

          const [existingUserRow] = await db.query(
            `SELECT id, phone FROM public.users WHERE id = $1`,
            [user.id],
          );

          if (existingEmailCollision) {
            return {
              __emailCollision: true as const,
              shouldCleanup: !existingUserRow,
              activeProvider,
            };
          }

          const normalizePhone = (
            p: string | null | undefined,
          ): string | null => {
            if (!p) return null;
            const digits = p.replace(/\D/g, '');
            return digits || null;
          };

          if (incomingDigits) {
            const phoneE164 = `+${incomingDigits}`;
            const [crossUserPhone] = await db.query(
              `SELECT user_id FROM (
                  SELECT u.id AS user_id FROM public.users u
                   WHERE (u.phone = $1 OR u.phone = $2)
                     AND u.id <> $3
                     AND EXISTS (
                       SELECT 1 FROM public.user_auth_providers p
                        WHERE p.user_id = u.id
                          AND p.provider = 'phone'
                          AND (p.contact_value = $1 OR p.contact_value = $2)
                          AND p.verified_at IS NOT NULL
                     )
                 UNION
                 SELECT user_id FROM public.user_auth_providers
                  WHERE provider = 'phone'
                    AND (contact_value = $1 OR contact_value = $2)
                    AND verified_at IS NOT NULL
                    AND user_id <> $3
               ) AS phone_collisions LIMIT 1`,
              [phoneE164, incomingDigits, user.id],
            );
            if (crossUserPhone) {
              fail(
                409,
                'PHONE_CONFLICT',
                'Phone number is already associated with another account',
              );
            }

            const [authPhoneCollision] = Array.isArray(
              privilegedReads.phoneCollisions,
            )
              ? privilegedReads.phoneCollisions
              : [];
            if (authPhoneCollision) {
              fail(
                409,
                'PHONE_CONFLICT',
                'Phone number is already associated with another account',
              );
            }
          }

          if (phone && existingUserRow?.phone) {
            if (
              normalizePhone(existingUserRow.phone) !== normalizePhone(phone)
            ) {
              fail(
                409,
                'PHONE_CONFLICT',
                'Account already has a different phone number associated',
              );
            }
          }

          if (email) {
            await db.query(
              `UPDATE public.users SET email = NULL WHERE LOWER(email) = $1 AND verified_contact = false AND id <> $2`,
              [email.trim().toLowerCase(), user.id],
            );
            await db.query(
              `DELETE FROM public.user_auth_providers WHERE (LOWER(contact_value) = $1 OR LOWER(provider_subject) = $1) AND verified_at IS NULL AND user_id <> $2`,
              [email.trim().toLowerCase(), user.id],
            );
          }
          if (incomingDigits) {
            await db.query(
              `UPDATE public.users SET phone = NULL WHERE (phone = $1 OR phone = $2) AND verified_contact = false AND id <> $3`,
              [`+${incomingDigits}`, incomingDigits, user.id],
            );
            await db.query(
              `DELETE FROM public.user_auth_providers WHERE (contact_value IN ($1, $2) OR provider_subject IN ($1, $2)) AND verified_at IS NULL AND user_id <> $3`,
              [`+${incomingDigits}`, incomingDigits, user.id],
            );
          }

          await db.query(
            `INSERT INTO public.users(id,email,phone,verified_contact,last_active_at,last_login_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())
        ON CONFLICT(id) DO UPDATE SET
          email=CASE
            WHEN public.users.verified_contact AND public.users.email IS NOT NULL THEN public.users.email
            ELSE COALESCE(EXCLUDED.email, public.users.email)
          END,
          phone=CASE
            WHEN public.users.verified_contact AND public.users.phone IS NOT NULL THEN public.users.phone
            ELSE COALESCE(EXCLUDED.phone, public.users.phone)
          END,
          verified_contact=public.users.verified_contact OR EXCLUDED.verified_contact`,
            [user.id, email, phone, !!(email || phone)],
          );

          for (const i of identities) {
            const isPhone = i.provider === 'phone';
            const isEmail = i.provider === 'email';
            const contactVal = isPhone ? phone : email;
            const verifiedAt =
              (isPhone ? user.phone_confirmed_at : user.email_confirmed_at) ||
              null;
            const subject = (i.identity_data?.sub || i.id || '').trim();

            const [existingMapping] = await db.query(
              `SELECT contact_value, provider_subject, verified_at FROM public.user_auth_providers WHERE user_id = $1 AND provider = $2`,
              [user.id, i.provider],
            );

            if (existingMapping && existingMapping.verified_at) {
              if (isPhone && existingMapping.contact_value && phone) {
                if (
                  normalizePhone(existingMapping.contact_value) !==
                  normalizePhone(phone)
                ) {
                  fail(
                    409,
                    'PHONE_CONFLICT',
                    'Account already has a different phone number mapped',
                  );
                }
              }
              if (isEmail && existingMapping.contact_value && email) {
                if (
                  existingMapping.contact_value.toLowerCase() !==
                  email.toLowerCase()
                ) {
                  fail(
                    409,
                    'IDENTITY_LINK_CONFLICT',
                    'Account already has a different email mapped',
                  );
                }
              }
              const phoneContactMatched =
                isPhone &&
                Boolean(
                  (existingMapping.contact_value &&
                    phone &&
                    normalizePhone(existingMapping.contact_value) ===
                      normalizePhone(phone)) ||
                  existingMapping.provider_subject === user.id ||
                  subject === user.id ||
                  (existingMapping.contact_value &&
                    subject &&
                    normalizePhone(existingMapping.contact_value) ===
                      normalizePhone(subject)) ||
                  (phone &&
                    existingMapping.provider_subject &&
                    normalizePhone(phone) ===
                      normalizePhone(existingMapping.provider_subject)),
                );

              const emailContactMatched =
                isEmail &&
                Boolean(
                  (existingMapping.contact_value &&
                    email &&
                    existingMapping.contact_value.toLowerCase() ===
                      email.toLowerCase()) ||
                  (existingMapping.contact_value &&
                    subject &&
                    existingMapping.contact_value.toLowerCase() ===
                      subject.toLowerCase()) ||
                  (email &&
                    existingMapping.provider_subject &&
                    email.toLowerCase() ===
                      existingMapping.provider_subject.toLowerCase()) ||
                  (existingMapping.provider_subject === user.id &&
                    (!existingMapping.contact_value ||
                      !email ||
                      existingMapping.contact_value.toLowerCase() ===
                        email.toLowerCase())) ||
                  (subject === user.id &&
                    (!existingMapping.contact_value ||
                      !email ||
                      existingMapping.contact_value.toLowerCase() ===
                        email.toLowerCase())),
                );

              const firstPartyMatched = isEmail
                ? emailContactMatched
                : isPhone
                  ? phoneContactMatched
                  : false;

              if (
                !firstPartyMatched &&
                existingMapping.provider_subject &&
                subject &&
                existingMapping.provider_subject !== subject
              ) {
                fail(
                  409,
                  'IDENTITY_LINK_CONFLICT',
                  'Account already has a different identity mapped for this provider',
                );
              }
            }

            await db.query(
              `INSERT INTO public.user_auth_providers(user_id,provider,provider_subject,contact_value,verified_at,is_primary)
          VALUES($1,$2,$3,$4,$5,NOT EXISTS(SELECT 1 FROM public.user_auth_providers WHERE user_id=$1))
          ON CONFLICT(user_id,provider) DO UPDATE SET
            provider_subject=EXCLUDED.provider_subject,
            contact_value=CASE
              WHEN public.user_auth_providers.verified_at IS NOT NULL
               AND public.user_auth_providers.contact_value IS NOT NULL
              THEN public.user_auth_providers.contact_value
              ELSE COALESCE(EXCLUDED.contact_value, public.user_auth_providers.contact_value)
            END,
            verified_at=COALESCE(public.user_auth_providers.verified_at, EXCLUDED.verified_at),
            updated_at=clock_timestamp()`,
              [user.id, i.provider, subject, contactVal, verifiedAt],
            );
          }
          await db.query(
            'INSERT INTO public.user_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
            [user.id],
          );
          await db.query(
            'INSERT INTO public.user_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
            [user.id],
          );
          const result = await this.meInTransaction(db, user.id);
          if (result.user.verified_contact && identity.sessionId && provider) {
            await this.approvals.approve(
              db,
              user.id,
              identity.sessionId,
              'oauth',
            );
            await db.query(
              'UPDATE public.users SET last_login_at=clock_timestamp() WHERE id=$1',
              [user.id],
            );
          }
          return result;
        },
        false,
        false,
        false,
      )
      .catch((error: unknown) => {
        if (isPgUniqueViolation(error)) {
          fail(
            409,
            'IDENTITY_LINK_CONFLICT',
            'Identity belongs to another application account',
          );
        }
        throw error;
      });
    if (
      txResult &&
      typeof txResult === 'object' &&
      '__emailCollision' in txResult
    ) {
      const collision = txResult as {
        __emailCollision: true;
        shouldCleanup: boolean;
        activeProvider: string;
      };
      if (collision.shouldCleanup) {
        await this.database
          .transaction(
            null,
            async (privDb) => {
              await privDb.query(
                'SELECT pg_advisory_xact_lock(hashtext($1::text))',
                [user.id],
              );
              await privDb.query(
                'SELECT id FROM auth.users WHERE id = $1 FOR UPDATE',
                [user.id],
              );
              const appCheck = await privDb.query(
                'SELECT 1 FROM public.users WHERE id = $1 LIMIT 1',
                [user.id],
              );
              if (Array.isArray(appCheck) && appCheck.length > 0) return;
              await privDb.query(
                `DELETE FROM auth.identities
                  WHERE user_id = $1::uuid
                    AND provider = $2
                    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = $1::uuid)`,
                [user.id, collision.activeProvider],
              );
              await privDb.query(
                `DELETE FROM auth.sessions
                  WHERE user_id = $1::uuid
                    AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = $1::uuid)`,
                [user.id],
              );
              await privDb.query(
                `DELETE FROM auth.users
                WHERE id = $1::uuid
                  AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = $1::uuid)
                  AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $1::uuid)
                RETURNING id`,
                [user.id],
              );
            },
            false,
            false,
            false,
          )
          .catch((cleanupErr: unknown) => {
            this.logger.error(
              `Failed to clean up colliding OAuth Auth user ${user.id}`,
              cleanupErr instanceof Error
                ? cleanupErr.stack
                : String(cleanupErr),
            );
          });
      }
      fail(
        409,
        'ACCOUNT_EXISTS',
        'An account with this email already exists. Please sign in with your original account to link this provider.',
      );
    }
    if (identity.sessionId && ['google', 'facebook'].includes(activeProvider)) {
      this.oauthSessionProviders.set(identity.sessionId, activeProvider);
    }
    return txResult;
  }
  async me(id: string) {
    return this.database
      .transaction(id, (db) => this.meInTransaction(db, id), false)
      .catch((error: unknown) => {
        if (isPgUniqueViolation(error)) {
          fail(
            409,
            'IDENTITY_LINK_CONFLICT',
            'Identity belongs to another application account',
          );
        }
        throw error;
      });
  }
  async meInTransaction(db: EntityManager, id: string) {
    const [user] = await db.query(
      `SELECT u.id,u.email,u.phone,u.status,u.verified_contact,
      CASE WHEN EXISTS(SELECT 1 FROM public.admin_users a WHERE a.user_id=u.id AND a.role='platform_admin') THEN 'ADMIN' ELSE 'USER' END AS role,
      ARRAY(SELECT provider::text FROM public.user_auth_providers WHERE user_id=u.id ORDER BY provider) AS linked_providers FROM public.users u WHERE u.id=$1`,
      [id],
    );
    if (!user)
      fail(
        401,
        'AUTH_REQUIRED',
        'Application account not found; bootstrap a verified Auth session first',
      );
    const [p] = await db.query(
      `SELECT p.*,pr.learning_preference,EXISTS(SELECT 1 FROM public.career_goals g WHERE g.user_id=p.user_id AND g.status='confirmed') AS has_confirmed_goal FROM public.user_profiles p LEFT JOIN public.user_preferences pr USING(user_id) WHERE p.user_id=$1`,
      [id],
    );
    const effective_access: Record<string, boolean> = {};
    for (const f of features) {
      const [row] = await db.query(
        'SELECT private.effective_feature_access($1,$2::public.feature_key) AS enabled',
        [id, f],
      );
      effective_access[f] = !!row.enabled;
    }
    const [focus] = await db.query(
      'SELECT id FROM public.roadmaps WHERE user_id=$1 AND is_focus=true LIMIT 1',
      [id],
    );
    return {
      user,
      profile_complete: !!p && profileComplete(p, !!p.has_confirmed_goal),
      focus_roadmap_id: focus?.id || null,
      effective_access,
      can_delete_account: true,
    };
  }

  /**
   * EP-A02: Unified verification endpoint for either email or phone OTP challenge.
   */
  async verifyOtp(body: unknown, request?: Request) {
    if (!body || typeof body !== 'object') {
      fail(422, 'VALIDATION_FAILED', 'Invalid request', [
        {
          field: 'body',
          code: 'VALIDATION_FAILED',
          message: 'Expected an object',
        },
      ]);
    }
    const b = body as Record<string, unknown>;
    const channel =
      b.channel === 'phone' || (typeof b.phone === 'string' && !b.email)
        ? 'phone'
        : 'email';
    if (channel === 'phone') {
      const phone = (b.phone || b.identifier) as string;
      return this.verifyPhone({ phone, code: b.code }, request);
    }
    const email = (b.email || b.identifier) as string;
    return this.verifyEmail({ email, code: b.code }, request);
  }

  /**
   * EP-A02: Verifies an email OTP challenge (registration or EP-A12 secondary contact), updates the application account, and mints an approved session.
   */
  async verifyEmail(body: unknown, _request?: Request) {
    void _request;
    const input = normalizeVerifyEmailRequest(body);
    const email = input.email;
    const code = input.code;

    const [user] = await this.database.query(
      `SELECT u.id, u.email, u.verified_contact, p.provider_subject, p.verified_at
         FROM public.users u
         JOIN public.user_auth_providers p
           ON p.user_id = u.id AND p.provider = 'email'
        WHERE lower(p.contact_value) = $1 OR lower(COALESCE(u.email, '')) = $1
        LIMIT 1`,
      [email],
    );

    if (!user) {
      fail(410, 'VERIFICATION_CODE_EXPIRED', 'Verification challenge expired');
    }

    if (user.verified_contact === true || user.verified_at !== null) {
      fail(409, 'ALREADY_VERIFIED', 'Contact already verified');
    }

    const userId = user.id;

    if (!this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }

    let committed = false;
    let goTrueConfirmed = false;
    try {
      await this.otpStore.verifyAndConsumeOtp(userId, email, code, async () => {
        await this.database.transaction(
          userId,
          async (db) => {
            await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
              userId,
            ]);
            const [userRow] = await db.query(
              'SELECT id, status, email, verified_contact FROM public.users WHERE id = $1 FOR UPDATE',
              [userId],
            );
            if (!userRow || userRow.status !== 'active') {
              fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
            }
            if (userRow.verified_contact) {
              fail(409, 'ALREADY_VERIFIED', 'Contact already verified');
            }

            const [providerRow] = await db.query(
              `SELECT id, contact_value, provider_subject, verified_at
                 FROM public.user_auth_providers
                WHERE user_id = $1
                  AND provider = 'email'
                  AND (lower(contact_value) = $2 OR lower(provider_subject) = $2)
                FOR UPDATE`,
              [userId, email],
            );
            if (!providerRow || providerRow.verified_at !== null) {
              fail(409, 'ALREADY_VERIFIED', 'Contact already verified');
            }

            const usersRes = await db.query(
              `UPDATE public.users
                  SET email = $1, verified_contact = true, last_login_at = now(), last_active_at = now(), updated_at = now()
                WHERE id = $2 AND verified_contact = false`,
              [email, userId],
            );
            const usersAffected =
              Array.isArray(usersRes) && typeof usersRes[1] === 'number'
                ? usersRes[1]
                : (usersRes?.rowCount ?? 0);

            const providersRes = await db.query(
              `UPDATE public.user_auth_providers
                  SET verified_at = now(), updated_at = now()
                WHERE user_id = $1 AND provider = 'email' AND (lower(contact_value) = $2 OR lower(provider_subject) = $2) AND verified_at IS NULL`,
              [userId, email],
            );
            const providersAffected =
              Array.isArray(providersRes) && typeof providersRes[1] === 'number'
                ? providersRes[1]
                : (providersRes?.rowCount ?? 0);

            if (usersAffected !== 1 || providersAffected !== 1) {
              fail(409, 'ALREADY_VERIFIED', 'Account is already verified');
            }

            await db.query(
              'INSERT INTO public.user_profiles(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',
              [userId],
            );
            await db.query(
              'INSERT INTO public.user_preferences(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',
              [userId],
            );

            await this.confirmGoTrueUser(userId, email);
            goTrueConfirmed = true;
          },
          true,
        );
        committed = true;
      });
    } catch (error) {
      if (!committed && goTrueConfirmed) {
        this.logger.error(
          `Post-confirmation DB commit failed for user ${userId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
      if (isPgUniqueViolation(error)) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
      if (!committed) {
        throw error;
      }
      this.logger.error(
        `OTP consumption failed after email verification commit for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      return await this.mintAndApproveSession(userId, email);
    } catch (error) {
      if (error instanceof HttpException) {
        const resp = error.getResponse();
        const respObj =
          typeof resp === 'object' && resp !== null
            ? (resp as Record<string, unknown>)
            : null;
        const status = error.getStatus();
        const code =
          (typeof respObj?.code === 'string' ? respObj.code : undefined) ||
          'SESSION_MINT_FAILED';
        fail(
          status,
          code,
          'Account is verified; sign in with your email and password to start your session',
          Array.isArray(respObj?.details) ? respObj.details : [],
          false,
        );
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Account is verified; sign in with your email and password to start your session',
        [],
        false,
      );
    }
  }

  /**
   * Masks email address for C05 RegistrationPendingDTO display.
   */
  private maskEmailContact(email: string): string {
    const at = email.lastIndexOf('@');
    return `${email[0]}****${email.slice(at)}`;
  }

  /**
   * EP-A11: Links an authenticated Google or Facebook OAuth identity to an existing verified account.
   */
  async linkIdentity(
    identity: JwtIdentity,
    authorization: string | undefined,
    body: unknown,
  ) {
    if (!identity?.sub || !identity?.sessionId || !authorization) {
      fail(401, 'AUTH_REQUIRED', 'A valid Auth session is required');
    }
    const input = normalizeLinkIdentityRequest(body);
    const provider = input.provider;

    const user = await this.authUser(authorization);
    if (user.id !== identity.sub) {
      fail(401, 'INVALID_TOKEN', 'Identity mismatch');
    }

    const matchedIdentity = (user.identities || []).find(
      (i) => i.provider === provider,
    );
    if (!matchedIdentity) {
      fail(
        422,
        'PROVIDER_MISMATCH',
        'Provider is not linked to this Auth identity',
      );
    }

    const providerSubject = (
      matchedIdentity.identity_data?.sub ||
      matchedIdentity.id ||
      ''
    ).trim();
    if (!providerSubject) {
      fail(
        422,
        'PROVIDER_MISMATCH',
        'Provider identity subject is missing or invalid',
      );
    }

    const confirmedEmail = user.email_confirmed_at
      ? user.email?.trim().toLowerCase() || null
      : null;

    return this.database
      .transaction(
        identity.sub,
        async (db) => {
          const [account] = await db.query(
            'SELECT verified_contact FROM public.users WHERE id = $1 FOR UPDATE',
            [identity.sub],
          );
          if (!account) {
            fail(401, 'AUTH_REQUIRED', 'Application account not found');
          }
          if (!account.verified_contact) {
            fail(
              403,
              'VERIFIED_CONTACT_REQUIRED',
              'A verified contact is required before linking a social identity',
            );
          }

          const [conflict] = await db.query(
            `SELECT user_id
               FROM public.user_auth_providers
              WHERE provider = $1::public.auth_provider
                AND provider_subject = $2
                AND user_id <> $3
              LIMIT 1`,
            [provider, providerSubject, identity.sub],
          );
          if (conflict) {
            fail(
              409,
              'IDENTITY_LINK_CONFLICT',
              'Identity belongs to another application account',
            );
          }

          await db.query(
            `INSERT INTO public.user_auth_providers
               (user_id, provider, provider_subject, contact_value, verified_at, is_primary)
             VALUES ($1, $2::public.auth_provider, $3, $4, $5, false)
             ON CONFLICT (user_id, provider) DO UPDATE
               SET provider_subject = EXCLUDED.provider_subject,
                   contact_value = COALESCE(EXCLUDED.contact_value, public.user_auth_providers.contact_value),
                   verified_at = COALESCE(EXCLUDED.verified_at, public.user_auth_providers.verified_at),
                   updated_at = now()`,
            [
              identity.sub,
              provider,
              providerSubject,
              confirmedEmail,
              user.email_confirmed_at || null,
            ],
          );

          const [row] = await db.query(
            `SELECT ARRAY(
               SELECT provider::text
                 FROM public.user_auth_providers
                WHERE user_id = $1
                ORDER BY provider
             ) AS linked_providers`,
            [identity.sub],
          );
          return {
            linked_providers: (row?.linked_providers ?? [provider]) as string[],
          };
        },
        true,
        true,
      )
      .catch((error: unknown) => {
        if (isPgUniqueViolation(error)) {
          fail(
            409,
            'IDENTITY_LINK_CONFLICT',
            'Identity belongs to another application account',
          );
        }
        throw error;
      });
  }

  /**
   * EP-A12: Adds and initiates verification for a supported contact on an authenticated account.
   */
  async addContact(
    identity: JwtIdentity,
    authorization: string | undefined,
    body: unknown,
    request?: Request,
  ) {
    if (!identity?.sub || !identity?.sessionId || !authorization) {
      fail(401, 'AUTH_REQUIRED', 'A valid Auth session is required');
    }
    const input = normalizeAddContactRequest(body);
    const channel = input.channel;
    const identifier = input.identifier;

    if (channel === 'phone') {
      if (!this.smsProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Phone contact verification is temporarily unavailable',
          [],
          true,
          5,
        );
      }
      this.smsProvider.ready();
    } else {
      if (!this.emailProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Email verification is temporarily unavailable',
          [],
          true,
          5,
        );
      }
      this.emailProvider.ready();
    }

    const user = await this.authUser(authorization);
    if (user.id !== identity.sub) {
      fail(401, 'INVALID_TOKEN', 'Identity mismatch');
    }

    if (!this.abuse.isReady() || !this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Verification is temporarily unavailable',
        [],
        true,
        5,
      );
    }

    const ip = request ? trustedClientIp(request) : '127.0.0.1';
    const { retryAfterSeconds } = await this.abuse.reserveSend(
      { channel, identifier },
      ip,
    );

    try {
      await this.database.transaction(
        identity.sub,
        async (db) => {
          await db.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [
            identity.sub,
          ]);
          await db.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 1))',
            [`auth:pending-${channel}:${identifier}`],
          );

          const [self] = await db.query(
            'SELECT verified_contact FROM public.users WHERE id = $1 FOR UPDATE',
            [identity.sub],
          );
          if (self?.verified_contact) {
            fail(
              409,
              'ALREADY_VERIFIED',
              'Account already has a verified contact',
            );
          }

          const [otherUser] = await db.query(
            channel === 'phone'
              ? "SELECT id FROM public.users WHERE (phone = $1 OR phone = ltrim($1, '+')) AND id <> $2 LIMIT 1 FOR UPDATE"
              : 'SELECT id FROM public.users WHERE lower(email::text) = $1 AND id <> $2 LIMIT 1 FOR UPDATE',
            [identifier, identity.sub],
          );
          const [otherProvider] = await db.query(
            channel === 'phone'
              ? `SELECT user_id
                   FROM public.user_auth_providers
                  WHERE provider = 'phone'
                    AND (contact_value = $1 OR contact_value = ltrim($1, '+'))
                    AND user_id <> $2
                  LIMIT 1
                  FOR UPDATE`
              : `SELECT user_id
                   FROM public.user_auth_providers
                  WHERE provider = 'email'
                    AND lower(contact_value) = $1
                    AND user_id <> $2
                  LIMIT 1
                  FOR UPDATE`,
            [identifier, identity.sub],
          );
          if (otherUser || otherProvider) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }

          const [selfProvider] = await db.query(
            `SELECT contact_value, verified_at
               FROM public.user_auth_providers
              WHERE user_id = $1 AND provider = $2::public.auth_provider
              FOR UPDATE`,
            [identity.sub, channel],
          );
          if (selfProvider?.verified_at) {
            fail(
              409,
              'CONTACT_ALREADY_REGISTERED',
              'Contact already registered',
            );
          }

          await db.query(
            channel === 'phone'
              ? `INSERT INTO public.user_auth_providers
                   (user_id, provider, provider_subject, contact_value, verified_at, is_primary)
                 VALUES (
                   $1,
                   'phone',
                   $2,
                   $3,
                   NULL,
                   NOT EXISTS (SELECT 1 FROM public.user_auth_providers WHERE user_id = $1 AND is_primary = true)
                 )
                 ON CONFLICT (user_id, provider) DO UPDATE
                   SET provider_subject = EXCLUDED.provider_subject,
                       contact_value = EXCLUDED.contact_value,
                       verified_at = NULL,
                       updated_at = now()`
              : `INSERT INTO public.user_auth_providers
                   (user_id, provider, provider_subject, contact_value, verified_at, is_primary)
                 VALUES (
                   $1,
                   'email',
                   $2,
                   $3,
                   NULL,
                   NOT EXISTS (SELECT 1 FROM public.user_auth_providers WHERE user_id = $1 AND is_primary = true)
                 )
                 ON CONFLICT (user_id, provider) DO UPDATE
                   SET provider_subject = EXCLUDED.provider_subject,
                       contact_value = EXCLUDED.contact_value,
                       verified_at = NULL,
                       updated_at = now()`,
            [identity.sub, identity.sub, identifier],
          );
        },
        true,
        true,
      );
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
      }
      throw error;
    }

    let expiresInSeconds = 600;
    try {
      const delivery =
        channel === 'phone'
          ? await this.smsProvider!.sendChallenge({
              id: identity.sub,
              phone: identifier,
            })
          : await this.emailProvider!.sendChallenge({
              id: identity.sub,
              subject: identity.sub,
              email: identifier,
              verified: false,
            });
      if (
        typeof delivery?.expiresInSeconds !== 'number' ||
        delivery.expiresInSeconds <= 0
      ) {
        fail(
          502,
          channel === 'phone' ? 'SMS_PROVIDER_ERROR' : 'EMAIL_PROVIDER_ERROR',
          `${channel === 'phone' ? 'SMS' : 'Email'} delivery could not be confirmed`,
          [],
          true,
        );
      }

      const expiresAt =
        delivery.expiresAt instanceof Date
          ? delivery.expiresAt
          : typeof delivery.expiresAt === 'string'
            ? new Date(delivery.expiresAt)
            : undefined;

      const remainingSeconds =
        expiresAt && !isNaN(expiresAt.getTime())
          ? Math.ceil((expiresAt.getTime() - Date.now()) / 1000)
          : delivery.expiresInSeconds;

      if (remainingSeconds <= 0) {
        fail(400, 'CHALLENGE_EXPIRED', 'Verification challenge expired');
      }

      expiresInSeconds = remainingSeconds;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(
          504,
          'PROVIDER_TIMEOUT',
          `${channel === 'phone' ? 'SMS' : 'Email'} provider timed out`,
          [],
          true,
        );
      }
      fail(
        502,
        channel === 'phone' ? 'SMS_PROVIDER_ERROR' : 'EMAIL_PROVIDER_ERROR',
        `${channel === 'phone' ? 'SMS' : 'Email'} delivery could not be confirmed`,
        [],
        true,
      );
    }

    return {
      verification_channel: channel,
      contact_masked:
        channel === 'phone'
          ? maskPhone(identifier)
          : this.maskEmailContact(identifier),
      expires_in_seconds: expiresInSeconds,
      resend_available_at: new Date(
        Date.now() + retryAfterSeconds * 1000,
      ).toISOString(),
    };
  }

  /**
   * EP-A03: Verifies Bangladesh mobile OTP challenge, updates application account, and mints approved session.
   */
  async verifyPhone(
    body: unknown,
    _request?: Request,
  ): Promise<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: 'Bearer';
    user?: any;
    profile_complete?: boolean;
    next_step?: 'app_home' | 'profile_setup';
    verified?: boolean;
  }> {
    void _request;
    const input = normalizeVerifyPhoneRequest(body);
    const phone = input.phone;
    const code = input.code;

    const [user] = await this.database.query(
      `SELECT u.id, u.phone, u.verified_contact, p.provider_subject, p.verified_at, p.is_primary
         FROM public.users u
         JOIN public.user_auth_providers p
           ON p.user_id = u.id AND p.provider = 'phone'
        WHERE (p.contact_value IN ($1, ltrim($1, '+')) OR COALESCE(u.phone, '') IN ($1, ltrim($1, '+')))
        LIMIT 1`,
      [phone],
    );

    if (!user) {
      fail(410, 'VERIFICATION_CODE_EXPIRED', 'Verification challenge expired');
    }

    if (user.verified_contact === true || user.verified_at !== null) {
      fail(409, 'ALREADY_VERIFIED', 'Contact already verified');
    }

    const userId = user.id;

    if (!this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }

    let committed = false;
    let providerConfirmAttempted = false;
    try {
      await this.otpStore.verifyAndConsumeOtp(
        userId,
        phone,
        code,
        async () => {
          // Recheck and lock the pending provider mapping before calling GoTrue,
          // keeping the recheck, GoTrue confirmation, and application updates under one serialization boundary.
          await this.database.transaction(
            userId,
            async (db) => {
              await db.query(
                'SELECT pg_advisory_xact_lock(hashtext($1::text))',
                [userId],
              );
              const [pendingRow] = await db.query(
                `SELECT u.id, p.contact_value, p.provider_subject, p.verified_at
                   FROM public.users u
                   JOIN public.user_auth_providers p
                     ON p.user_id = u.id AND p.provider = 'phone'
                  WHERE u.id = $1
                    AND (p.contact_value IN ($2, ltrim($2, '+')) OR p.provider_subject IN ($2, ltrim($2, '+')))
                    AND p.verified_at IS NULL
                  LIMIT 1
                  FOR UPDATE`,
                [userId, phone],
              );
              if (!pendingRow) {
                fail(
                  409,
                  'ALREADY_VERIFIED',
                  'Contact already verified or replaced',
                );
              }

              providerConfirmAttempted = true;
              const isSecondary = user.is_primary === false;
              await this.confirmGoTruePhoneUser(
                userId,
                isSecondary ? phone : undefined,
              );

              const usersRes = await db.query(
                `UPDATE public.users
                    SET phone = $1, verified_contact = true, last_login_at = now(), last_active_at = now(), updated_at = now()
                  WHERE id = $2 AND verified_contact = false`,
                [phone, userId],
              );
              const usersAffected =
                Array.isArray(usersRes) && typeof usersRes[1] === 'number'
                  ? usersRes[1]
                  : (usersRes?.rowCount ?? 0);

              const providersRes = await db.query(
                `UPDATE public.user_auth_providers
                    SET verified_at = clock_timestamp(), updated_at = now()
                  WHERE user_id = $1
                    AND provider = 'phone'
                    AND (contact_value IN ($2, ltrim($2, '+')) OR provider_subject IN ($2, ltrim($2, '+')))
                    AND verified_at IS NULL`,
                [userId, phone],
              );
              const providersAffected =
                Array.isArray(providersRes) &&
                typeof providersRes[1] === 'number'
                  ? providersRes[1]
                  : (providersRes?.rowCount ?? 0);

              if (usersAffected !== 1 || providersAffected !== 1) {
                fail(409, 'ALREADY_VERIFIED', 'Account is already verified');
              }

              await db.query(
                'INSERT INTO public.user_profiles(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',
                [userId],
              );
              await db.query(
                'INSERT INTO public.user_preferences(user_id) VALUES($1) ON CONFLICT (user_id) DO NOTHING',
                [userId],
              );
            },
            false,
          );
          committed = true;
        },
        'verify_phone',
      );
    } catch (error) {
      if (!committed) {
        if (providerConfirmAttempted && user.is_primary !== false) {
          const synthEmail = `phone-${userId}@synthetic.mentor`;
          try {
            await this.cleanupSyntheticPhoneEmail(userId, synthEmail);
          } catch (cleanupErr) {
            this.logger.error(
              `Failed to clean up synthetic phone email for user ${userId}`,
              cleanupErr instanceof Error
                ? cleanupErr.stack
                : String(cleanupErr),
            );
          }
        }
        if (isPgUniqueViolation(error)) {
          fail(409, 'CONTACT_ALREADY_REGISTERED', 'Contact already registered');
        }
        throw error;
      }
      this.logger.error(
        `OTP consumption failed after phone verification commit for user ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    // EP-A12 secondary phone verification confirms contact without minting new session
    if (user.is_primary === false) {
      return { verified: true };
    }

    try {
      return await this.mintAndApproveSession(userId, phone, 'phone');
    } catch (error) {
      if (error instanceof HttpException) {
        const resp = error.getResponse();
        const respObj =
          typeof resp === 'object' && resp !== null
            ? (resp as Record<string, unknown>)
            : null;
        const status = error.getStatus();
        const code =
          (typeof respObj?.code === 'string' ? respObj.code : undefined) ||
          'SESSION_MINT_FAILED';
        fail(
          status,
          code,
          'Account is verified; sign in with your phone and password to start your session',
          Array.isArray(respObj?.details) ? respObj.details : [],
          false,
        );
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Account is verified; sign in with your phone and password to start your session',
        [],
        false,
      );
    }
  }

  private async confirmGoTrueUser(
    userId: string,
    email?: string,
  ): Promise<void> {
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config.get<string>('SERVICE_ROLE_KEY');

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: serviceRoleKey || '',
          Authorization: `Bearer ${serviceRoleKey || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          email ? { email, email_confirm: true } : { email_confirm: true },
        ),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(504, 'PROVIDER_TIMEOUT', 'Email provider timed out', [], true);
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Email delivery could not be confirmed',
        [],
        true,
      );
    }

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const dataObj =
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
          : null;
      const msg = typeof dataObj?.msg === 'string' ? dataObj.msg : '';
      if (response.status === 422 && /already confirmed/i.test(msg)) {
        return;
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Email delivery could not be confirmed',
        [],
        true,
      );
    }
  }

  /**
   * Confirms phone number on GoTrue user record and assigns the verified phone number.
   */
  private async confirmGoTruePhoneUser(
    userId: string,
    phone?: string,
  ): Promise<void> {
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config.get<string>('SERVICE_ROLE_KEY');

    const synthEmail = `phone-${userId}@synthetic.mentor`;
    const payload = phone
      ? { phone, phone_confirm: true }
      : {
          phone_confirm: true,
          email: synthEmail,
          email_confirm: true,
        };

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: serviceRoleKey || '',
          Authorization: `Bearer ${serviceRoleKey || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(504, 'PROVIDER_TIMEOUT', 'SMS provider timed out', [], true);
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Phone verification could not be confirmed',
        [],
        true,
      );
    }

    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const dataObj =
        typeof data === 'object' && data !== null
          ? (data as Record<string, unknown>)
          : null;
      const msg = typeof dataObj?.msg === 'string' ? dataObj.msg : '';
      if (response.status === 422 && /already confirmed/i.test(msg)) {
        return;
      }
      fail(
        502,
        'PROVIDER_ERROR',
        'Phone verification could not be confirmed',
        [],
        true,
      );
    }
  }

  /**
   * Cleans up temporary synthetic email and email identity from GoTrue auth tables.
   */
  private async cleanupSyntheticPhoneEmail(
    userId: string,
    syntheticEmail: string,
    db?: EntityManager,
  ): Promise<void> {
    const executor = db ?? this.database;
    await executor.query(
      'UPDATE auth.users SET email = NULL, email_confirmed_at = NULL WHERE id = $1 AND email = $2',
      [userId, syntheticEmail],
    );
    await executor.query(
      "DELETE FROM auth.identities WHERE user_id = $1 AND provider = 'email' AND identity_data->>'email' = $2",
      [userId, syntheticEmail],
    );
  }

  /**
   * Mints GoTrue session via magiclink flow and registers approved session in private store.
   */
  private async mintAndApproveSession(
    userId: string,
    contact: string,
    channel: 'email' | 'phone' = 'email',
  ) {
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config.get<string>('SERVICE_ROLE_KEY');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    const synthEmail = `phone-${userId}@synthetic.mentor`;
    let targetEmail = contact;
    let hasRealEmail = false;

    if (channel === 'phone') {
      const [authUser] = await this.database.query(
        'SELECT email FROM auth.users WHERE id = $1 LIMIT 1',
        [userId],
      );
      if (
        authUser?.email &&
        !authUser.email.endsWith('@synthetic.mentor') &&
        !authUser.email.endsWith('@phone.invalid')
      ) {
        hasRealEmail = true;
        targetEmail = authUser.email;
      } else {
        targetEmail = synthEmail;
      }
    }

    try {
      let linkRes: Response;
      try {
        linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
          method: 'POST',
          headers: {
            apikey: serviceRoleKey || '',
            Authorization: `Bearer ${serviceRoleKey || ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'magiclink',
            email: targetEmail,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' ||
            /timeout|timed out/i.test(error.message))
        ) {
          fail(504, 'PROVIDER_TIMEOUT', 'Auth provider timed out', [], true);
        }
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      if (!linkRes.ok) {
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      const linkData: unknown = await linkRes.json().catch(() => null);
      const linkObj =
        typeof linkData === 'object' && linkData !== null
          ? (linkData as Record<string, unknown>)
          : null;
      const propsObj =
        typeof linkObj?.properties === 'object' && linkObj.properties !== null
          ? (linkObj.properties as Record<string, unknown>)
          : null;
      const tokenHash =
        (typeof linkObj?.hashed_token === 'string'
          ? linkObj.hashed_token
          : undefined) ||
        (typeof propsObj?.hashed_token === 'string'
          ? propsObj.hashed_token
          : undefined);
      if (!tokenHash) {
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      const verificationType =
        (typeof linkObj?.verification_type === 'string'
          ? linkObj.verification_type
          : undefined) ||
        (typeof propsObj?.verification_type === 'string'
          ? propsObj.verification_type
          : undefined) ||
        'magiclink';

      let verifyRes: Response;
      try {
        verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
          method: 'POST',
          headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            token_hash: tokenHash,
            type: verificationType,
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === 'AbortError' ||
            /timeout|timed out/i.test(error.message))
        ) {
          fail(504, 'PROVIDER_TIMEOUT', 'Auth provider timed out', [], true);
        }
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      if (!verifyRes.ok) {
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      const sessionData = (await verifyRes.json().catch(() => null)) as
        (ProviderSession & { user?: { id?: string } }) | null;

      if (!sessionData?.access_token) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Auth service returned an invalid session',
        );
      }

      const identity = this.sessionIdentity(sessionData.access_token);
      if (identity.sub !== userId) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Auth service returned an invalid session',
        );
      }

      const result = await this.database.transaction(
        userId,
        async (db) => {
          if (channel === 'phone' && !hasRealEmail) {
            await this.cleanupSyntheticPhoneEmail(userId, synthEmail, db);
          }
          await this.approvals.approve(
            db,
            userId,
            identity.sessionId,
            'email_verification',
          );
          return this.meInTransaction(db, userId);
        },
        false,
        false,
        channel !== 'phone',
      );

      return {
        access_token: sessionData.access_token,
        refresh_token: sessionData.refresh_token,
        expires_in: sessionData.expires_in,
        token_type: 'Bearer' as const,
        user: result.user,
        profile_complete: result.profile_complete,
        next_step: result.profile_complete
          ? ('app_home' as const)
          : ('profile_setup' as const),
      };
    } catch (mintError) {
      if (channel === 'phone' && !hasRealEmail) {
        try {
          await this.cleanupSyntheticPhoneEmail(userId, synthEmail);
        } catch (cleanupErr) {
          this.logger.error(
            `Failed to clean up synthetic phone email for user ${userId}`,
            cleanupErr instanceof Error ? cleanupErr.stack : String(cleanupErr),
          );
        }
      }
      throw mintError;
    }
  }

  async logout(identity: JwtIdentity, authorization?: string) {
    await this.approvals.revokeSession(identity.sub, identity.sessionId);
    if (authorization) {
      try {
        const supabaseUrl = this.config
          .getOrThrow<string>('SUPABASE_URL')
          .replace(/\/$/, '');
        const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');
        await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: {
            Authorization: authorization,
            apikey: anonKey,
          },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
      } catch {
        // Best-effort GoTrue session invalidation; do not fail logout if upstream token expired or network fails
      }
    }
    return { logged_out: true as const };
  }

  async refresh(body: unknown) {
    const input = normalizeRefreshTokenRequest(body);
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let response: Response;
    try {
      response = await fetch(
        `${supabaseUrl}/auth/v1/token?grant_type=refresh_token`,
        {
          method: 'POST',
          headers: {
            apikey: anonKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refresh_token: input.refresh_token }),
          signal: AbortSignal.timeout(10000),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(504, 'PROVIDER_TIMEOUT', 'Auth provider timed out', [], true);
      }
      fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
    }

    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 422
    ) {
      fail(401, 'REFRESH_TOKEN_INVALID', 'Refresh token is invalid or expired');
    }

    if (!response.ok) {
      fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
    }

    const providerSession = (await response
      .json()
      .catch(() => null)) as ProviderSession | null;

    if (!providerSession?.access_token || !providerSession?.refresh_token) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Auth service returned an invalid session',
      );
    }

    const identity = this.sessionIdentity(providerSession.access_token);

    const approved = await this.approvals.isSessionApproved(
      identity.sub,
      identity.sessionId,
    );
    if (!approved) {
      fail(
        401,
        'REFRESH_TOKEN_INVALID',
        'Session is not approved or has been revoked',
      );
    }

    const result = await this.database.transaction(
      identity.sub,
      async (db) => {
        return this.meInTransaction(db, identity.sub);
      },
      false,
      false,
    );

    return {
      access_token: providerSession.access_token,
      refresh_token: providerSession.refresh_token,
      expires_in: providerSession.expires_in,
      token_type: 'Bearer' as const,
      user: result.user,
      profile_complete: result.profile_complete,
      next_step: result.profile_complete
        ? ('app_home' as const)
        : ('profile_setup' as const),
    };
  }

  async forgotPassword(body: unknown, request?: Request) {
    const input = normalizeForgotPasswordRequest(body);
    const channel = input.channel;

    if (!this.abuse.isReady() || !this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Password recovery is temporarily unavailable',
        [],
        true,
        5,
      );
    }

    if (channel === 'phone') {
      if (!this.smsProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Phone password recovery is temporarily unavailable',
          [],
          true,
          5,
        );
      }
      this.smsProvider.ready();
    } else {
      if (!this.emailProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Password recovery is temporarily unavailable',
          [],
          true,
          5,
        );
      }
      this.emailProvider.ready();
    }

    const ip = request ? trustedClientIp(request) : '127.0.0.1';
    await this.abuse.reserveSend(input, ip);

    const rows = await this.database.query(
      channel === 'phone'
        ? `SELECT u.id, u.phone, u.status, u.verified_contact, p.provider_subject, p.verified_at
             FROM public.users u
             JOIN public.user_auth_providers p
               ON p.user_id = u.id AND p.provider = 'phone'
            WHERE (p.contact_value IN ($1, ltrim($1, '+')) OR COALESCE(u.phone, '') IN ($1, ltrim($1, '+')))
            LIMIT 1`
        : `SELECT u.id, u.email, u.status, u.verified_contact, p.provider_subject, p.verified_at
             FROM public.users u
             JOIN public.user_auth_providers p
               ON p.user_id = u.id AND p.provider = 'email'
            WHERE (lower(p.contact_value) = $1 OR lower(COALESCE(u.email, '')) = $1)
            LIMIT 1`,
      [input.identifier],
    );

    const user = rows?.[0];
    if (
      user &&
      user.status === 'active' &&
      user.verified_contact === true &&
      user.verified_at !== null
    ) {
      const challengePromise =
        channel === 'phone'
          ? this.smsProvider!.sendPasswordResetChallenge(
              input.identifier,
              user.id,
            )
          : this.emailProvider!.sendPasswordResetChallenge(
              input.identifier,
              user.id,
            );
      void challengePromise.catch((error: unknown) => {
        this.logger.error(
          `Failed to dispatch password reset challenge for user ${user.id}`,
          error instanceof Error ? error.stack : String(error),
        );
      });
    }

    return {
      message: 'If the account exists, a code was sent.',
    };
  }

  async resetPassword(body: unknown, _request?: Request) {
    void _request;
    const configuredMinimum = Number(
      this.config.get<number>('AUTH_PASSWORD_MIN_LENGTH') ?? 8,
    );
    const input = normalizeResetPasswordRequest(body, configuredMinimum);
    const channel = input.channel;

    if (channel === 'phone') {
      if (!this.smsProvider) {
        fail(
          503,
          'SERVICE_UNAVAILABLE',
          'Phone password recovery is temporarily unavailable',
          [],
          true,
          5,
        );
      }
      this.smsProvider.ready();
    }

    if (!this.otpStore) {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'OTP secret store is unavailable',
        [],
        true,
        5,
      );
    }

    const rows = await this.database.query(
      channel === 'phone'
        ? `SELECT u.id, u.phone, u.status, u.verified_contact, p.provider_subject
             FROM public.users u
             JOIN public.user_auth_providers p
               ON p.user_id = u.id AND p.provider = 'phone'
            WHERE (p.contact_value IN ($1, ltrim($1, '+')) OR COALESCE(u.phone, '') IN ($1, ltrim($1, '+')))
            LIMIT 1`
        : `SELECT u.id, u.email, u.status, u.verified_contact, p.provider_subject
             FROM public.users u
             JOIN public.user_auth_providers p
               ON p.user_id = u.id AND p.provider = 'email'
            WHERE (lower(p.contact_value) = $1 OR lower(COALESCE(u.email, '')) = $1)
            LIMIT 1`,
      [input.identifier],
    );

    const user = rows?.[0];
    if (!user) {
      fail(410, 'VERIFICATION_CODE_EXPIRED', 'Verification challenge expired');
    }

    const userId = user.id;

    let committed = false;
    try {
      await this.otpStore.verifyAndConsumeOtp(
        userId,
        input.identifier,
        input.code,
        async () => {
          let passwordUpdated = false;
          try {
            await this.database.transaction(
              userId,
              async (db) => {
                await this.approvals.revokeAllUserSessions(userId, db);
                await this.updateGoTrueUserPassword(userId, input.new_password);
                passwordUpdated = true;
              },
              true,
            );
            committed = true;
          } catch (error) {
            if (passwordUpdated) {
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  await this.approvals.revokeAllUserSessions(userId);
                  break;
                } catch {
                  // Best-effort compensating local session revocation
                }
              }
            }
            throw error;
          }
        },
        'reset_password',
      );
    } catch (error) {
      if (!committed) {
        throw error;
      }
      this.logger.error(
        `OTP consumption failed after password reset commit for user ${user.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    await this.revokeGoTrueUserSessions(userId);

    return {
      password_reset: true as const,
    };
  }

  private async updateGoTrueUserPassword(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config.get<string>('SERVICE_ROLE_KEY');

    let response: Response;
    try {
      response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          apikey: serviceRoleKey || '',
          Authorization: `Bearer ${serviceRoleKey || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: newPassword }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' ||
          /timeout|timed out/i.test(error.message))
      ) {
        fail(
          504,
          'PROVIDER_TIMEOUT',
          'Authentication provider timed out',
          [],
          true,
        );
      }
      fail(502, 'PROVIDER_ERROR', 'Authentication provider error', [], true);
    }

    if (!response.ok) {
      fail(
        502,
        'PROVIDER_ERROR',
        `Authentication provider error: ${response.status}`,
        [],
        true,
      );
    }
  }

  private async revokeGoTrueUserSessions(userId: string): Promise<void> {
    const configuredTimeout = Number(this.config.get('GOTRUE_TIMEOUT_MS'));
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 5000;
    const safeTimeoutMs = Math.max(1, Math.trunc(timeoutMs));
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.database.transaction(
          null,
          async (qr) => {
            await qr.query(`SET LOCAL statement_timeout = ${safeTimeoutMs}`);
            await qr.query(`SET LOCAL lock_timeout = ${safeTimeoutMs}`);
            await qr.query(
              `UPDATE auth.refresh_tokens
                  SET revoked = true,
                      updated_at = clock_timestamp()
                WHERE user_id = $1::text
                  AND COALESCE(revoked, false) = false`,
              [userId],
            );
            await qr.query(
              'DELETE FROM auth.sessions WHERE user_id = $1::uuid',
              [userId],
            );
          },
          false,
          false,
          false,
        );
        return;
      } catch (error) {
        lastError = error;
      }
    }

    this.logger.error(
      `Failed to revoke GoTrue sessions for user ${userId}`,
      lastError instanceof Error ? lastError.stack : String(lastError),
    );

    const errorCode = (lastError as { code?: unknown })?.code;
    const isTimeoutError =
      (typeof errorCode === 'string' &&
        (errorCode === '57014' || errorCode === '55P03')) ||
      (lastError instanceof Error &&
        (lastError.name === 'AbortError' ||
          /statement timeout|lock timeout|query_canceled|timeout|timed out/i.test(
            lastError.message,
          )));

    if (isTimeoutError) {
      fail(
        504,
        'PROVIDER_TIMEOUT',
        'Password was updated and local sessions were revoked, but auth session revocation timed out. Please sign in with your new password.',
        [],
        false,
      );
    }

    fail(
      502,
      'PROVIDER_ERROR',
      'Password was updated and local sessions were revoked, but auth session revocation failed. Please sign in with your new password.',
      [],
      false,
    );
  }
}
