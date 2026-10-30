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
});
