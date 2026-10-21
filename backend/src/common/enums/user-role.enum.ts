/**
 * User roles as defined in SAD v1.1 §9.
 * USER: Standard user with access to career features.
 * ADMIN: Manages users and feature toggles.
 */
export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}
