import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StatusGuard } from './status.guard.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';

function createMockContext(user?: Record<string, any>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => vi.fn(),
    getClass: () => vi.fn(),
  } as unknown as ExecutionContext;
}

describe('StatusGuard', () => {
  let guard: StatusGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new StatusGuard(reflector);
  });

  it('should allow ACTIVE users', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = createMockContext({ status: UserStatus.ACTIVE, role: 'USER' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should reject PENDING_INVITE users by default', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = createMockContext({
      status: UserStatus.PENDING_INVITE,
      role: 'USER',
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should reject SUSPENDED users', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = createMockContext({
      status: UserStatus.SUSPENDED,
      role: 'USER',
    });

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('should allow PENDING_INVITE users when @SkipStatusCheck is set', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = createMockContext({
      status: UserStatus.PENDING_INVITE,
      role: 'USER',
    });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when user is missing', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const ctx = createMockContext(undefined);

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
