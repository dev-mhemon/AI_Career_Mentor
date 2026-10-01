/**
 * User account statuses reflecting the invitation-gated activation flow.
 * SAD v1.1 §9: Register → Login → Invitation code verification → Account activation.
 */
export enum UserStatus {
  PENDING_INVITE = 'PENDING_INVITE',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}
