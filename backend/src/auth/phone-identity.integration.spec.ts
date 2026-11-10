import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { ArgumentsHost } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AuthService } from './services/auth.service.js';
import { AuthController } from './controllers/auth.controller.js';
import { EmailRegistrationService } from './services/email-registration.service.js';
import { ApiExceptionFilter, fail } from '../common/http.js';
import type { DatabaseService } from './services/database.service.js';
import type { SessionApprovalService } from './services/session-approval.service.js';
import type { AuthAbuseControl } from './abuse-control/abuse-control.service.js';
import type { EmailRegistrationProvider } from './services/email-registration.provider.js';
import type { OtpSecretStore } from './services/otp-secret-store.service.js';

const TEST_USER_ID = '44444444-4444-4444-8444-444444444444';
const TEST_SESSION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_PHONE = '+8801712345678';
const TEST_RAW_PHONE = '01712345678';
const TEST_EMAIL = 'phone-user@example.com';

/**
 * Creates a synthetic ES256-signed JWT token payload for testing.
 */
function createSyntheticJwt(
  sub: string,
  sessionId: string,
  extra: Record<string, unknown> = {},
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      session_id: sessionId,
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...extra,
    }),
  ).toString('base64url');
  return `${header}.${payload}.synthetic-sig`;
}

/**
 * Creates a mock Express Request object with trusted client IP.
 */
