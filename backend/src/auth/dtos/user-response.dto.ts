import { UserRole } from '../../common/enums/user-role.enum.js';
import { UserStatus } from '../../common/enums/user-status.enum.js';
import type { User } from '../../users/entities/user.entity.js';

/**
 * Sanitised user representation returned by all auth endpoints.
 * Omits internal fields (supabase_uid) to keep responses clean.
 * Plan v1.2 §4: Response is a User object.
 */
export class UserResponseDto {
  id: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  created_at: Date;
  updated_at: Date;

  /**
   * Build a UserResponseDto from a User entity.
   * Centralises the mapping so controllers stay thin.
   */
  static fromEntity(user: User): UserResponseDto {
    const dto = new UserResponseDto();
    dto.id = user.id;
    dto.email = user.email;
    dto.phone = user.phone;
    dto.role = user.role;
    dto.status = user.status;
    dto.created_at = user.created_at;
    dto.updated_at = user.updated_at;
    return dto;
  }
}
