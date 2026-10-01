import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../../common/enums/user-role.enum.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import type { User } from '../../users/entities/user.entity.js';

/**
 * Guard that enforces role-based access control (RBAC).
 *
 * If a route is decorated with @Roles(UserRole.ADMIN), only users
 * whose local User.role matches will be allowed through.
 * Routes without @Roles() are open to any authenticated user.
 *
 * Plan v1.2 §5: Role verification uses the local PostgreSQL User
 * table, not Supabase JWT claims.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      UserRole[] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);

    // No @Roles() decorator → route is open to any role.
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as User | undefined;

    if (!user || !('role' in user)) {
      throw new ForbiddenException('User record not found');
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
