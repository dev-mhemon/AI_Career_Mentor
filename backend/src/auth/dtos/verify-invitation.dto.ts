import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * DTO for POST /api/auth/invitation/verify.
 * Plan v1.2 §4: Request body contains { code }.
 */
export class VerifyInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  code: string;
}
