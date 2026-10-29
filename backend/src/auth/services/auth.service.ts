import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, QueryFailedError } from 'typeorm';
import { DatabaseService } from './database.service.js';
import { fail } from '../../common/http.js';
import { profileComplete } from '../../common/profile-completeness.js';
import { features } from '../policy.js';
import { AuthAbuseControl } from '../abuse-control/abuse-control.service.js';
import { trustedClientIp } from '../client-ip.js';
import { normalizeLoginRequest } from '../registration.dto.js';
import type { Request } from 'express';
import { SessionApprovalService } from './session-approval.service.js';
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
@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
    private readonly abuse: AuthAbuseControl,
    private readonly approvals: SessionApprovalService,
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
    if (!amr && authorization?.startsWith('Bearer ')) {
      try {
        const parts = authorization.slice(7).split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(parts[1], 'base64url').toString('utf8'),
          ) as { amr?: unknown };
          if (Array.isArray(payload.amr)) {
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
    }
    return this.database
      .transaction(
        identity.sub,
        async (db) => {
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
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,phone=excluded.phone,verified_contact=excluded.verified_contact,
        last_login_at=clock_timestamp()`,
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
          if (result.user.verified_contact && identity.sessionId) {
            if (provider) {
              await this.approvals.approve(
                db,
                user.id,
                identity.sessionId,
                'oauth',
              );
            } else if (amr?.some((e) => e.method === 'password')) {
              await this.approvals.approve(
                db,
                user.id,
                identity.sessionId,
                'password_login',
              );
            }
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
}
