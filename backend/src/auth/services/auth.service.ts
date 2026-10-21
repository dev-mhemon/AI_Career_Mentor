import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity.js';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';

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
 * Responsibilities:
 *  - User synchronisation (create / update from JWT identity)
 *  - Current-user retrieval
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  // ─── User Sync ──────────────────────────────────────────────

  /**
   * Create or update the local User record from the Supabase JWT.
   *
   * Field ownership rules:
   *  - Supabase-controlled: supabase_uid, email, phone
   *  - Application-controlled: role, status (never overwritten by sync)
   */
  async syncUser(identity: JwtIdentity): Promise<User> {
    const normalizedEmail = identity.email?.trim() || null;
    const normalizedPhone = identity.phone?.trim() || null;

    const existing = await this.userRepository.findOne({
      where: { supabase_uid: identity.supabase_uid },
    });

    if (existing) {
      // Update only Supabase-controlled fields.
      let changed = false;

      if (existing.email !== normalizedEmail) {
        existing.email = normalizedEmail;
        changed = true;
      }
      if (existing.phone !== normalizedPhone) {
        existing.phone = normalizedPhone;
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
      email: normalizedEmail,
      phone: normalizedPhone,
      role: UserRole.USER,
      status: UserStatus.ACTIVE,
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
}
