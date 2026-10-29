/**
 * Supabase JWT payload shape.
 * Only the fields we actually consume are declared.
 */
export interface SupabaseJwtPayload {
  /** Supabase user ID — is the application user primary key. */
  sub: string;
  app_metadata?: { provider?: string };

  /** Email claim (may be absent for phone-only users). */
  email?: string;

  /** Phone claim (may be absent for email-only users). */
  phone?: string;

  /** Standard JWT expiration (epoch seconds). */
  exp: number;

  /** Standard JWT issued-at (epoch seconds). */
  iat: number;

  /** Supabase Auth session UUID. Signature validation precedes its use. */
  session_id: string;
}
