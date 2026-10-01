import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../common/enums/user-role.enum.js';

export const ROLES_KEY = 'roles';

/**
 * Route-level decorator that declares which UserRoles are permitted.
 * Used by RolesGuard to enforce RBAC.
 *
 * Usage:
 *   @Roles(UserRole.ADMIN)
 *   @Get('admin-only')
 *   adminRoute() { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
