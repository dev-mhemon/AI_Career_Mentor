import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import type { JwtIdentity } from './auth.service.js';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../../users/entities/user.entity.js';
import { InvitationCode } from '../../invitation-codes/entities/invitation-code.entity.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { InvitationCodeStatus } from '../../common/enums/invitation-code-status.enum.js';
import { DataSource } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

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
    status: UserStatus.PENDING_INVITE,
    created_at: new Date(),
    updated_at: new Date(),
    created_invitation_codes: [],
    ...overrides,
  } as User;
}

function makeInvitationCode(
  overrides: Partial<InvitationCode> = {},
): InvitationCode {
  return {
    id: 'invite-uuid-1',
    code: 'VALID-CODE',
    creator: null,
    creator_id: null,
    usage_limit: 10,
    used_count: 0,
    expiration_date: null,
    status: InvitationCodeStatus.ACTIVE,
    created_at: new Date(),
    ...overrides,
  } as InvitationCode;
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

  const mockInvitationCodeRepo = {
    findOne: vi.fn(),
  };

  // Transaction manager used inside verifyInvitation
  const mockTransactionManager = {
    findOne: vi.fn(),
    save: vi.fn(),
    createQueryBuilder: vi.fn(),
  };

  const mockDataSource = {
    transaction: vi.fn(
      (cb: (manager: typeof mockTransactionManager) => Promise<any>) =>
        cb(mockTransactionManager),
    ),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
        {
          provide: getRepositoryToken(InvitationCode),
          useValue: mockInvitationCodeRepo,
        },
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
        status: UserStatus.PENDING_INVITE,
      });
      expect(result).toEqual(createdUser);
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

  // ── verifyInvitation ─────────────────────────────────────

  describe('verifyInvitation', () => {
    const mockQueryBuilder = {
      setLock: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      getOne: vi.fn(),
    };

    beforeEach(() => {
      mockTransactionManager.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );
    });

    it('should activate user with a valid invitation code', async () => {
      const user = makeUser();
      const code = makeInvitationCode();
      const activatedUser = makeUser({ status: UserStatus.ACTIVE });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);
      mockTransactionManager.save
        .mockResolvedValueOnce(code) // save code
        .mockResolvedValueOnce(activatedUser); // save user

      const result = await service.verifyInvitation('supa-uid-1', 'VALID-CODE');

      expect(result.status).toBe(UserStatus.ACTIVE);
    });

    it('should increment used_count on the invitation code', async () => {
      const user = makeUser();
      const code = makeInvitationCode({ used_count: 3, usage_limit: 10 });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);
      mockTransactionManager.save.mockImplementation(
        (_entity: any, data: any) => Promise.resolve(data),
      );

      await service.verifyInvitation('supa-uid-1', 'VALID-CODE');

      // The code's used_count should have been incremented.
      expect(code.used_count).toBe(4);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      mockTransactionManager.findOne.mockResolvedValue(null);

      await expect(
        service.verifyInvitation('unknown-uid', 'VALID-CODE'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when user is already ACTIVE', async () => {
      const user = makeUser({ status: UserStatus.ACTIVE });
      mockTransactionManager.findOne.mockResolvedValue(user);

      await expect(
        service.verifyInvitation('supa-uid-1', 'VALID-CODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for non-existent code', async () => {
      const user = makeUser();
      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.verifyInvitation('supa-uid-1', 'BAD-CODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired code', async () => {
      const user = makeUser();
      const code = makeInvitationCode({
        expiration_date: new Date('2020-01-01'),
      });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);
      mockTransactionManager.save.mockResolvedValue(code);

      await expect(
        service.verifyInvitation('supa-uid-1', 'VALID-CODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for exhausted code', async () => {
      const user = makeUser();
      const code = makeInvitationCode({
        used_count: 10,
        usage_limit: 10,
      });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);
      mockTransactionManager.save.mockResolvedValue(code);

      await expect(
        service.verifyInvitation('supa-uid-1', 'VALID-CODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for revoked code', async () => {
      const user = makeUser();
      const code = makeInvitationCode({
        status: InvitationCodeStatus.REVOKED,
      });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);

      await expect(
        service.verifyInvitation('supa-uid-1', 'VALID-CODE'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should mark code EXHAUSTED when used_count reaches usage_limit', async () => {
      const user = makeUser();
      const code = makeInvitationCode({
        used_count: 9,
        usage_limit: 10,
      });

      mockTransactionManager.findOne.mockResolvedValue(user);
      mockQueryBuilder.getOne.mockResolvedValue(code);
      mockTransactionManager.save.mockImplementation(
        (_entity: any, data: any) => Promise.resolve(data),
      );

      await service.verifyInvitation('supa-uid-1', 'VALID-CODE');

      expect(code.used_count).toBe(10);
      expect(code.status).toBe(InvitationCodeStatus.EXHAUSTED);
    });
  });
});
