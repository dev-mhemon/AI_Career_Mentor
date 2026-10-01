/**
 * Invitation code lifecycle statuses.
 * SAD v1.1 §9: Codes have usage limits, expiration, and can be revoked.
 */
export enum InvitationCodeStatus {
  ACTIVE = 'ACTIVE',
  EXHAUSTED = 'EXHAUSTED',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}
