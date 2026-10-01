import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import { UserRole } from '../../common/enums/user-role.enum.js';

function createMockContext(user?: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('should allow any user when no @Roles() is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext({ role: UserRole.USER });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should allow ADMIN user when @Roles(ADMIN) is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext({ role: UserRole.ADMIN });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject USER when @Roles(ADMIN) is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext({ role: UserRole.USER });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should allow when user has one of multiple required roles', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([
      UserRole.USER,
      UserRole.ADMIN,
    ]);
    const ctx = createMockContext({ role: UserRole.USER });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when user is missing', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([UserRole.ADMIN]);
    const ctx = createMockContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
