import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import type { InvitationCode } from '../../invitation-codes/entities/invitation-code.entity.js';

/**
 * User entity — stores identity, authentication reference, role, and status.
 * SAD v1.1 §6 (User) and §9 (Authentication and Authorization).
 *
 * Authentication is delegated to Supabase Auth; this table holds the
 * local reference (supabase_uid) and application-level fields only.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Supabase Auth user ID. Set after the user registers through Supabase.
   * Unique — each Supabase account maps to exactly one local user.
   */
  @Column({ type: 'varchar', length: 255, unique: true })
  supabase_uid: string;

  /**
   * Email address used for email/password or Google/Facebook login.
   * Nullable because phone-only registration is supported (SAD v1.1 §9).
   */
  @Index('IDX_users_email', { unique: true })
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  email: string | null;

  /**
   * Phone number used for phone/password login with WhatsApp OTP.
   * Nullable because email-only registration is supported (SAD v1.1 §9).
   */
  @Index('IDX_users_phone', { unique: true })
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  phone: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER,
  })
  role: UserRole;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING_INVITE,
  })
  status: UserStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;

  /**
   * Invitation codes created by this user (relevant for ADMIN users).
   * Lazy-loaded to avoid unnecessary joins on basic user queries.
   */
  @OneToMany('InvitationCode', 'creator')
  created_invitation_codes: InvitationCode[];
}
