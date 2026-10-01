import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller.js';
import { AuthService } from '../services/auth.service.js';
import type { JwtIdentity } from '../services/auth.service.js';
import { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    supabase_uid: 'supa-uid-1',
    email: 'test@example.com',
    phone: null,
    role: UserRole.USER,
    status: UserStatus.PENDING_INVITE,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    created_invitation_codes: [],
    ...overrides,
  } as User;
}

function makeIdentity(): JwtIdentity {
  return {
    supabase_uid: 'supa-uid-1',
    email: 'test@example.com',
    phone: null,
  };
}

describe('AuthController', () => {
  let controller: AuthController;

  const mockAuthService = {
    syncUser: vi.fn(),
    findBySupabaseUid: vi.fn(),
    verifyInvitation: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        Reflector,
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('POST /auth/sync', () => {
    it('should return UserResponseDto after syncing', async () => {
      const user = makeUser();
      mockAuthService.syncUser.mockResolvedValue(user);

      const result = await controller.sync(makeIdentity());

      expect(result).toEqual(
        expect.objectContaining({
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
        }),
      );
      // supabase_uid should NOT be in the response DTO.
      expect(result).not.toHaveProperty('supabase_uid');
    });
  });

  describe('GET /auth/me', () => {
    it('should return UserResponseDto for existing user', async () => {
      const user = makeUser();
      mockAuthService.findBySupabaseUid.mockResolvedValue(user);

      const result = await controller.me(makeIdentity());

      expect(result.id).toBe(user.id);
      expect(result).not.toHaveProperty('supabase_uid');
    });

    it('should throw NotFoundException when user is not synced', async () => {
      mockAuthService.findBySupabaseUid.mockResolvedValue(null);

      await expect(controller.me(makeIdentity())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('POST /auth/invitation/verify', () => {
    it('should return activated UserResponseDto', async () => {
      const activatedUser = makeUser({ status: UserStatus.ACTIVE });
      mockAuthService.verifyInvitation.mockResolvedValue(activatedUser);

      const result = await controller.verifyInvitation(makeIdentity(), {
        code: 'VALID-CODE',
      });

      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(result).not.toHaveProperty('supabase_uid');
    });
  });
});
