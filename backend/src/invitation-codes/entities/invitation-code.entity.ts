import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { InvitationCodeStatus } from '../../common/enums/invitation-code-status.enum.js';
import { User } from '../../users/entities/user.entity.js';

/**
 * InvitationCode entity — gates account activation for the private platform.
 * SAD v1.1 §9: Register → Login → Invitation code verification → Account activation.
 *
 * Codes are created by admins, have a usage limit, optional expiration,
 * and track how many times they have been used.
 */
@Entity('invitation_codes')
export class InvitationCode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * The invitation code string that users enter to activate their account.
   * Must be unique to prevent collisions.
   */
  @Index('IDX_invitation_codes_code', { unique: true })
  @Column({ type: 'varchar', length: 100, unique: true })
  code: string;

  /**
   * The admin user who created this invitation code.
   * Nullable to support seeded codes created before any admin user exists
   * (Plan v1.2 §3: "Nullable for seeded codes").
   * ON DELETE SET NULL: if the creator is removed, codes are preserved.
   */
  @ManyToOne(() => User, (user) => user.created_invitation_codes, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'creator_id' })
  creator: User | null;

  @Column({ type: 'uuid', nullable: true })
  creator_id: string | null;

  /** Maximum number of times this code can be used. */
  @Column({ type: 'int' })
  usage_limit: number;

  /** How many times this code has been successfully used so far. */
  @Column({ type: 'int', default: 0 })
  used_count: number;

  /**
   * Optional expiration timestamp. Null means the code does not expire.
   * SAD v1.1 §9 lists expiration as a field on invitation codes.
   */
  @Column({ type: 'timestamptz', nullable: true })
  expiration_date: Date | null;

  @Column({
    type: 'enum',
    enum: InvitationCodeStatus,
    default: InvitationCodeStatus.ACTIVE,
  })
  status: InvitationCodeStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
