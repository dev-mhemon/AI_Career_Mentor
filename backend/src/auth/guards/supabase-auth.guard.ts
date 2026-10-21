import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { fail } from '../../common/http.js';
import type { AccessPolicy } from '../policy.js';
@Injectable()
export class SupabaseAuthGuard extends AuthGuard('supabase') {
  constructor(private readonly reflector: Reflector) {
    super();
  }
  canActivate(context: ExecutionContext) {
    const p = this.reflector.getAllAndOverride<AccessPolicy>('access-policy', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (p?.public) return true;
    return super.canActivate(context);
  }
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user)
      fail(
        401,
        !context.switchToHttp().getRequest().headers.authorization
          ? 'AUTH_REQUIRED'
          : info?.name === 'TokenExpiredError'
            ? 'TOKEN_EXPIRED'
            : 'INVALID_TOKEN',
        'A valid Auth session is required',
      );
    return user;
  }
}