function createMockRequest(ip = '127.0.0.1'): Request {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

/**
 * Extracts the contents of the first balanced parenthesized block starting at or after startIndex.
 * Respects single-quoted SQL string literals using standard SQL doubling semantics ('').
 * Returns { content: string; endIndex: number } or null if not found.
 *
 * @param str - The source string containing parenthesized expressions.
 * @param startIndex - The index to begin searching for an opening parenthesis.
 * @returns Object with inner content and end index, or null if unparseable.
 */
function extractBalancedParens(
  str: string,
  startIndex: number,
): { content: string; endIndex: number } | null {
  const openIndex = str.indexOf('(', startIndex);
  if (openIndex === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < str.length; i++) {
    const char = str[i];
    if (char === "'") {
      inString = !inString;
    } else if (!inString) {
      if (char === '(') {
        depth++;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          return {
            content: str.slice(openIndex + 1, i),
            endIndex: i,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Splits the comma-delimited content of a SQL VALUES (...) tuple into separate expressions,
 * respecting nested parentheses and single-quoted SQL string literals.
 *
 * @param content - The inner content of the VALUES tuple.
 * @returns Array of expression strings.
 */
function splitSqlExpressions(content: string): string[] {
  const values: string[] = [];
  let depth = 0;
  let inString = false;
  let current = '';
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === "'") {
      inString = !inString;
      current += char;
    } else if (!inString && char === '(') {
      depth++;
      current += char;
    } else if (!inString && char === ')') {
      depth--;
      current += char;
    } else if (!inString && char === ',' && depth === 0) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

/**
 * Extracts the raw expression corresponding to a named column from an INSERT into user_auth_providers statement.
 * Normalizes column names by stripping double quotes and backticks to support quoted identifiers.
 *
 * @param sql - The SQL statement being executed.
 * @param columnName - The column name to locate (case-insensitive).
 * @returns The raw expression string aligned with the column in VALUES, or null if unparseable/omitted.
 */
function getInsertedColumnExpression(
  sql: string,
  columnName: string,
): string | null {
  const tableMatch = sql.match(
    /\bINSERT\s+INTO\s+(?:public\.)?user_auth_providers\b/i,
  );
  if (!tableMatch || tableMatch.index === undefined) {
    return null;
  }

  // Extract balanced column list immediately following the table identifier
  const colBlock = extractBalancedParens(
    sql,
    tableMatch.index + tableMatch[0].length,
  );
  if (!colBlock) {
    return null;
  }

  // Extract balanced VALUES tuple immediately following \bVALUES\s*
  const afterCols = sql.slice(colBlock.endIndex);
  const valuesMatch = afterCols.match(/\bVALUES\s*\(/i);
  if (!valuesMatch || valuesMatch.index === undefined) {
    return null;
  }
  const valuesStartIndex = colBlock.endIndex + valuesMatch.index;
  const valBlock = extractBalancedParens(sql, valuesStartIndex);
  if (!valBlock) {
    return null;
  }

  // Parse column names, stripping double quotes and backticks for quoted identifiers like "is_primary"
  const columns = colBlock.content
    .split(',')
    .map((c) => c.replace(/["`]/g, '').trim().toLowerCase());
  const colIndex = columns.indexOf(columnName.toLowerCase());
  if (colIndex === -1) {
    return null;
  }

  const values = splitSqlExpressions(valBlock.content);
  if (colIndex < values.length) {
    return values[colIndex];
  }

  return null;
}

/**
 * Extracts the raw expression corresponding to the is_primary column from an INSERT into user_auth_providers statement.
 * Normalizes column names by stripping double quotes and backticks to support quoted identifiers.
 *
 * @param sql - The SQL statement being executed.
 * @returns The raw expression string aligned with is_primary in VALUES, or null if unparseable/omitted.
 */
function getInsertedPrimaryExpression(sql: string): string | null {
  return getInsertedColumnExpression(sql, 'is_primary');
}

/**
 * Resolves the inserted provider value from an INSERT into user_auth_providers statement,
 * extracting either a string literal ('email') or a positional parameter ($2), unwrapping lower(...) if present.
 *
 * @param sql - The SQL statement being executed.
 * @param args - Positional query parameters.
 * @returns The provider string (e.g. 'email'), or null if unresolvable.
 */
function resolveInsertedProvider(
  sql: string,
  args: unknown[] = [],
): string | null {
  const rawExpr = getInsertedColumnExpression(sql, 'provider');
  if (!rawExpr) return null;
  const unwrapped = rawExpr.replace(/^lower\((.*)\)$/i, '$1').trim();
  const literalMatch = unwrapped.match(/^'([^']*)'$/);
  if (literalMatch) {
    return literalMatch[1].replace(/''/g, "'").toLowerCase();
  }
  const paramMatch = unwrapped.match(/^\$(\d+)$/);
  if (paramMatch) {
    const idx = parseInt(paramMatch[1], 10) - 1;
    if (idx >= 0 && idx < args.length && typeof args[idx] === 'string') {
      return (args[idx] as string).toLowerCase();
    }
  }
  return null;
}

/**
 * Detects whether an INSERT into public.user_auth_providers attempts to set
 * is_primary = true as a hardcoded literal rather than dynamically via NOT EXISTS(...).
 *
 * @param sql - The SQL statement being executed.
 * @returns boolean indicating whether is_primary is hardcoded to true.
 */
function detectHardcodedPrimaryInsert(sql: string): boolean {
  const expr = getInsertedPrimaryExpression(sql);
  if (!expr) {
    return false;
  }
  if (/^\s*NOT\s+EXISTS\b/i.test(expr)) {
    return false;
  }
  return /^\s*true\s*$/i.test(expr);
}

/**
 * Resolves the is_primary flag for a simulated public.user_auth_providers insertion.
 *
 * @param sql - The SQL statement being executed.
 * @param hasPrimary - Whether an existing primary provider row already exists for the user.
 * @returns boolean indicating whether the inserted provider row is marked as primary.
 */
function resolveInsertedPrimaryFlag(sql: string, hasPrimary: boolean): boolean {
  const expr = getInsertedPrimaryExpression(sql);
  if (!expr) {
    return false;
  }
  if (/^\s*NOT\s+EXISTS\b/i.test(expr)) {
    return !hasPrimary;
  }
  if (/^\s*true\s*$/i.test(expr)) {
    return true;
  }
  return false;
}

/**
 * Asserts whether a public.user_auth_providers INSERT query attempts to set is_primary = true
 * when another primary provider already exists for the user, throwing a simulated 23505 QueryFailedError.
 *
 * Respects ON CONFLICT (user_id, provider) DO UPDATE semantics: when inserting with a conflict
 * target on (user_id, provider) and the target row matches the existing primary provider,
 * the conflict clause performs an UPDATE on that existing row rather than inserting a duplicate primary row.
 *
 * @param sql - The SQL statement being executed.
 * @param args - The query parameters.
 * @param hasExistingPrimary - Whether a primary provider already exists in the mock state.
 * @param existingPrimaryProvider - Optional provider name of the existing primary row (e.g. 'email', 'phone').
 */
function assertNoDuplicatePrimaryProvider(
  sql: string,
  args: unknown[],
  hasExistingPrimary: boolean,
  existingPrimaryProvider?: string,
): void {
  if (!hasExistingPrimary || !detectHardcodedPrimaryInsert(sql)) {
    return;
  }

  // If the query includes ON CONFLICT (user_id, provider) DO UPDATE and the provider being upserted
  // matches the existing primary provider, PostgreSQL executes an in-place UPDATE on the existing primary row,
  // preventing a duplicate primary row violation (uq_user_auth_providers_one_primary).
  const hasOnConflictProvider =
    /\bON\s+CONFLICT\s*\(\s*(?:["`]?user_id["`]?\s*,\s*["`]?provider["`]?|["`]?provider["`]?\s*,\s*["`]?user_id["`]?)\s*\)\s*DO\s+UPDATE\b/i.test(
      sql,
    );
  if (hasOnConflictProvider && existingPrimaryProvider) {
    const insertedProvider = resolveInsertedProvider(sql, args);
    if (insertedProvider && insertedProvider === existingPrimaryProvider) {
      return;
    }
  }

  const err = new Error(
    'duplicate key value violates unique constraint "uq_user_auth_providers_one_primary"',
  ) as Error & {
    code?: string;
    constraint?: string;
  };
  err.code = '23505';
  err.constraint = 'uq_user_auth_providers_one_primary';
  throw new QueryFailedError(sql, args, err);
}

describe('M02-02 Phone Auth, Social Identity Linking & Contact Matrix (EP-A03, EP-A10, EP-A11, EP-A12)', () => {
  let config: ConfigService;
  let database: {
    query: ReturnType<typeof vi.fn>;
    transaction: ReturnType<typeof vi.fn>;
  };
  let abuse: {
    reserveSend: ReturnType<typeof vi.fn>;
    isReady: ReturnType<typeof vi.fn>;
  };
  let approvals: {
    approve: ReturnType<typeof vi.fn>;
  };
  let otpStore: {
    verifyAndConsumeOtp: ReturnType<typeof vi.fn>;
  };
  let emailProvider: {
    ready: ReturnType<typeof vi.fn>;
    sendChallenge: ReturnType<typeof vi.fn>;
  };
  let authService: AuthService;
  let authController: AuthController;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn();

    config = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        if (key === 'SERVICE_ROLE_KEY') return 'test-service-key';
        return undefined;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://supabase.test';
        if (key === 'SUPABASE_ANON_KEY') return 'test-anon-key';
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'test-service-key';
        throw new Error(`Missing ${key}`);
      }),
    } as unknown as ConfigService;

    database = {
      query: vi.fn(),
      transaction: vi.fn(
        async (
          _id: string | null,
          op: (db: EntityManager) => Promise<unknown>,
        ) => {
          const txDb = {
            query: database.query,
          } as unknown as EntityManager;
          return op(txDb);
        },
      ),
    };

    abuse = {
      reserveSend: vi.fn(async () => ({ retryAfterSeconds: null })),
      isReady: vi.fn(() => true),
    };

    approvals = {
      approve: vi.fn().mockResolvedValue(undefined),
    };

    otpStore = {
      verifyAndConsumeOtp: vi.fn(
        async (
          _userId: string,
          _contact: string,
          _code: string,
          action: () => Promise<unknown>,
        ) => {
          return action();
        },
      ),
    };

    emailProvider = {
      ready: vi.fn(),
      sendChallenge: vi.fn(async () => ({
        expiresInSeconds: 600,
        expiresAt: new Date(Date.now() + 600000),
      })),
    };

    authService = new AuthService(
      database as unknown as DatabaseService,
      config,
      abuse as unknown as AuthAbuseControl,
      approvals as unknown as SessionApprovalService,
      otpStore as unknown as OtpSecretStore,
      emailProvider as unknown as EmailRegistrationProvider,
    );
    authController = new AuthController(authService, {} as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  describe('1. EP-A03 Phone Verification (POST /auth/verify-phone)', () => {
    it('executes successful phone verification with valid 6-digit OTP, promoting user to verified_contact = true', async () => {
      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('JOIN public.user_auth_providers p')) {
          return [
            {
              id: TEST_USER_ID,
              phone: TEST_PHONE,
              verified_contact: false,
              provider_subject: TEST_USER_ID,
              verified_at: null,
            },
          ];
        }
        if (sql.includes('UPDATE public.users')) {
          return [[], 1];
        }
        if (sql.includes('UPDATE public.user_auth_providers')) {
          return [[], 1];
        }
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: null,
              phone: TEST_PHONE,
              status: 'active',
              role: 'USER',
              verified_contact: true,
              profile_complete: false,
              linked_providers: ['phone'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const validJwt = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ properties: { hashed_token: 'hash-token-123' } }),
            {
              status: 200,
            },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: validJwt,
              refresh_token: 'ref-token-xyz',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        );

      const res = await authService.verifyPhone({
        phone: TEST_RAW_PHONE,
        code: '123456',
      });

      expect(res).toMatchObject({
        access_token: validJwt,
        refresh_token: 'ref-token-xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        user: expect.objectContaining({
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: true,
          status: 'active',
          linked_providers: ['phone'],
        }),
        profile_complete: false,
        next_step: 'profile_setup',
      });
      expect(approvals.approve).toHaveBeenCalledWith(
        expect.anything(),
        TEST_USER_ID,
        TEST_SESSION_ID,
        'email_verification',
      );
      expect(otpStore.verifyAndConsumeOtp).toHaveBeenCalledWith(
        TEST_USER_ID,
        TEST_PHONE,
        '123456',
        expect.any(Function),
        'verify_phone',
      );
    });

    it('rejects non-6-digit OTP code with 422 VALIDATION_FAILED', async () => {
      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '12345',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'VALIDATION_FAILED',
        }),
      });
    });

    it('rejects invalid or non-Bangladesh phone number with 422 INVALID_PHONE_NUMBER', async () => {
      await expect(
        authService.verifyPhone({
          phone: '+14155552671',
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'INVALID_PHONE_NUMBER',
        }),
      });
    });

    it('returns 410 VERIFICATION_CODE_EXPIRED when phone provider row is absent', async () => {
      database.query.mockResolvedValueOnce([]);

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 410,
        response: expect.objectContaining({
          code: 'VERIFICATION_CODE_EXPIRED',
        }),
      });
    });

    it('returns 409 ALREADY_VERIFIED when user contact is already verified', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: true,
          provider_subject: TEST_USER_ID,
          verified_at: new Date().toISOString(),
        },
      ]);

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'ALREADY_VERIFIED',
        }),
      });
    });

    it('returns 503 SERVICE_UNAVAILABLE when OtpSecretStore is missing or unconfigured', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      const authWithoutOtp = new AuthService(
        database as unknown as DatabaseService,
        config,
        abuse as unknown as AuthAbuseControl,
        approvals as unknown as SessionApprovalService,
        undefined,
        emailProvider as unknown as EmailRegistrationProvider,
      );

      await expect(
        authWithoutOtp.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });

    it('cleans up synthetic ephemeral email on GoTrue admin confirmation failure', async () => {
      database.query.mockResolvedValueOnce([
        {
          id: TEST_USER_ID,
          phone: TEST_PHONE,
          verified_contact: false,
          provider_subject: TEST_USER_ID,
          verified_at: null,
        },
      ]);

      const fetchMock = vi.mocked(globalThis.fetch);
      fetchMock.mockResolvedValueOnce(
        new Response('GoTrue down', { status: 500 }),
      );

      await expect(
        authService.verifyPhone({
          phone: TEST_PHONE,
          code: '123456',
        }),
      ).rejects.toMatchObject({
        status: 502,
        response: expect.objectContaining({
          code: 'PROVIDER_ERROR',
        }),
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`/admin/users/${TEST_USER_ID}`),
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining(
            `phone-${TEST_USER_ID}@synthetic.mentor`,
          ),
        }),
      );
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE auth.users SET email = NULL'),
        [TEST_USER_ID, `phone-${TEST_USER_ID}@synthetic.mentor`],
      );
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining(
          "DELETE FROM auth.identities WHERE user_id = $1 AND provider = 'email'",
        ),
        [TEST_USER_ID, `phone-${TEST_USER_ID}@synthetic.mentor`],
      );
    });
  });

  describe('2. EP-A10 OAuth Session Bootstrap (POST /auth/oauth/session)', () => {
    it('bootstraps Google OAuth session for user with confirmed email returning next_step = profile_setup', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'google' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: TEST_EMAIL,
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                provider: 'google',
                id: 'google-sub-1',
                identity_data: { sub: 'google-sub-1' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              status: 'active',
              role: 'USER',
              verified_contact: true,
              profile_complete: false,
              linked_providers: ['google'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const mockReq = {
        user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        headers: { authorization: authHeader },
      };

      const res = await authController.oauth(mockReq, {
        provider: 'google',
      });

      expect(res).toMatchObject({
        user: expect.objectContaining({
          id: TEST_USER_ID,
          verified_contact: true,
          status: 'active',
          linked_providers: ['google'],
        }),
        profile_complete: false,
        verified_contact_required: false,
        next_step: 'profile_setup',
      });
    });

    it('bootstraps Facebook OAuth session without verified email returning verified_contact = false and add_verified_contact next_step', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'facebook' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: null,
            email_confirmed_at: null,
            identities: [
              {
                provider: 'facebook',
                id: 'fb-sub-1',
                identity_data: { sub: 'fb-sub-1' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: null,
              phone: null,
              status: 'active',
              role: 'USER',
              verified_contact: false,
              profile_complete: false,
              linked_providers: ['facebook'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: null,
              experience_level: 'beginner',
              skills: [],
              learning_preference: 'visual',
              has_confirmed_goal: false,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const mockReq = {
        user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        headers: { authorization: authHeader },
      };

      const responsePayload = await authController.oauth(mockReq, {
        provider: 'facebook',
      });

      expect(responsePayload).toMatchObject({
        verified_contact_required: true,
        next_step: 'add_verified_contact',
        user: expect.objectContaining({
          verified_contact: false,
        }),
      });
    });

    it('bootstraps Google OAuth session for user with complete profile returning next_step = app_home', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'google' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: TEST_EMAIL,
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                provider: 'google',
                id: 'google-sub-complete',
                identity_data: { sub: 'google-sub-complete' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              status: 'active',
              role: 'USER',
              verified_contact: true,
              profile_complete: true,
              linked_providers: ['google'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role_title: 'Full Stack Engineer',
              experience_level: 'mid',
              existing_skills_none: true,
              self_reported_skill_ids: [],
              preferred_daily_hours: 2,
              learning_preference: 'mixed',
              timezone: 'Asia/Dhaka',
              has_confirmed_goal: true,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: true }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [{ id: 'roadmap-uuid-1' }];
        }
        return [];
      });

      const mockReq = {
        user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        headers: { authorization: authHeader },
      };

      const res = await authController.oauth(mockReq, {
        provider: 'google',
      });

      expect(res).toMatchObject({
        user: expect.objectContaining({
          id: TEST_USER_ID,
          verified_contact: true,
          status: 'active',
          linked_providers: ['google'],
        }),
        profile_complete: true,
        verified_contact_required: false,
        next_step: 'app_home',
      });
    });

    it('bootstraps OAuth session for suspended user preserving suspended status', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'oauth', provider: 'google' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: TEST_EMAIL,
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                provider: 'google',
                id: 'google-sub-suspended',
                identity_data: { sub: 'google-sub-suspended' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT u.id,u.email,u.phone,u.status')) {
          return [
            {
              id: TEST_USER_ID,
              email: TEST_EMAIL,
              phone: null,
              status: 'suspended',
              role: 'USER',
              verified_contact: true,
              profile_complete: true,
              linked_providers: ['google'],
            },
          ];
        }
        if (sql.includes('FROM public.user_profiles p')) {
          return [
            {
              user_id: TEST_USER_ID,
              current_role: 'Data Engineer',
              experience_level: 'senior',
              skills: ['Python', 'SQL'],
              learning_preference: 'documentation',
              has_confirmed_goal: true,
            },
          ];
        }
        if (sql.includes('effective_feature_access')) {
          return [{ enabled: false }];
        }
        if (sql.includes('FROM public.roadmaps')) {
          return [];
        }
        return [];
      });

      const mockReq = {
        user: { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        headers: { authorization: authHeader },
      };

      const res = await authController.oauth(mockReq, {
        provider: 'google',
      });

      expect(res).toMatchObject({
        user: expect.objectContaining({
          id: TEST_USER_ID,
          status: 'suspended',
        }),
      });
    });

    it('rejects unsupported provider with 422 PROVIDER_MISMATCH', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID)}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [{ provider: 'google', id: 'google-sub-1' }],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.bootstrap(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          'github' as unknown as 'google',
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });

    it('rejects token AMR mismatch when token was not authenticated via claimed provider', async () => {
      const authHeader = `Bearer ${createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
        {
          amr: [{ method: 'password' }],
        },
      )}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [{ provider: 'google', id: 'google-sub-1' }],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.bootstrap(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          'google',
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });
  });

  describe('3. EP-A11 Link Social Identity (POST /auth/identities/link)', () => {
    it('links Google social identity for authenticated user with verified contact and returns updated linked_providers', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            email: 'google-sync@example.com',
            email_confirmed_at: new Date().toISOString(),
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('provider_subject = $2')) {
          return [];
        }
        if (sql.includes('SELECT ARRAY(')) {
          return [{ linked_providers: ['phone', 'google'] }];
        }
        return [];
      });

      const res = await authService.linkIdentity(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { provider: 'google' },
      );

      expect(res).toEqual({
        linked_providers: ['phone', 'google'],
      });
    });

    it('links Facebook social identity for authenticated user with verified contact and returns updated linked_providers', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'fb-sub-789',
                provider: 'facebook',
                identity_data: { sub: 'fb-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('provider_subject = $2')) {
          return [];
        }
        if (sql.includes('SELECT ARRAY(')) {
          return [{ linked_providers: ['phone', 'facebook'] }];
        }
        return [];
      });

      const res = await authService.linkIdentity(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { provider: 'facebook' },
      );

      expect(res).toEqual({
        linked_providers: ['phone', 'facebook'],
      });
    });

    it('rejects linking with 403 VERIFIED_CONTACT_REQUIRED when user verified_contact is false', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockResolvedValueOnce([{ verified_contact: false }]);

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: 'VERIFIED_CONTACT_REQUIRED',
        }),
      });
    });

    it('rejects linking with 422 PROVIDER_MISMATCH when provider identity is missing from GoTrue user identities', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [],
          }),
          { status: 200 },
        ),
      );

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 422,
        response: expect.objectContaining({
          code: 'PROVIDER_MISMATCH',
        }),
      });
    });

    it('rejects linking with 409 IDENTITY_LINK_CONFLICT when social identity belongs to another account', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT verified_contact FROM public.users')) {
          return [{ verified_contact: true }];
        }
        if (sql.includes('provider_subject = $2')) {
          return [{ user_id: '99999999-9999-9999-9999-999999999999' }];
        }
        return [];
      });

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'IDENTITY_LINK_CONFLICT',
        }),
      });
    });

    it('translates database unique constraint race (23505) into 409 IDENTITY_LINK_CONFLICT', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: TEST_USER_ID,
            identities: [
              {
                id: 'google-sub-789',
                provider: 'google',
                identity_data: { sub: 'google-sub-789' },
              },
            ],
          }),
          { status: 200 },
        ),
      );

      const driverError = new Error(
        'duplicate key value violates unique constraint',
      );
      (driverError as unknown as Record<string, unknown>).code = '23505';
      const constraintError = new QueryFailedError(
        'INSERT ...',
        [],
        driverError,
      );

      database.transaction.mockRejectedValueOnce(constraintError);

      await expect(
        authService.linkIdentity(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'IDENTITY_LINK_CONFLICT',
        }),
      });
    });

    it('rejects unauthenticated request with 401 AUTH_REQUIRED', async () => {
      await expect(
        authService.linkIdentity(
          null as unknown as { sub: string; sessionId: string },
          undefined,
          { provider: 'google' },
        ),
      ).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({
          code: 'AUTH_REQUIRED',
        }),
      });
    });
  });

  describe('4. EP-A12 Add Contact (POST /auth/contact)', () => {
    it('successfully adds unverified email contact, reserves quota, and dispatches OTP challenge returning 202 Accepted', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: false }];
        }
        if (
          sql.includes(
            'SELECT id FROM public.users WHERE lower(email::text) = $1',
          )
        ) {
          return [];
        }
        if (
          sql.includes(
            "SELECT user_id FROM public.user_auth_providers WHERE provider = 'email'",
          )
        ) {
          return [];
        }
        if (
          sql.includes(
            'SELECT contact_value, verified_at FROM public.user_auth_providers',
          )
        ) {
          return [];
        }
        return [];
      });

      const res = await authService.addContact(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { channel: 'email', contact: TEST_EMAIL },
        createMockRequest(),
      );

      expect(res).toMatchObject({
        verification_channel: 'email',
        contact_masked: 'p****@example.com',
      });
      expect(abuse.reserveSend).toHaveBeenCalledWith(
        { channel: 'email', identifier: TEST_EMAIL },
        '127.0.0.1',
      );
      expect(emailProvider.sendChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_USER_ID,
          email: TEST_EMAIL,
        }),
      );
    });

    it('fails closed with 503 SERVICE_UNAVAILABLE when phone contact is requested while SMS is disabled', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'phone', contact: TEST_PHONE },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 503,
        response: expect.objectContaining({
          code: 'SERVICE_UNAVAILABLE',
        }),
      });
    });

    it('rejects with 409 ALREADY_VERIFIED when user account already has a verified contact', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: true }];
        }
        return [];
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'ALREADY_VERIFIED',
        }),
      });
    });

    it('rejects with 409 CONTACT_ALREADY_REGISTERED when email contact belongs to another user', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      database.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT pg_advisory_xact_lock')) {
          return [];
        }
        if (
          sql.includes(
            'SELECT verified_contact FROM public.users WHERE id = $1',
          )
        ) {
          return [{ verified_contact: false }];
        }
        if (
          sql.includes(
            'SELECT id FROM public.users WHERE lower(email::text) = $1',
          )
        ) {
          return [{ id: '99999999-9999-9999-9999-999999999999' }];
        }
        return [];
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          code: 'CONTACT_ALREADY_REGISTERED',
        }),
      });
    });

    it('enforces R31 abuse control rate limit (429 RESEND_COOLDOWN_ACTIVE) on add contact', async () => {
      const token = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${token}`;

      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      abuse.reserveSend.mockImplementationOnce(async () => {
        fail(429, 'RESEND_COOLDOWN_ACTIVE', 'Cooldown active', [], true, 60);
      });

      await expect(
        authService.addContact(
          { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
          authHeader,
          { channel: 'email', contact: TEST_EMAIL },
          createMockRequest(),
        ),
      ).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({
          code: 'RESEND_COOLDOWN_ACTIVE',
        }),
      });
    });
  });

  describe('5. ApiExceptionFilter Single Envelope Serialization', () => {
    it('serializes 403 VERIFIED_CONTACT_REQUIRED into canonical single envelope', () => {
      const filter = new ApiExceptionFilter();
      const setHeaderFn = vi.fn();
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });

      const mockResponse = {
        status: statusFn,
        setHeader: setHeaderFn,
        getHeader: vi.fn().mockReturnValue('req-phone-identity-1'),
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      try {
        fail(403, 'VERIFIED_CONTACT_REQUIRED', 'Verified contact required');
      } catch (err: unknown) {
        filter.catch(err, mockHost);
      }

      expect(statusFn).toHaveBeenCalledWith(403);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'VERIFIED_CONTACT_REQUIRED',
            message: 'Verified contact required',
            requestId: 'req-phone-identity-1',
          }),
        }),
      );
    });

    it('serializes 409 IDENTITY_LINK_CONFLICT into canonical single envelope', () => {
      const filter = new ApiExceptionFilter();
      const setHeaderFn = vi.fn();
      const jsonFn = vi.fn();
      const statusFn = vi.fn().mockReturnValue({ json: jsonFn });

      const mockResponse = {
        status: statusFn,
        setHeader: setHeaderFn,
        getHeader: vi.fn().mockReturnValue('req-phone-identity-2'),
      };

      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
        }),
      } as unknown as ArgumentsHost;

      try {
        fail(
          409,
          'IDENTITY_LINK_CONFLICT',
          'Identity belongs to another account',
        );
      } catch (err: unknown) {
        filter.catch(err, mockHost);
      }

      expect(statusFn).toHaveBeenCalledWith(409);
      expect(jsonFn).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: 'IDENTITY_LINK_CONFLICT',
            message: 'Identity belongs to another account',
            requestId: 'req-phone-identity-2',
          }),
        }),
      );
    });
  });

  describe('6. M02-04 Secondary-Contact Lifecycle (EP-A12 -> EP-A04 -> EP-A02 for Unverified OAuth User)', () => {
    it('completes addContact (EP-A12) -> resend-verification (EP-A04) -> verify-email (EP-A02) when Facebook is already primary', async () => {
      const oauthToken = createSyntheticJwt(TEST_USER_ID, TEST_SESSION_ID);
      const authHeader = `Bearer ${oauthToken}`;
      const secondaryEmail = 'fb-secondary@example.com';

      const state = {
        verifiedContact: false,
        email: null as string | null,
        providers: [
          {
            user_id: TEST_USER_ID,
            provider: 'facebook',
            provider_subject: 'fb-subject-1',
            contact_value: null as string | null,
            verified_at: null as string | null,
            is_primary: true,
          },
        ],
      };

      const findByEmailMock = vi.fn(async (lookupEmail: string) => {
        const providerRow = state.providers.find(
          (p) =>
            p.provider === 'email' &&
            p.contact_value?.toLowerCase() === lookupEmail.toLowerCase(),
        );
        if (
          !providerRow &&
          state.email?.toLowerCase() !== lookupEmail.toLowerCase()
        ) {
          return null;
        }
        return {
          id: TEST_USER_ID,
          subject: TEST_USER_ID,
          email: (
            providerRow?.contact_value ??
            state.email ??
            lookupEmail
          ).toLowerCase(),
          verified: state.verifiedContact,
        };
      });

      const emailRegService = new EmailRegistrationService(
        {
          ready: emailProvider.ready,
          findByEmail: findByEmailMock,
          createPending: vi.fn(),
          sendChallenge: emailProvider.sendChallenge,
        } as unknown as EmailRegistrationProvider,
        {
          reserveSend: vi.fn(async () => ({ retryAfterSeconds: 60 })),
        } as unknown as AuthAbuseControl,
        database as unknown as DatabaseService,
        config,
      );

      database.query.mockImplementation(
        async (sql: string, args: unknown[] = []) => {
          if (sql.includes('pg_advisory_xact_lock')) {
            return [];
          }
          if (
            sql.includes(
              'SELECT verified_contact FROM public.users WHERE id = $1',
            )
          ) {
            return [{ verified_contact: state.verifiedContact }];
          }
          if (
            sql.includes(
              'SELECT verified_contact,email,phone FROM public.users WHERE id=$1',
            )
          ) {
            return [
              {
                verified_contact: state.verifiedContact,
                email: state.email,
                phone: null,
              },
            ];
          }
          if (
            sql.includes('FROM public.users WHERE lower(email::text) = $1') ||
            sql.includes('SELECT id FROM public.users WHERE email=$1')
          ) {
            return [];
          }
          if (
            (sql.includes('FROM public.user_auth_providers') &&
              sql.includes('user_id <> $2')) ||
            sql.includes('user_id<>$2')
          ) {
            return [];
          }
          if (
            sql.includes('SELECT contact_value, verified_at') &&
            sql.includes("WHERE user_id = $1 AND provider = 'email'")
          ) {
            const row = state.providers.find((p) => p.provider === 'email');
            return row ? [row] : [];
          }
          if (sql.includes('INSERT INTO public.user_auth_providers')) {
            const primaryProvider = state.providers.find((p) => p.is_primary);
            const hasPrimary = Boolean(primaryProvider);
            assertNoDuplicatePrimaryProvider(
              sql,
              args,
              hasPrimary,
              primaryProvider?.provider,
            );
            const existingEmail = state.providers.find(
              (p) => p.provider === 'email',
            );
            if (existingEmail) {
              existingEmail.provider_subject = String(args[1]);
              existingEmail.contact_value = String(args[2]);
            } else {
              state.providers.push({
                user_id: String(args[0]),
                provider: 'email',
                provider_subject: String(args[1]),
                contact_value: String(args[2]),
                verified_at: null,
                is_primary: resolveInsertedPrimaryFlag(sql, hasPrimary),
              });
            }
            return [];
          }
          if (
            sql.includes('SELECT provider_subject,contact_value,verified_at')
          ) {
            const row = state.providers.find((p) => p.provider === 'email');
            return row ? [row] : [];
          }
          if (
            sql.includes(
              'SELECT u.id, u.email, u.verified_contact, p.provider_subject, p.verified_at',
            )
          ) {
            const row = state.providers.find((p) => p.provider === 'email');
            return row
              ? [
                  {
                    id: TEST_USER_ID,
                    email: state.email,
                    verified_contact: state.verifiedContact,
                    provider_subject: row.provider_subject,
                    verified_at: row.verified_at,
                  },
                ]
              : [];
          }
          if (
            sql.includes(
              'SELECT id, status, email, verified_contact FROM public.users WHERE id = $1',
            )
          ) {
            return [
              {
                id: TEST_USER_ID,
                status: 'active',
                email: state.email,
                verified_contact: state.verifiedContact,
              },
            ];
          }
          if (
            sql.includes(
              'SELECT id, contact_value, provider_subject, verified_at',
            )
          ) {
            const row = state.providers.find((p) => p.provider === 'email');
            return row ? [{ id: 'prov-email-1', ...row }] : [];
          }
          if (
            sql.includes('UPDATE public.users') &&
            sql.includes('SET email = $1, verified_contact = true')
          ) {
            state.email = String(args[0]);
            state.verifiedContact = true;
            return [[], 1];
          }
          if (
            sql.includes('UPDATE public.user_auth_providers') &&
            sql.includes('SET verified_at = now()')
          ) {
            const row = state.providers.find((p) => p.provider === 'email');
            if (row) row.verified_at = new Date().toISOString();
            return [[], 1];
          }
          if (
            sql.includes(
              'SELECT u.id,u.email,u.phone,u.status,u.verified_contact',
            )
          ) {
            return [
              {
                id: TEST_USER_ID,
                email: state.email,
                phone: null,
                status: 'active',
                role: 'USER',
                verified_contact: state.verifiedContact,
                linked_providers: state.providers.map((p) => p.provider).sort(),
              },
            ];
          }
          if (sql.includes('FROM public.user_profiles p')) {
            return [
              {
                user_id: TEST_USER_ID,
                current_role_title: null,
                experience_level: null,
                existing_skills_none: false,
                self_reported_skill_ids: [],
                preferred_daily_hours: null,
                learning_preference: null,
                timezone: 'Asia/Dhaka',
                has_confirmed_goal: false,
              },
            ];
          }
          if (sql.includes('effective_feature_access')) {
            return [{ enabled: false }];
          }
          if (sql.includes('FROM public.roadmaps')) {
            return [];
          }
          return [];
        },
      );

      // Step 1: EP-A12 addContact stages unverified email row with is_primary = false
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
      );

      const addResult = await authService.addContact(
        { sub: TEST_USER_ID, sessionId: TEST_SESSION_ID },
        authHeader,
        { channel: 'email', contact: secondaryEmail },
        createMockRequest(),
      );

      expect(addResult).toMatchObject({
        verification_channel: 'email',
        contact_masked: 'f****@example.com',
        expires_in_seconds: 600,
      });
      expect(state.providers).toEqual([
        expect.objectContaining({ provider: 'facebook', is_primary: true }),
        expect.objectContaining({
          provider: 'email',
          contact_value: secondaryEmail,
          verified_at: null,
          is_primary: false,
        }),
      ]);

      // Step 2: EP-A04 resend-verification succeeds without primary-provider conflict and dispatches challenge
      emailProvider.sendChallenge.mockClear();
      const resendResult = await emailRegService.resend(
        { channel: 'email', contact: secondaryEmail },
        createMockRequest(),
      );

      expect(resendResult).toMatchObject({
        verification_channel: 'email',
        contact_masked: 'f****@example.com',
        expires_in_seconds: 600,
      });
      expect(findByEmailMock).toHaveBeenCalledWith(
        secondaryEmail,
        expect.any(AbortSignal),
      );
      expect(emailProvider.sendChallenge).toHaveBeenCalledWith(
        expect.objectContaining({
          id: TEST_USER_ID,
          email: secondaryEmail,
          verified: false,
        }),
        expect.any(AbortSignal),
      );

      // Step 3: EP-A02 verify-email confirms secondary contact and mints approved session
      const mintedAccessToken = createSyntheticJwt(
        TEST_USER_ID,
        TEST_SESSION_ID,
      );
      vi.mocked(globalThis.fetch)
        // 1) confirmGoTrueUser PUT /auth/v1/admin/users/:id
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ id: TEST_USER_ID }), { status: 200 }),
        )
        // 2) generate_link POST /auth/v1/admin/generate_link
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ hashed_token: 'hash-123' }), {
            status: 200,
          }),
        )
        // 3) verify POST /auth/v1/verify
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: mintedAccessToken,
              refresh_token: 'minted-refresh-token',
              expires_in: 3600,
              token_type: 'bearer',
            }),
            { status: 200 },
          ),
        );

      const verifyResult = await authService.verifyEmail(
        { email: secondaryEmail, code: '123456' },
        createMockRequest(),
      );

      expect(verifyResult).toMatchObject({
        access_token: mintedAccessToken,
        refresh_token: 'minted-refresh-token',
        user: expect.objectContaining({
          id: TEST_USER_ID,
          email: secondaryEmail,
          verified_contact: true,
          linked_providers: ['email', 'facebook'],
        }),
        next_step: 'profile_setup',
      });
    });
  });

  describe('7. Primary Provider Conflict Helper & is_primary Resolution', () => {
    it('accurately detects hardcoded true is_primary insert (with lower($2) and reordered columns) and resolves flag', () => {
      const sqlWithLower = `INSERT INTO public.user_auth_providers (user_id, provider, provider_subject, contact_value, verified_at, is_primary) VALUES ($1, 'email', lower($2), $3, NULL, true)`;
      const sqlReordered = `INSERT INTO public.user_auth_providers (is_primary, user_id, provider) VALUES (true, $1, 'email')`;
      const sqlWithNotExists = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', NOT EXISTS(SELECT 1 FROM public.user_auth_providers WHERE user_id=$1 AND is_primary=true))`;
      const sqlWithLowerNotExists = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', not exists (select 1 from public.user_auth_providers where user_id=$1 and is_primary=true))`;
      const sqlOnConflictReturning = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', true) ON CONFLICT (user_id, provider) DO UPDATE SET is_primary = EXCLUDED.is_primary RETURNING id`;
      const sqlOtherColTrue = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary, is_verified) VALUES ($1, 'email', false, true)`;
      const sqlUnrelated = `INSERT INTO public.users (id, is_primary) VALUES ($1, true)`;
      const sqlFalse = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', false)`;
      const sqlQuoted = `INSERT INTO public.user_auth_providers ("user_id", "provider", "is_primary") VALUES ($1, 'email', true)`;
      const sqlNotExistsElsewhere = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', true) ON CONFLICT (user_id, provider) DO UPDATE SET is_primary = true WHERE NOT EXISTS (SELECT 1 FROM other_table)`;
      const sqlCompoundNotExists = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', true AND NOT EXISTS (SELECT 1 FROM other_table))`;
      const sqlMultilineNotExists = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, 'email', \n  NOT EXISTS (SELECT 1 FROM public.user_auth_providers WHERE user_id=$1 AND is_primary=true))`;
      const sqlStringWithCommasAndParens = `INSERT INTO public.user_auth_providers (user_id, provider, contact_value, is_primary) VALUES ($1, 'email', 'user(alias),test@example.invalid', true)`;
      const sqlStringWithBackslash = `INSERT INTO public.user_auth_providers (user_id, provider, contact_value, is_primary) VALUES ($1, 'email', 'folder\\path\\', true)`;
      const sqlStringWithDoubledQuotes = `INSERT INTO public.user_auth_providers (user_id, provider, contact_value, is_primary) VALUES ($1, 'email', 'O''Reilly', true)`;
      const sqlParamOnConflict = `INSERT INTO public.user_auth_providers (user_id, provider, is_primary) VALUES ($1, $2, true) ON CONFLICT (user_id, provider) DO UPDATE SET is_primary = EXCLUDED.is_primary`;
      const sqlIsPrimaryInCommentOnly = `INSERT INTO public.user_auth_providers (user_id, provider) VALUES ($1, 'email') /* is_primary = true */`;

      expect(detectHardcodedPrimaryInsert(sqlWithLower)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlReordered)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlQuoted)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlNotExistsElsewhere)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlOnConflictReturning)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlStringWithCommasAndParens)).toBe(
        true,
      );
      expect(detectHardcodedPrimaryInsert(sqlStringWithBackslash)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlStringWithDoubledQuotes)).toBe(
        true,
      );
      expect(detectHardcodedPrimaryInsert(sqlParamOnConflict)).toBe(true);
      expect(detectHardcodedPrimaryInsert(sqlIsPrimaryInCommentOnly)).toBe(
        false,
      );
      expect(detectHardcodedPrimaryInsert(sqlWithNotExists)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlWithLowerNotExists)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlMultilineNotExists)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlCompoundNotExists)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlOtherColTrue)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlUnrelated)).toBe(false);
      expect(detectHardcodedPrimaryInsert(sqlFalse)).toBe(false);

      expect(resolveInsertedPrimaryFlag(sqlWithLower, false)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlWithLower, true)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlQuoted, false)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlQuoted, true)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlNotExistsElsewhere, false)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlNotExistsElsewhere, true)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlOnConflictReturning, false)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlOnConflictReturning, true)).toBe(
        true,
      );
      expect(
        resolveInsertedPrimaryFlag(sqlStringWithCommasAndParens, false),
      ).toBe(true);
      expect(
        resolveInsertedPrimaryFlag(sqlStringWithCommasAndParens, true),
      ).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlStringWithBackslash, false)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlStringWithBackslash, true)).toBe(
        true,
      );
      expect(
        resolveInsertedPrimaryFlag(sqlStringWithDoubledQuotes, false),
      ).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlStringWithDoubledQuotes, true)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlParamOnConflict, false)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlParamOnConflict, true)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlIsPrimaryInCommentOnly, false)).toBe(
        false,
      );
      expect(resolveInsertedPrimaryFlag(sqlIsPrimaryInCommentOnly, true)).toBe(
        false,
      );
      expect(resolveInsertedPrimaryFlag(sqlWithNotExists, false)).toBe(true);
      expect(resolveInsertedPrimaryFlag(sqlWithNotExists, true)).toBe(false);
      expect(resolveInsertedPrimaryFlag(sqlWithLowerNotExists, false)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlWithLowerNotExists, true)).toBe(
        false,
      );
      expect(resolveInsertedPrimaryFlag(sqlMultilineNotExists, false)).toBe(
        true,
      );
      expect(resolveInsertedPrimaryFlag(sqlMultilineNotExists, true)).toBe(
        false,
      );
      expect(resolveInsertedPrimaryFlag(sqlOtherColTrue, false)).toBe(false);
      expect(resolveInsertedPrimaryFlag(sqlOtherColTrue, true)).toBe(false);
      expect(resolveInsertedPrimaryFlag(sqlFalse, false)).toBe(false);

      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlWithLower, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlWithLower, [], false),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlQuoted, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlNotExistsElsewhere, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlOnConflictReturning, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(
          sqlStringWithCommasAndParens,
          [],
          true,
        ),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlStringWithBackslash, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlStringWithDoubledQuotes, [], true),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(
          sqlOnConflictReturning,
          [],
          true,
          'email',
        ),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(
          sqlOnConflictReturning,
          [],
          true,
          'phone',
        ),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(
          sqlParamOnConflict,
          ['user-1', 'email'],
          true,
          'email',
        ),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(
          sqlParamOnConflict,
          ['user-1', 'email'],
          true,
          'google',
        ),
      ).toThrowError(QueryFailedError);
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlIsPrimaryInCommentOnly, [], true),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlWithNotExists, [], true),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlWithLowerNotExists, [], true),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlMultilineNotExists, [], true),
      ).not.toThrow();
      expect(() =>
        assertNoDuplicatePrimaryProvider(sqlOtherColTrue, [], true),
      ).not.toThrow();
    });
  });
});
