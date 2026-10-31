import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DatabaseService } from '../services/database.service.js';
import { fail } from '../../common/http.js';
import type { AccessPolicy } from '../policy.js';
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly database: DatabaseService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const p =
      this.reflector.getAllAndOverride<AccessPolicy>('access-policy', [
        context.getHandler(),
        context.getClass(),
      ]) || {};
    if (p.public || p.bootstrap) return true;
    const req = context.switchToHttp().getRequest();
    return this.database.transaction(
      req.user.sub,
      async (db) => {
        const [u] = await db.query(
          `SELECT u.status,u.verified_contact,
             private.has_approved_session(u.id,$2::uuid) AS session_approved,
             EXISTS (
               SELECT 1
                 FROM private.approved_auth_sessions a
                WHERE a.user_id = u.id
                  AND a.session_id = $2::uuid
                  AND a.revoked_at IS NULL
             ) AS unrevoked_session_approved
             FROM public.users u WHERE u.id=$1`,
          [req.user.sub, req.user.sessionId],
        );
        if (!u) fail(401, 'AUTH_REQUIRED', 'Application account required');
        if (!p.allowSuspended && u.status !== 'active')
          fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
        const approved = p.allowSuspended
          ? Boolean(u.session_approved || u.unrevoked_session_approved)
          : Boolean(u.session_approved);
        if (!p.accountInspection && (!u.verified_contact || !approved))
          fail(403, 'UNVERIFIED_ACCOUNT', 'Approved session required');
        if (p.admin) {
          const [a] = await db.query(
            "SELECT 1 FROM public.admin_users WHERE user_id=$1 AND role='platform_admin'",
            [req.user.sub],
          );
          if (!a) fail(403, 'ADMIN_REQUIRED', 'Administrator access required');
        }
        if (
          p.feature &&
          !(p.existingRead && p.feature !== 'technology_update')
        ) {
          const [f] = await db.query(
            'SELECT enabled,default_user_enabled,(SELECT enabled FROM public.user_access_overrides WHERE user_id=$1 AND feature_key=$2) AS override FROM public.feature_controls WHERE feature_key=$2',
            [req.user.sub, p.feature],
          );
          if (!f?.enabled) fail(403, 'FEATURE_DISABLED', 'Feature is disabled');
          if (!(f.override ?? f.default_user_enabled))
            fail(403, 'FEATURE_DISABLED', 'Feature access is restricted');
        }
        return true;
      },
      false,
    );
  }
}
