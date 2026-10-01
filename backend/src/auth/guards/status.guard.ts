import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { SKIP_STATUS_CHECK_KEY } from '../decorators/skip-status-check.decorator.js';
import type { User } from '../../users/entities/user.entity.js';

/**
 * Guard that enforces user account status requirements.
 *
 * By default every authenticated route requires UserStatus.ACTIVE.
 * Routes decorated with @SkipStatusCheck() bypass this guard,
 * allowing PENDING_INVITE users to access /sync, /me, and
 * /invitation/verify (Plan v1.2 §5).
 */
@Injectable()
export class StatusGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const skipCheck = this.reflector.getAllAndOverride<boolean>(
      SKIP_STATUS_CHECK_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipCheck) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as User | undefined;

    if (!user || !('status' in user)) {
      throw new ForbiddenException('User record not found');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(
        'Account is not active. Please verify an invitation code.',
      );
    }

    return true;
  }
}
