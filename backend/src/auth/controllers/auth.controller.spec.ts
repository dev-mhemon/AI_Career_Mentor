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
      const controller = new AuthController({
        bootstrap,
      } as unknown as AuthService);
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
});
