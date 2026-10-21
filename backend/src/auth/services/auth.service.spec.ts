import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import type { JwtIdentity } from './auth.service.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { DataSource } from 'typeorm';

// ─── Helpers ────────────────────────────────────────────────

function makeIdentity(overrides: Partial<JwtIdentity> = {}): JwtIdentity {
  return {
    supabase_uid: 'supa-uid-1',
    email: 'test@example.com',
    phone: null,
    ...overrides,
  };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-uuid-1',
    supabase_uid: 'supa-uid-1',
    email: 'test@example.com',
    phone: null,
    role: UserRole.USER,
    status: UserStatus.ACTIVE,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as User;
}

// ─── Tests ──────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  // Mock repositories
  const mockUserRepo = {
    findOne: vi.fn(),
    create: vi.fn(),
    save: vi.fn(),
  };

  const mockDataSource = {
    transaction: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ── syncUser ─────────────────────────────────────────────

  describe('syncUser', () => {
    it('should create a new user when no local record exists', async () => {
      const identity = makeIdentity();
      const createdUser = makeUser();

      mockUserRepo.findOne.mockResolvedValue(null);
      mockUserRepo.create.mockReturnValue(createdUser);
      mockUserRepo.save.mockResolvedValue(createdUser);

      const result = await service.syncUser(identity);

      expect(mockUserRepo.findOne).toHaveBeenCalledWith({
        where: { supabase_uid: identity.supabase_uid },
      });
      expect(mockUserRepo.create).toHaveBeenCalledWith({
        supabase_uid: identity.supabase_uid,
        email: identity.email,
        phone: identity.phone,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
      });
      expect(result).toEqual(createdUser);
    });

    it('should normalize empty string email and phone to null', async () => {
      const identity = makeIdentity({ email: '   ', phone: '' });
      const createdUser = makeUser();

      mockUserRepo.findOne.mockResolvedValue(null);
      mockUserRepo.create.mockReturnValue(createdUser);
      mockUserRepo.save.mockResolvedValue(createdUser);

      await service.syncUser(identity);

      expect(mockUserRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: null,
          phone: null,
        }),
      );
    });

    it('should return existing user without saving when nothing changed', async () => {
      const identity = makeIdentity();
      const existingUser = makeUser();

      mockUserRepo.findOne.mockResolvedValue(existingUser);

      const result = await service.syncUser(identity);

      expect(mockUserRepo.save).not.toHaveBeenCalled();
      expect(result).toEqual(existingUser);
    });

    it('should update email when it changed in Supabase', async () => {
      const identity = makeIdentity({ email: 'new@example.com' });
      const existingUser = makeUser({ email: 'old@example.com' });
      const updatedUser = makeUser({ email: 'new@example.com' });

      mockUserRepo.findOne.mockResolvedValue(existingUser);
      mockUserRepo.save.mockResolvedValue(updatedUser);

      const result = await service.syncUser(identity);

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      expect(result.email).toBe('new@example.com');
    });

    it('should update phone when it changed in Supabase', async () => {
      const identity = makeIdentity({ phone: '+1234567890' });
      const existingUser = makeUser({ phone: null });
      const updatedUser = makeUser({ phone: '+1234567890' });

      mockUserRepo.findOne.mockResolvedValue(existingUser);
      mockUserRepo.save.mockResolvedValue(updatedUser);

      const result = await service.syncUser(identity);

      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+1234567890' }),
      );
      expect(result.phone).toBe('+1234567890');
    });

    it('should NOT overwrite role or status during sync', async () => {
      const identity = makeIdentity();
      const existingUser = makeUser({
        email: 'old@example.com',
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      });

      mockUserRepo.findOne.mockResolvedValue(existingUser);
      mockUserRepo.save.mockResolvedValue(existingUser);

      await service.syncUser(identity);

      // save is called because email changed, but role/status are preserved.
      expect(mockUserRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
        }),
      );
    });
  });

  // ── findBySupabaseUid ────────────────────────────────────

  describe('findBySupabaseUid', () => {
    it('should return a user when found', async () => {
      const user = makeUser();
      mockUserRepo.findOne.mockResolvedValue(user);

      const result = await service.findBySupabaseUid('supa-uid-1');

      expect(result).toEqual(user);
    });

    it('should return null when not found', async () => {
      mockUserRepo.findOne.mockResolvedValue(null);

      const result = await service.findBySupabaseUid('non-existent');

      expect(result).toBeNull();
    });
  });
});
