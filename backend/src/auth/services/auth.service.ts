import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { InvitationCode } from '../../invitation-codes/entities/invitation-code.entity.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import { InvitationCodeStatus } from '../../common/enums/invitation-code-status.enum.js';

/**
 * Payload extracted from the Supabase JWT by the strategy.
 * Passed into service methods so the service stays decoupled from
 * the HTTP layer.
 */
export interface JwtIdentity {
  supabase_uid: string;
  email: string | null;
  phone: string | null;
}

/**
 * Core business logic for authentication endpoints.
 *
 * Responsibilities (Plan v1.2 §4):
 *  - User synchronisation (create / update from JWT identity)
 *  - Invitation code verification with atomic increment
 *  - Current-user retrieval
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(InvitationCode)
    private readonly invitationCodeRepository: Repository<InvitationCode>,
    private readonly dataSource: DataSource,
  ) {}

  // ─── User Sync ──────────────────────────────────────────────

  /**
   * Create or update the local User record from the Supabase JWT.
   *
   * Field ownership rules:
   *  - Supabase-controlled: supabase_uid, email, phone
   *  - Application-controlled: role, status (never overwritten by sync)
   *
   * Plan v1.2 §2: Frontend-triggered synchronisation.
   */
  async syncUser(identity: JwtIdentity): Promise<User> {
    const existing = await this.userRepository.findOne({
      where: { supabase_uid: identity.supabase_uid },
    });

    if (existing) {
      // Update only Supabase-controlled fields.
      let changed = false;

      if (existing.email !== identity.email) {
        existing.email = identity.email;
        changed = true;
      }
      if (existing.phone !== identity.phone) {
        existing.phone = identity.phone;
        changed = true;
      }

      if (changed) {
        this.logger.log(
          `Updating synced fields for user ${existing.id} (supabase_uid=${identity.supabase_uid})`,
        );
        return this.userRepository.save(existing);
      }

      return existing;
    }

    // New user — apply defaults.
    const user = this.userRepository.create({
      supabase_uid: identity.supabase_uid,
      email: identity.email,
      phone: identity.phone,
      role: UserRole.USER,
      status: UserStatus.PENDING_INVITE,
    });

    this.logger.log(
      `Creating local user for supabase_uid=${identity.supabase_uid}`,
    );
    return this.userRepository.save(user);
  }

  // ─── Current User ──────────────────────────────────────────

  /**
   * Retrieve the local User by supabase_uid.
   * Returns null when the user has not been synced yet.
   */
  async findBySupabaseUid(supabaseUid: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { supabase_uid: supabaseUid },
    });
  }

  // ─── Invitation Verification ───────────────────────────────

  /**
   * Verify an invitation code and activate the user's account.
   *
   * Plan v1.2 §5: Atomic transaction when incrementing used_count
   * to prevent concurrency exploits.
   *
   * Throws:
   *  - NotFoundException if user does not exist locally
   *  - BadRequestException if user is already ACTIVE
   *  - BadRequestException if code is invalid / exhausted / expired
   */
  async verifyInvitation(supabaseUid: string, code: string): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      // 1. Load the local user.
      const user = await manager.findOne(User, {
        where: { supabase_uid: supabaseUid },
      });

      if (!user) {
        throw new NotFoundException(
          'User not found. Please call /api/auth/sync first.',
        );
      }

      if (user.status === UserStatus.ACTIVE) {
        throw new BadRequestException('Account is already active.');
      }

      // 2. Load and lock the invitation code row to prevent races.
      const invitation = await manager
        .createQueryBuilder(InvitationCode, 'ic')
        .setLock('pessimistic_write')
        .where('ic.code = :code', { code })
        .getOne();

      if (!invitation) {
        throw new BadRequestException('Invalid invitation code.');
      }

      // 3. Validate code status.
      if (invitation.status !== InvitationCodeStatus.ACTIVE) {
        throw new BadRequestException(
          `Invitation code is ${invitation.status.toLowerCase()}.`,
        );
      }

      if (
        invitation.expiration_date &&
        invitation.expiration_date < new Date()
      ) {
        // Mark expired in DB so future lookups are fast.
        invitation.status = InvitationCodeStatus.EXPIRED;
        await manager.save(InvitationCode, invitation);
        throw new BadRequestException('Invitation code has expired.');
      }

      if (invitation.used_count >= invitation.usage_limit) {
        invitation.status = InvitationCodeStatus.EXHAUSTED;
        await manager.save(InvitationCode, invitation);
        throw new BadRequestException('Invitation code has been fully used.');
      }

      // 4. Consume the code and activate the user.
      invitation.used_count += 1;
      if (invitation.used_count >= invitation.usage_limit) {
        invitation.status = InvitationCodeStatus.EXHAUSTED;
      }
      await manager.save(InvitationCode, invitation);

      user.status = UserStatus.ACTIVE;
      const activatedUser = await manager.save(User, user);

      this.logger.log(
        `User ${user.id} activated with invitation code "${code}"`,
      );

      return activatedUser;
    });
  }
}
