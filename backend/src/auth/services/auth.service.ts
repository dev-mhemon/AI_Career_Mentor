import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager, QueryFailedError } from 'typeorm';
import { DatabaseService } from './database.service.js';
import { fail } from '../../common/http.js';
import { profileComplete } from '../../common/profile-completeness.js';
import { features } from '../policy.js';
export interface JwtIdentity {
  sub: string;
  authProvider?: string;
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
@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService,
  ) {}
  async bootstrap(
    identity: JwtIdentity,
    authorization: string,
    provider?: string,
  ) {
    // A live Auth lookup is required before provisioning. Never trust user metadata or JWT contacts.
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
    const user = (await response.json()) as AuthUser;
    if (user.id !== identity.sub)
      fail(401, 'INVALID_TOKEN', 'Identity mismatch');
    const identities = (user.identities || []).filter((i) =>
      ['email', 'phone', 'google', 'facebook'].includes(i.provider),
    );
    if (
      provider &&
      (identity.authProvider !== provider ||
        !identities.some((i) => i.provider === provider))
    )
      fail(
        422,
        'PROVIDER_MISMATCH',
        'Provider is not linked to this Auth identity',
      );
    return this.database
      .transaction(
        identity.sub,
        async (db) => {
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
            `INSERT INTO public.users(id,email,phone,verified_contact,last_active_at,last_login_at) VALUES($1,$2,$3,$4,now(),now())
        ON CONFLICT(id) DO UPDATE SET email=excluded.email,phone=excluded.phone,verified_contact=excluded.verified_contact,
        last_login_at=now(),last_active_at=CASE WHEN users.last_active_at IS NULL OR users.last_active_at < now()-interval '5 minutes' THEN now() ELSE users.last_active_at END`,
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
          return this.meInTransaction(db, user.id);
        },
        false,
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
