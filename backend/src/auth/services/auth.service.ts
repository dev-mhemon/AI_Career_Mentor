import { HttpException, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, QueryFailedError } from 'typeorm';
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
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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

    if (provider) {
      if (!['google', 'facebook'].includes(provider))
        fail(422, 'PROVIDER_MISMATCH', 'Unsupported OAuth provider');
      if (!identities.some((i) => i.provider === provider))
        fail(
          422,
          'PROVIDER_MISMATCH',
          'Provider is not linked to this Auth identity',
        );

      const isOAuthSession = Boolean(
        amr?.some(
          (entry) =>
            entry.method === 'oauth' &&
            (entry.provider?.toLowerCase() === provider.toLowerCase() ||
              (!entry.provider &&
                (payload?.app_metadata?.provider?.toLowerCase() ===
                  provider.toLowerCase() ||
                  payload?.app_metadata?.providers?.includes(provider)))),
        ) ||
        payload?.app_metadata?.provider?.toLowerCase() ===
          provider.toLowerCase() ||
        (Array.isArray(payload?.app_metadata?.providers) &&
          payload.app_metadata.providers.includes(provider)),
      );
      if (!isOAuthSession) {
        fail(
          403,
          'PROVIDER_MISMATCH',
          'Session was not authenticated via the requested OAuth provider',
        );
      }
      activeProvider = provider.toLowerCase();
      activeContact = user.email || null;
    } else {
      const oauthEntry = amr?.find((entry) => entry.method === 'oauth');
      const appMetaProvider = payload?.app_metadata?.provider?.toLowerCase();
      const resolvedOAuthProvider =
        oauthEntry?.provider?.toLowerCase() ||
        (appMetaProvider && ['google', 'facebook'].includes(appMetaProvider)
          ? appMetaProvider
          : null);

      if (
        oauthEntry &&
        resolvedOAuthProvider &&
        ['google', 'facebook'].includes(resolvedOAuthProvider)
      ) {
        activeProvider = resolvedOAuthProvider;
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
        activeProvider = payload.app_metadata.provider.toLowerCase();
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
    return this.database
      .transaction(
        identity.sub,
        async (db) => {
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
            const [existing] = await db.query(
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
          const email = user.email_confirmed_at ? user.email || null : null;
          const phone = user.phone_confirmed_at
            ? user.phone?.startsWith('+')
              ? user.phone
              : `+${user.phone}`
            : null;
          if (phone && !/^\+8801[3-9][0-9]{8}$/.test(phone))
            fail(
              422,
              'VALIDATION_FAILED',
              'Only Bangladesh mobile contacts are supported',
            );

          // Reconcile if an existing account in public.users already has this email
          const [existingUserByEmail] = email
            ? await db.query(
                `SELECT id FROM public.users WHERE LOWER(email) = LOWER($1) AND id <> $2`,
                [email, user.id],
              )
            : [null];

          const targetUserId = existingUserByEmail?.id || user.id;

          if (existingUserByEmail) {
            await db.query(
              `UPDATE public.users SET
                 verified_contact = true,
                 last_active_at = clock_timestamp(),
                 last_login_at = clock_timestamp()
               WHERE id = $1`,
              [targetUserId],
            );
            if (identity.sessionId) {
              await db.query(
                `UPDATE auth.sessions SET user_id = $1 WHERE id = $2`,
                [targetUserId, identity.sessionId],
              );
            }
          } else {
            await db.query(
              `INSERT INTO public.users(id,email,phone,verified_contact,last_active_at,last_login_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())
          ON CONFLICT(id) DO UPDATE SET email=excluded.email,phone=excluded.phone,verified_contact=excluded.verified_contact`,
              [user.id, email, phone, !!(email || phone)],
            );
          }

          for (const i of identities) {
            await db.query(
              `INSERT INTO public.user_auth_providers(user_id,provider,provider_subject,contact_value,verified_at,is_primary)
          VALUES($1,$2,$3,$4,$5,NOT EXISTS(SELECT 1 FROM public.user_auth_providers WHERE user_id=$1))
          ON CONFLICT(user_id,provider) DO UPDATE SET provider_subject=excluded.provider_subject,contact_value=excluded.contact_value,verified_at=excluded.verified_at`,
              [
                targetUserId,
                i.provider,
                i.identity_data?.sub || i.id,
                i.provider === 'phone' ? phone : email,
                (i.provider === 'phone'
                  ? user.phone_confirmed_at
                  : user.email_confirmed_at) || null,
              ],
            );
          }
          await db.query(
            'INSERT INTO public.user_profiles(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
            [targetUserId],
          );
          await db.query(
            'INSERT INTO public.user_preferences(user_id) VALUES($1) ON CONFLICT(user_id) DO NOTHING',
            [targetUserId],
          );
          const result = await this.meInTransaction(db, targetUserId);
          if (result.user.verified_contact && identity.sessionId && provider) {
            await this.approvals.approve(
              db,
              targetUserId,
              identity.sessionId,
              'oauth',
            );
            await db.query(
              'UPDATE public.users SET last_login_at=clock_timestamp() WHERE id=$1',
              [targetUserId],
            );
          }
          return result;
        },
        false,
        !!provider,
      )
      .catch((error: unknown) => {
        if (
          error instanceof QueryFailedError &&
          error.driverError.code === '23505' &&
          [
            'uq_users_email',
            'uq_users_phone',
            'uq_user_auth_providers_subject',
          ].includes(error.driverError.constraint)
        ) {
          fail(
            409,
            'IDENTITY_LINK_CONFLICT',
            'Identity belongs to another application account',
          );
        }
        throw error;
      });
  }
  async me(id: string) {
    return this.database
      .transaction(id, (db) => this.meInTransaction(db, id), false)
      .catch((error: unknown) => {
        if (
          error instanceof QueryFailedError &&
          error.driverError.code === '23505' &&
          [
            'uq_users_email',
            'uq_users_phone',
            'uq_user_auth_providers_subject',
          ].includes(error.driverError.constraint)
        ) {
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
        const resp = error.getResponse() as any;
        const status = error.getStatus();
        const code = resp?.code || 'SESSION_MINT_FAILED';
        fail(
          status,
          code,
          'Account is verified; sign in with your email and password to start your session',
          resp?.details || [],
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
        if (
          error instanceof QueryFailedError &&
          error.driverError?.code === '23505'
        ) {
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
      if (
        error instanceof QueryFailedError &&
        error.driverError?.code === '23505'
      ) {
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
        const resp = error.getResponse() as any;
        const status = error.getStatus();
        const code = resp?.code || 'SESSION_MINT_FAILED';
        fail(
          status,
          code,
          'Account is verified; sign in with your phone and password to start your session',
          resp?.details || [],
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
      const data = (await response.json().catch(() => null)) as any;
      if (
        response.status === 422 &&
        /already confirmed/i.test(data?.msg || '')
      ) {
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
      const data = (await response.json().catch(() => null)) as any;
      if (
        response.status === 422 &&
        /already confirmed/i.test(data?.msg || '')
      ) {
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

      const linkData = (await linkRes.json().catch(() => null)) as any;
      const tokenHash =
        linkData?.hashed_token || linkData?.properties?.hashed_token;
      if (!tokenHash) {
        fail(502, 'PROVIDER_ERROR', 'Auth provider error', [], true);
      }

      const verificationType =
        linkData?.verification_type ||
        linkData?.properties?.verification_type ||
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
