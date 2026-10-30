import 'reflect-metadata';
import { AuthController } from './auth.controller.js';
import type { AuthService } from '../services/auth.service.js';

describe('C05 OAuth session response', () => {
  it.each([
    [false, false, 'add_verified_contact'],
    [false, true, 'add_verified_contact'],
    [true, false, 'profile_setup'],
    [true, true, 'app_home'],
  ] as const)(
    'verified contact %s, complete profile %s returns %s',
    async (verifiedContact, profileComplete, nextStep) => {
      const user = {
        id: 'application-user',
        verified_contact: verifiedContact,
      };
      const bootstrap = vi.fn().mockResolvedValue({
        user,
        profile_complete: profileComplete,
      });
      const controller = new AuthController(
        {
          bootstrap,
        } as unknown as AuthService,
        {} as never,
      );
      const request = {
        user: { sub: 'verified-subject' },
        headers: { authorization: 'Bearer synthetic-test-session' },
      };

      expect(await controller.oauth(request, { provider: 'google' })).toEqual({
        user,
        profile_complete: profileComplete,
        verified_contact_required: !verifiedContact,
        next_step: nextStep,
      });
      expect(bootstrap).toHaveBeenCalledExactlyOnceWith(
        request.user,
        request.headers.authorization,
        'google',
      );
    },
  );

  it('delegates verifyEmail to authService.verifyEmail', async () => {
    const mockSession = {
      access_token: 'token',
      refresh_token: 'refresh',
      token_type: 'Bearer',
      expires_in: 3600,
      expires_at: 1234567890,
      next_step: 'profile_setup',
      user: { id: 'user-1', email: 'test@example.com', verified_contact: true },
    };
    const verifyEmail = vi.fn().mockResolvedValue(mockSession);
    const controller = new AuthController(
      { verifyEmail } as unknown as AuthService,
      {} as never,
    );
    const req = {} as any;
    const body = { email: 'test@example.com', code: '123456' };

    const result = await controller.verifyEmail(req, body);
    expect(result).toEqual(mockSession);
    expect(verifyEmail).toHaveBeenCalledWith(body, req);
  });

  it('delegates logout to authService.logout with user identity and authorization header', async () => {
    const logout = vi.fn().mockResolvedValue({ logged_out: true });
    const controller = new AuthController(
      { logout } as unknown as AuthService,
      {} as never,
    );
    const req = {
      user: { sub: 'user-uuid', sessionId: 'session-uuid' },
      headers: { authorization: 'Bearer test-token' },
    } as any;

    const result = await controller.logout(req);
    expect(result).toEqual({ logged_out: true });
    expect(logout).toHaveBeenCalledWith(req.user, 'Bearer test-token');
    expect(
      Reflect.getMetadata('access-policy', AuthController.prototype.logout),
    ).toEqual({ allowSuspended: true });
  });

  it('delegates refresh to authService.refresh', async () => {
    const mockSession = {
      access_token: 'new-token',
      refresh_token: 'new-refresh',
      expires_in: 3600,
      token_type: 'Bearer',
      user: { id: 'user-1' },
      profile_complete: true,
      next_step: 'app_home',
    };
    const refresh = vi.fn().mockResolvedValue(mockSession);
    const controller = new AuthController(
      { refresh } as unknown as AuthService,
      {} as never,
    );
    const body = { refresh_token: 'valid-refresh-token' };

    const result = await controller.refresh(body);
    expect(result).toEqual(mockSession);
    expect(refresh).toHaveBeenCalledWith(body);
  });

  it('delegates forgotPassword to authService.forgotPassword', async () => {
    const mockResponse = {
      success: true,
      data: { message: 'If the account exists, a code was sent.' },
    };
    const forgotPassword = vi.fn().mockResolvedValue(mockResponse);
    const controller = new AuthController(
      { forgotPassword } as unknown as AuthService,
      {} as never,
    );
    const req = { ip: '127.0.0.1' } as any;
    const body = { identifier: 'user@example.com' };

    const result = await controller.forgotPassword(req, body);
    expect(result).toEqual(mockResponse);
    expect(forgotPassword).toHaveBeenCalledWith(body, req);
  });

  it('delegates resetPassword to authService.resetPassword', async () => {
    const mockResponse = {
      success: true,
      data: { password_reset: true },
    };
    const resetPassword = vi.fn().mockResolvedValue(mockResponse);
    const controller = new AuthController(
      { resetPassword } as unknown as AuthService,
      {} as never,
    );
    const req = {} as any;
    const body = {
      identifier: 'user@example.com',
      code: '123456',
      new_password: 'N3w!Password',
      confirm_new_password: 'N3w!Password',
    };

    const result = await controller.resetPassword(req, body);
    expect(result).toEqual(mockResponse);
    expect(resetPassword).toHaveBeenCalledWith(body, req);
  });
});
