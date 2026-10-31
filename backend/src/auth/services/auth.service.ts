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
  normalizeForgotPasswordRequest,
  normalizeLoginRequest,
  normalizeRefreshTokenRequest,
  normalizeResetPasswordRequest,
  normalizeVerifyEmailRequest,
} from '../registration.dto.js';
import type { Request } from 'express';
import { SessionApprovalService } from './session-approval.service.js';
import { OtpSecretStore } from './otp-secret-store.service.js';
import { EmailRegistrationProvider } from './email-registration.provider.js';
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

      const isOAuthSession = amr?.some(
        (entry) =>
          entry.method === 'oauth' &&
          typeof entry.provider === 'string' &&
          entry.provider.toLowerCase() === provider.toLowerCase(),
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
      const oauthEntry = amr?.find(
        (entry) =>
          entry.method === 'oauth' &&
          typeof entry.provider === 'string' &&
          ['google', 'facebook'].includes(entry.provider.toLowerCase()),
      );
      if (oauthEntry?.provider) {
        activeProvider = oauthEntry.provider.toLowerCase();
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
          await db.query(
            `INSERT INTO public.users(id,email,phone,verified_contact,last_active_at,last_login_at) VALUES($1,$2,$3,$4,clock_timestamp(),clock_timestamp())
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,phone=excluded.phone,verified_contact=excluded.verified_contact`,
            [user.id, email, phone, !!(email || phone)],
          );
          for (const i of identities) {
            await db.query(
              `INSERT INTO public.user_auth_providers(user_id,provider,provider_subject,contact_value,verified_at,is_primary)
          VALUES($1,$2,$3,$4,$5,NOT EXISTS(SELECT 1 FROM public.user_auth_providers WHERE user_id=$1))
          ON CONFLICT(user_id,provider) DO UPDATE SET provider_subject=excluded.provider_subject,contact_value=excluded.contact_value,verified_at=excluded.verified_at`,
              [
                user.id,
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
    try {
      await this.otpStore.verifyAndConsumeOtp(userId, email, code, async () => {
        await this.confirmGoTrueUser(userId);

        await this.database.transaction(
          userId,
          async (db) => {
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
                WHERE user_id = $1 AND provider = 'email' AND verified_at IS NULL`,
              [userId],
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
          },
          false,
        );
        committed = true;
      });
    } catch (error) {
      if (!committed) {
        throw error;
      }
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

  private async confirmGoTrueUser(userId: string): Promise<void> {
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
        body: JSON.stringify({ email_confirm: true }),
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

  private async mintAndApproveSession(userId: string, email: string) {
    const supabaseUrl = this.config
      .getOrThrow<string>('SUPABASE_URL')
      .replace(/\/$/, '');
    const serviceRoleKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
      this.config.get<string>('SERVICE_ROLE_KEY');
    const anonKey = this.config.getOrThrow<string>('SUPABASE_ANON_KEY');

    let linkRes: Response;
    try {
      linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey || '',
          Authorization: `Bearer ${serviceRoleKey || ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'magiclink', email }),
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
          type: 'magiclink',
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
        await this.approvals.approve(
          db,
          userId,
          identity.sessionId,
          'email_verification',
        );
        return this.meInTransaction(db, userId);
      },
      false,
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

  async forgotPassword(body: unknown, request?: Request) {
    const input = normalizeForgotPasswordRequest(body);
    if (input.channel !== 'email') {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Phone password recovery is temporarily unavailable',
        [],
        true,
        5,
      );
    }

    if (!this.abuse.isReady() || !this.otpStore || !this.emailProvider) {
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

    const ip = request ? trustedClientIp(request) : '127.0.0.1';
    await this.abuse.reserveSend(input, ip);

    const rows = await this.database.query(
      `SELECT u.id, u.email, u.status, u.verified_contact, p.provider_subject, p.verified_at
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
      void this.emailProvider
        .sendPasswordResetChallenge(input.identifier, user.id)
        .catch((error: unknown) => {
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
    if (input.channel !== 'email') {
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Phone password recovery is temporarily unavailable',
        [],
        true,
        5,
      );
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
      `SELECT u.id, u.email, u.status, u.verified_contact, p.provider_subject
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

    await this.otpStore.verifyAndConsumeOtp(
      userId,
      input.identifier,
      input.code,
      async () => {
        let goTrueUpdated = false;
        try {
          await this.database.transaction(
            userId,
            async (db) => {
              await this.approvals.revokeAllUserSessions(userId, db);
              await this.updateGoTrueUserPassword(userId, input.new_password);
              await this.revokeGoTrueUserSessions(userId);
              goTrueUpdated = true;
            },
            true,
          );
        } catch (err) {
          if (goTrueUpdated) {
            for (let attempt = 0; attempt < 3; attempt++) {
              try {
                await this.approvals.revokeAllUserSessions(userId);
                break;
              } catch {
                // Best-effort fallback retry
              }
            }
          }
          throw err;
        }
      },
      'reset_password',
    );

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
    try {
      const supabaseUrl = this.config
        .getOrThrow<string>('SUPABASE_URL')
        .replace(/\/$/, '');
      const serviceRoleKey =
        this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ||
        this.config.get<string>('SERVICE_ROLE_KEY');
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}/logout`, {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey || '',
          Authorization: `Bearer ${serviceRoleKey || ''}`,
        },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
    } catch {
      // Best-effort GoTrue session invalidation
    }
  }
}
