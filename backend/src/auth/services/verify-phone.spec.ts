import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service.js';

describe('AuthService - verifyPhone (EP-A03)', () => {
  let service: AuthService;
  let mockConfig: any;
  let mockDb: any;
  let mockAbuse: any;
  let mockApprovals: any;
  let mockOtpStore: any;

  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '22222222-2222-4222-8222-222222222222';
  const phone = '+8801712345678';

  const makeJwt = (sub: string, sid: string) => {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString(
      'base64url',
    );
    const payload = Buffer.from(
      JSON.stringify({
        sub,
        session_id: sid,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    ).toString('base64url');
    return `${header}.${payload}.sig`;
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'SUPABASE_SERVICE_ROLE_KEY') return 'service-role-key';
        return undefined;
      }),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'SUPABASE_URL') return 'http://127.0.0.1:56321';
        if (key === 'SUPABASE_ANON_KEY') return 'anon-key';
        throw new Error(`Missing config: ${key}`);
      }),
    };

    mockDb = {
      query: vi.fn(),
      transaction: vi.fn(
        async (_uid: string, cb: (em: any) => Promise<any>) => {
          return cb(mockDb);
        },
      ),
    };

    mockAbuse = {};
    mockApprovals = {
      approve: vi.fn().mockResolvedValue(undefined),
    };
    mockOtpStore = {
      verifyAndConsumeOtp: vi.fn(
        async (
          _uid: string,
          _contact: string,
          _code: string,
          onValid?: () => Promise<void>,
        ) => {
          if (onValid) await onValid();
        },
      ),
    };

    service = new AuthService(
      mockDb,
      mockConfig,
      mockAbuse,
      mockApprovals,
      mockOtpStore,
    );
  });

  const setupDbUserLookups = (verified = false, profileComplete = false) => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN public.user_auth_providers p')) {
        return [
          {
            id: userId,
            phone,
            verified_contact: verified,
            provider_subject: userId,
            verified_at: verified ? new Date().toISOString() : null,
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
            id: userId,
            email: null,
            phone,
            status: 'active',
            verified_contact: true,
            role: 'USER',
            linked_providers: ['phone'],
          },
        ];
      }
      if (sql.includes('FROM public.user_profiles p')) {
        if (profileComplete) {
          return [
            {
              user_id: userId,
              display_name: 'Rahim',
              current_role: 'Student',
              experience_level: 'beginner',
              education: 'BSc',
              preferred_language: 'en',
              learning_preference: 'mixed',
              timezone: 'Asia/Dhaka',
              preferred_daily_hours: 2,
              self_reported_skill_ids: [],
              existing_skills_none: true,
              has_confirmed_goal: true,
            },
          ];
        }
        return [
          {
            user_id: userId,
            has_confirmed_goal: false,
          },
        ];
      }
      if (sql.includes('private.effective_feature_access')) {
        return [{ enabled: true }];
      }
      if (sql.includes('FROM public.roadmaps')) {
        return [];
      }
      return [];
    });
  };

  it('verifies phone (including local 017... normalization), confirms GoTrue phone_confirm, commits DB rows, and mints approved session', async () => {
    setupDbUserLookups(false, false);

    const validJwt = makeJwt(userId, sessionId);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: userId }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ properties: { hashed_token: 'hash-123' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: validJwt,
            refresh_token: 'ref-456',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    const result = await service.verifyPhone({
      phone: '01712345678',
      code: '123456',
    });

    expect(result).toEqual({
      access_token: validJwt,
      refresh_token: 'ref-456',
      expires_in: 3600,
      token_type: 'Bearer',
      user: {
        id: userId,
        email: null,
        phone,
        status: 'active',
        verified_contact: true,
        role: 'USER',
        linked_providers: ['phone'],
      },
      profile_complete: false,
      next_step: 'profile_setup',
    });

    expect(mockOtpStore.verifyAndConsumeOtp).toHaveBeenCalledWith(
      userId,
      phone,
      '123456',
      expect.any(Function),
      'verify_phone',
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      `http://127.0.0.1:56321/auth/v1/admin/users/${userId}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          phone_confirm: true,
          email: `phone-${userId}@synthetic.mentor`,
          email_confirm: true,
        }),
      }),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:56321/auth/v1/admin/generate_link',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          type: 'magiclink',
          email: `phone-${userId}@synthetic.mentor`,
        }),
      }),
    );
    expect(mockApprovals.approve).toHaveBeenCalledWith(
      mockDb,
      userId,
      sessionId,
      'email_verification',
    );
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SET email = NULL'),
      expect.anything(),
    );
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM auth.identities'),
      expect.anything(),
    );
  });

  it('returns 409 ALREADY_VERIFIED when user is already verified', async () => {
    setupDbUserLookups(true, false);

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'ALREADY_VERIFIED',
      }),
    });
    expect(mockOtpStore.verifyAndConsumeOtp).not.toHaveBeenCalled();
  });

  it('returns 410 VERIFICATION_CODE_EXPIRED when phone user is not found', async () => {
    mockDb.query.mockResolvedValueOnce([]);

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 410,
      response: expect.objectContaining({
        code: 'VERIFICATION_CODE_EXPIRED',
      }),
    });
  });

  it('returns 503 SERVICE_UNAVAILABLE when OtpSecretStore is missing', async () => {
    setupDbUserLookups(false, false);
    const serviceWithoutOtp = new AuthService(
      mockDb,
      mockConfig,
      mockAbuse,
      mockApprovals,
      undefined,
    );

    await expect(
      serviceWithoutOtp.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({
        code: 'SERVICE_UNAVAILABLE',
      }),
    });
  });

  it('rolls back with 409 ALREADY_VERIFIED if concurrent verification updates 0 rows', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN public.user_auth_providers p')) {
        return [
          {
            id: userId,
            phone,
            verified_contact: false,
            provider_subject: userId,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('UPDATE public.users')) {
        return [[], 0];
      }
      if (sql.includes('UPDATE public.user_auth_providers')) {
        return [[], 1];
      }
      return [];
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: userId }), { status: 200 }),
    );

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: 'ALREADY_VERIFIED',
      }),
    });
  });

  it('treats GoTrue 422 already confirmed as idempotent success during retry', async () => {
    setupDbUserLookups(false, false);
    const validJwt = makeJwt(userId, sessionId);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ msg: 'Phone already confirmed' }), {
          status: 422,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hashed_token: 'hash-123' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: validJwt,
            refresh_token: 'ref-456',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    const result = await service.verifyPhone({ phone, code: '123456' });
    expect(result.access_token).toBe(validJwt);
  });

  it('maps GoTrue phone_confirm timeout to 504 PROVIDER_TIMEOUT before consuming OTP', async () => {
    setupDbUserLookups(false, false);
    const timeoutErr = new Error('The operation timed out');
    timeoutErr.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(timeoutErr);

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 504,
      response: expect.objectContaining({
        code: 'PROVIDER_TIMEOUT',
        retryable: true,
      }),
    });
  });

  it('proceeds to Step 4 session minting if OTP consumption fails after DB commit', async () => {
    setupDbUserLookups(false, false);
    const validJwt = makeJwt(userId, sessionId);

    mockOtpStore.verifyAndConsumeOtp.mockImplementationOnce(
      async (
        _uid: string,
        _contact: string,
        _code: string,
        onValid?: () => Promise<void>,
      ) => {
        if (onValid) await onValid();
        throw new Error('Redis post-commit delete blip');
      },
    );

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: userId }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ hashed_token: 'hash-123' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: validJwt,
            refresh_token: 'ref-456',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    const result = await service.verifyPhone({ phone, code: '123456' });
    expect(result.access_token).toBe(validJwt);
  });

  it('returns non-retryable error with sign-in message if Step 4 session minting fails after commit', async () => {
    setupDbUserLookups(false, false);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: userId }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ msg: 'Upstream error' }), {
          status: 500,
        }),
      );

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        code: 'PROVIDER_ERROR',
        message:
          'Account is verified; sign in with your phone and password to start your session',
        retryable: false,
      }),
    });
  });

  it('preserves deterministic synthetic phone email when generate_link or /auth/v1/verify fails after verifyPhone commit', async () => {
    setupDbUserLookups(false, false);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: userId }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ msg: 'generate_link failed' }), {
          status: 500,
        }),
      );

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        code: 'PROVIDER_ERROR',
        message:
          'Account is verified; sign in with your phone and password to start your session',
        retryable: false,
      }),
    });

    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SET email = NULL'),
      expect.anything(),
    );
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM auth.identities'),
      expect.anything(),
    );
  });

  it('cleans up synthetic phone email and logs error when uncommitted OTP verification rolls back after GoTrue confirm', async () => {
    mockDb.query.mockImplementation(async (sql: string) => {
      if (sql.includes('JOIN public.user_auth_providers p')) {
        return [
          {
            id: userId,
            phone,
            verified_contact: false,
            provider_subject: userId,
            verified_at: null,
          },
        ];
      }
      if (sql.includes('UPDATE public.users')) return [[], 1];
      if (sql.includes('UPDATE public.user_auth_providers')) return [[], 0];
      if (sql.includes('UPDATE auth.users')) {
        throw new Error('Database socket closed during cleanup');
      }
      return [];
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ id: userId }), { status: 200 }),
    );
    const loggerErrorSpy = vi.spyOn((service as any).logger, 'error');

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: 'ALREADY_VERIFIED' }),
    });

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      `Failed to clean up synthetic phone email for user ${userId}`,
      expect.stringContaining('Database socket closed during cleanup'),
    );
  });

  it('preserves deterministic synthetic phone email when approvals.approve fails inside session transaction', async () => {
    setupDbUserLookups(false, false);
    const validJwt = makeJwt(userId, sessionId);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: userId }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ properties: { hashed_token: 'hash_123' } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: validJwt,
            refresh_token: 'ref_123',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );

    mockApprovals.approve.mockRejectedValueOnce(
      new Error('Approval store connection error'),
    );

    await expect(
      service.verifyPhone({ phone, code: '123456' }),
    ).rejects.toMatchObject({
      status: 502,
      response: expect.objectContaining({
        code: 'PROVIDER_ERROR',
        message:
          'Account is verified; sign in with your phone and password to start your session',
        retryable: false,
      }),
    });

    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('SET email = NULL'),
      expect.anything(),
    );
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM auth.identities'),
      expect.anything(),
    );
  });

  it('does NOT run synthetic phone email cleanup when verifyAndConsumeOtp rejects before callback runs', async () => {
    setupDbUserLookups(false, false);

    mockOtpStore.verifyAndConsumeOtp.mockRejectedValueOnce(
      new HttpException(
        {
          code: 'VERIFICATION_CODE_INVALID',
          message: 'Invalid verification code',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
    );

    await expect(
      service.verifyPhone({ phone, code: '000000' }),
    ).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: 'VERIFICATION_CODE_INVALID',
      }),
    });

    expect(mockDb.query).not.toHaveBeenCalledWith(
      'UPDATE auth.users SET email = NULL, email_confirmed_at = NULL WHERE id = $1 AND email = $2',
      expect.anything(),
    );
    expect(mockDb.query).not.toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM auth.identities'),
      expect.anything(),
    );
  });
});
