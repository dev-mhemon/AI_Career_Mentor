import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loginUser,
  approveOAuthSession,
  registerUser,
  resendVerification,
  verifyPhone,
  syncUser,
  logoutUser,
  refreshSession,
  forgotPassword,
  resetPassword,
  linkSocialIdentity,
  addContact,
  getMe,
  getCurrentUserState,
  DEFAULT_AUTH_STATE_TIMEOUT_MS,
  getProfile,
  updateProfile,
  updateLearningSettings,
  updatePreferences,
  updateSkills,
  interpretSkillAlias,
  createCareerGoal,
  listCareerGoals,
  getCareerGoal,
  submitGoalClarification,
  confirmCareerGoal,
  updateCareerGoal,
  deleteCareerGoal,
  dispatchM05Operation,  requestAccountDeletion,
  getAccountDeletionStatus,
  getJobStatus,
  withIdempotencyKey,
  createIdempotencyKey,
  generateRoadmap,
  listRoadmaps,
  getRoadmap,
  reviseRoadmap,
  lockRoadmap,
  listRoadmapVersions,
  getRoadmapVersion,
  createRoadmapMerge,
  listRoadmapMerges,
  getRoadmapMerge,
  acceptRoadmapMerge,
  rejectRoadmapMerge,
  undoLastRoadmapMerge,
  focusRoadmap,
  archiveRoadmap,
  getDailyPlan,
  createDailyPlan,
  rebuildDailyPlan,
  getToday,
  listLearningTopics,
  getLearningTopic,
  listLearningResources,
  generateQuiz,
  getQuizAttempt,
  startQuizAttempt,
  patchQuizAnswers,
  submitQuizAttempt,
  getQuizResult,
  retryQuizAttempt,
  listPracticeReviews,
  getPracticeReviewFeedback,
  retryPracticeReview,
  getProgress,
  getSkillProgressDetail,
  getProgressHistory,
  createMentorConversation,
  listMentorConversations,
  sendMentorMessage,
  getMentorHistory,
  listTechnologyUpdates,
  getTechnologyUpdate,
  markTechnologyUpdateViewed,
  listAdminUsers,
  getAdminUser,
  updateAdminUserStatus,
  listAdminFeatures,
  updateGlobalFeature,
  updateUserFeatureOverride,
  listAdminAuditLogs,
  getAdminUsage,
  isJobAcceptedDTO,
  type DailyPlanResponseDTO,
  type JobKind,
  type TodayResponseDTO,
  type TopicDetailDTO,
  ApiError,
  UnauthorizedError,
  NetworkError,
} from '@/lib/api/client';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Set the required env var
vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3000/api/v1');

const MOCK_TOKEN = 'mock-access-token';

const MOCK_USER_RESPONSE = {
  id: 'uuid-1',
  email: 'test@example.com',
  phone: null,
  role: 'USER' as const,
  status: 'active' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe('API Client', () => {
  it('calls backend EP-A05 without an Authorization header', async () => {
    const session = {
      access_token: 'approved-access',
      refresh_token: 'approved-refresh',
      expires_in: 3600,
      token_type: 'Bearer' as const,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: session }),
    });

    await expect(loginUser('test@example.com', 'password123')).resolves.toEqual(session);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('preserves the complete EP-A10 OAuth routing response', async () => {
    const response = {
      user: { ...MOCK_USER_RESPONSE, verified_contact: false, linked_providers: ['google'] },
      profile_complete: false,
      verified_contact_required: true,
      next_step: 'add_verified_contact' as const,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: response }),
    });

    await expect(approveOAuthSession(MOCK_TOKEN, 'google')).resolves.toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/oauth/session',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ provider: 'google' }),
        headers: expect.objectContaining({ Authorization: `Bearer ${MOCK_TOKEN}` }),
      }),
    );
  });

  describe('syncUser', () => {
    it('calls POST /auth/sync with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { user: MOCK_USER_RESPONSE } }),
      });

      const result = await syncUser(MOCK_TOKEN);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/sync',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result).toEqual(MOCK_USER_RESPONSE);
    });

    it('throws UnauthorizedError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(syncUser(MOCK_TOKEN)).rejects.toThrow(UnauthorizedError);
    });

    it('throws NetworkError when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(syncUser(MOCK_TOKEN)).rejects.toThrow(NetworkError);
    });

    it('hides unsafe server messages while preserving error identity', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () =>
          Promise.resolve({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Database connection failed' },
          }),
      });

      await expect(syncUser(MOCK_TOKEN)).rejects.toThrow(
        new ApiError(500, 'Service temporarily unavailable. Please try again.', 'INTERNAL_ERROR'),
      );
    });
  });

  describe('registerUser', () => {
    it('calls POST /auth/register with registration payload', async () => {
      const responseData = {
        verification_channel: 'email',
        contact_masked: 't***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: responseData }),
      });

      const result = await registerUser({
        email: 'test@example.com',
        password: 'password123',
        confirm_password: 'password123',
        privacy_consent: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/register',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'test@example.com',
            password: 'password123',
            confirm_password: 'password123',
            privacy_consent: true,
          }),
        }),
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('resendVerification', () => {
    it('calls POST /auth/resend-verification with contact payload', async () => {
      const responseData = {
        verification_channel: 'email',
        contact_masked: 't***@example.com',
        expires_in_seconds: 600,
        resend_available_at: '2026-01-01T00:00:00Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: responseData }),
      });

      const result = await resendVerification({
        channel: 'email',
        contact: 'test@example.com',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/resend-verification',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            channel: 'email',
            contact: 'test@example.com',
          }),
        }),
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('verifyPhone', () => {
    it('calls POST /auth/verify-phone without Authorization header and returns AuthSessionResponse', async () => {
      const responseData = {
        access_token: 'access-phone-1',
        refresh_token: 'refresh-phone-1',
        expires_in: 3600,
        token_type: 'Bearer' as const,
        user: {
          ...MOCK_USER_RESPONSE,
          email: null,
          phone: '+8801712345678',
          linked_providers: ['phone'],
        },
        profile_complete: false,
        next_step: 'profile_setup' as const,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: responseData }),
      });

      const result = await verifyPhone({
        phone: '+8801712345678',
        code: '123456',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/verify-phone',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            phone: '+8801712345678',
            code: '123456',
          }),
        }),
      );
      expect(result).toEqual(responseData);
    });
  });

  describe('getMe', () => {
    it('calls GET /auth/me with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { user: MOCK_USER_RESPONSE } }),
      });

      const result = await getMe(MOCK_TOKEN);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/me',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
          }),
        }),
      );
      expect(result.status).toBe('active');
    });

    it('throws ApiError with 404 message when user not synced', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: () =>
          Promise.resolve({
            message: 'User not found. Please call /api/auth/sync first.',
          }),
      });

      await expect(getMe(MOCK_TOKEN)).rejects.toThrow(ApiError);
    });
  });
});

describe('C05 error contract preservation', () => {
  it.each([401, 422, 429])('preserves details and retry metadata for HTTP %s', async (status) => {
    const error = {
      code: status === 401 ? 'TOKEN_EXPIRED' : 'VALIDATION_FAILED',
      message: 'Request rejected',
      requestId: 'request-id',
      details: [
        { field: 'existing_skills.0.name', code: 'VALIDATION_FAILED', message: 'Field invalid' },
      ],
      retryable: true,
      retryAfterSeconds: 17,
    };
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status,
      json: async () => ({ success: false, error }),
    });
    await expect(getMe(MOCK_TOKEN)).rejects.toMatchObject({ statusCode: status, ...error });
  });
  it('does not expose raw HTML errors or backend URL', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw Error('private response');
      },
    });
    await expect(getMe(MOCK_TOKEN)).rejects.toMatchObject({
      message: 'Service temporarily unavailable. Please try again.',
      retryable: true,
    });
  });

  describe('logoutUser', () => {
    it('calls POST /auth/logout with Bearer token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { logged_out: true } }),
      });

      const result = await logoutUser(MOCK_TOKEN);

      expect(result).toEqual({ logged_out: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/logout',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
          }),
        }),
      );
    });
  });

  describe('refreshSession', () => {
    it('calls POST /auth/refresh with refresh_token body and no Authorization header', async () => {
      const mockSession = {
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer' as const,
        user: MOCK_USER_RESPONSE,
        profile_complete: true,
        next_step: 'app_home' as const,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: mockSession }),
      });

      const result = await refreshSession('my-refresh-token');

      expect(result).toEqual(mockSession);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/auth/refresh',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ refresh_token: 'my-refresh-token' }),
        }),
      );
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[1]?.headers?.Authorization).toBeUndefined();
    });
  });
    describe('forgotPassword', () => {
      it('sends POST /auth/forgot-password with identifier without auth header and returns message', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 202,
          json: () =>
            Promise.resolve({
              success: true,
              data: { message: 'If the account exists, a code was sent.' },
            }),
        });

        const result = await forgotPassword('user@example.com');
        expect(result).toEqual({ message: 'If the account exists, a code was sent.' });
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/v1/auth/forgot-password',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ identifier: 'user@example.com' }),
          }),
        );
        const callArgs = mockFetch.mock.calls[0];
        expect(callArgs[1]?.headers?.Authorization).toBeUndefined();
      });
    });

    describe('resetPassword', () => {
      it('sends POST /auth/reset-password with payload and returns password_reset', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              success: true,
              data: { password_reset: true },
            }),
        });

        const result = await resetPassword(
          'user@example.com',
          '123456',
          'N3w!Passw0rd',
          'N3w!Passw0rd',
        );
        expect(result).toEqual({ password_reset: true });
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/v1/auth/reset-password',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({
              identifier: 'user@example.com',
              code: '123456',
              new_password: 'N3w!Passw0rd',
              confirm_new_password: 'N3w!Passw0rd',
            }),
          }),
        );
      });
    });

});

describe('EP-A11 linkSocialIdentity and EP-A12 addContact', () => {
  it('calls POST /auth/identities/link with Bearer token and provider', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { linked_providers: ['email', 'google'] },
        }),
    });

    const result = await linkSocialIdentity(MOCK_TOKEN, 'google');
    expect(result).toEqual({ linked_providers: ['email', 'google'] });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/identities/link',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
        body: JSON.stringify({ provider: 'google' }),
      }),
    );
  });

  it('calls POST /auth/contact with Bearer token and returns RegistrationPendingResponse', async () => {
    const pendingData = {
      verification_channel: 'email' as const,
      contact_masked: 'c****@example.com',
      expires_in_seconds: 600,
      resend_available_at: '2026-01-01T00:01:00.000Z',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ success: true, data: pendingData }),
    });

    const result = await addContact(MOCK_TOKEN, {
      channel: 'email',
      contact: 'candidate@example.com',
    });
    expect(result).toEqual(pendingData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/auth/contact',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
        body: JSON.stringify({
          channel: 'email',
          contact: 'candidate@example.com',
        }),
      }),
    );
  });
});

it('preserves a server Retry-After header when optional body metadata is absent', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 429,
    headers: new Headers({ 'Retry-After': '12', 'X-Request-Id': 'header-id' }),
    json: async () => ({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Request rejected' },
    }),
  });
  await expect(getMe(MOCK_TOKEN)).rejects.toMatchObject({
    retryAfterSeconds: 12,
    requestId: 'header-id',
    retryable: true,
  });
});

describe('EP-P01 getProfile, EP-P02 updateProfile, and EP-P04 updateLearningSettings', () => {
  const MOCK_PROFILE_RESPONSE = {
    current_role: 'Student',
    education: null,
    experience_level: 'beginner' as const,
    existing_skills: [],
    existing_skills_none: true,
    learning_preference: null,
    preferred_daily_hours: 2,
    timezone: 'Asia/Dhaka',
    timezone_detected: true,
    active_career_goal_ids: [],
    profile_complete: false,
    missing_fields: ['learning_preference', 'active_career_goal_ids'],
    updated_at: '2026-11-01T00:00:00.000Z',
  };

  it('calls GET /profile with Bearer token and returns ProfileResponse', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: MOCK_PROFILE_RESPONSE }),
    });

    const result = await getProfile(MOCK_TOKEN);
    expect(result).toEqual(MOCK_PROFILE_RESPONSE);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/profile',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
  });

  it('calls PATCH /profile with Bearer token and preserves optional education & beginner None', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: MOCK_PROFILE_RESPONSE }),
    });

    const result = await updateProfile(MOCK_TOKEN, {
      current_role: 'Student',
      experience_level: 'beginner',
      existing_skills_none: true,
    });
    expect(result).toEqual(MOCK_PROFILE_RESPONSE);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/profile',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          current_role: 'Student',
          experience_level: 'beginner',
          existing_skills_none: true,
        }),
      }),
    );
  });

  it('calls PATCH /profile/learning-settings with Bearer token and learning settings payload', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: MOCK_PROFILE_RESPONSE }),
    });

    const result = await updateLearningSettings(MOCK_TOKEN, {
      timezone: 'Asia/Dhaka',
      preferred_daily_hours: 2,
    });
    expect(result).toEqual(MOCK_PROFILE_RESPONSE);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/profile/learning-settings',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: 2,
        }),
      }),
    );
  });

  it('calls POST /account/deletion-requests (EP-X01) with Bearer token, confirmation, and optional Idempotency-Key', async () => {
    const mockDeletionResponse = {
      id: 'del-uuid-1',
      status: 'completed' as const,
      requested_at: '2026-11-10T12:00:00.000Z',
      completed_at: '2026-11-10T12:01:00.000Z',
      provider_deletion_requested: false,
      deletion_receipt: 'mock-receipt-token',
      receipt_expires_at: '2026-11-11T12:00:00.000Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ success: true, data: mockDeletionResponse }),
    });

    const result = await requestAccountDeletion(
      MOCK_TOKEN,
      { confirmation: 'DELETE', password: 'ValidPass123!' },
      'idem-key-1',
    );

    expect(result).toEqual(mockDeletionResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/account/deletion-requests',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Idempotency-Key': 'idem-key-1',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          confirmation: 'DELETE',
          password: 'ValidPass123!',
        }),
      }),
    );
  });

  it('calls GET /account/deletion-requests/current (EP-X02) with DeletionReceipt header', async () => {
    const mockStatusResponse = {
      id: 'del-uuid-1',
      status: 'completed' as const,
      requested_at: '2026-11-10T12:00:00.000Z',
      completed_at: '2026-11-10T12:01:00.000Z',
      provider_deletion_requested: false,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: mockStatusResponse }),
    });

    const result = await getAccountDeletionStatus('receipt-token-123', true);
    expect(result).toEqual(mockStatusResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/account/deletion-requests/current',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'DeletionReceipt receipt-token-123',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('aborts getCurrentUserState with NetworkError when backend fetch stalls past DEFAULT_AUTH_STATE_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementationOnce(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const sig = init?.signal;
            if (!sig) return;
            if (sig.aborted) {
              reject(sig.reason ?? new DOMException('Aborted', 'AbortError'));
              return;
            }
            sig.addEventListener(
              'abort',
              () => reject(sig.reason ?? new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
          }),
      );

      const pending = getCurrentUserState(MOCK_TOKEN);
      const rejection = expect(pending).rejects.toThrow(NetworkError);
      await vi.advanceTimersByTimeAsync(DEFAULT_AUTH_STATE_TIMEOUT_MS);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects caller-supplied AbortSignal in getCurrentUserState', async () => {
    const callerController = new AbortController();
    mockFetch.mockImplementationOnce(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const sig = init?.signal;
          if (!sig) return;
          if (sig.aborted) {
            reject(sig.reason ?? new DOMException('Aborted', 'AbortError'));
            return;
          }
          sig.addEventListener(
            'abort',
            () => reject(sig.reason ?? new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );

    const pending = getCurrentUserState(MOCK_TOKEN, {
      signal: callerController.signal,
    });
    callerController.abort();
    await expect(pending).rejects.toThrow(NetworkError);
  });

  it('does not apply a client timeout to requestAccountDeletion during slow deletion cascades', async () => {
    vi.useFakeTimers();
    const mockDeletionResponse = {
      id: 'del-uuid-slow',
      status: 'completed' as const,
      requested_at: '2026-11-10T12:00:00.000Z',
      completed_at: '2026-11-10T12:01:00.000Z',
      provider_deletion_requested: true,
      deletion_receipt: 'mock-receipt-slow',
      receipt_expires_at: '2026-11-11T12:00:00.000Z',
    };
    try {
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: true,
                status: 202,
                json: () => Promise.resolve({ success: true, data: mockDeletionResponse }),
              });
            }, 60_000);
          }),
      );

      const pending = requestAccountDeletion(MOCK_TOKEN, {
        confirmation: 'DELETE',
        password: 'ValidPass123!',
      });
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(pending).resolves.toEqual(mockDeletionResponse);
      const fetchInit = mockFetch.mock.calls[0]?.[1] as RequestInit | undefined;
      expect(fetchInit?.signal).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('EP-J01 getJobStatus and withIdempotencyKey', () => {
  it('calls GET /jobs/:id with Bearer token and AbortSignal', async () => {
    const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const jobStatus = {
      job_id: jobId,
      kind: 'roadmap_generate' as const,
      status: 'succeeded' as const,
      result_ref: {
        type: 'roadmap',
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      error: null,
      retryable: false,
      created_at: '2026-11-19T09:00:00.000Z',
      finished_at: '2026-11-19T09:00:05.000Z',
    };
    const controller = new AbortController();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: jobStatus }),
    });

    const result = await getJobStatus(MOCK_TOKEN, jobId, {
      signal: controller.signal,
    });
    expect(result).toEqual(jobStatus);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/jobs/${jobId}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('attaches Idempotency-Key only when non-blank while preserving existing headers', () => {
    expect(
      withIdempotencyKey('  11111111-1111-4111-8111-111111111111  ', {
        'X-Custom': 'val',
      }),
    ).toEqual({
      'X-Custom': 'val',
      'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
    });

    expect(
      withIdempotencyKey('   ', new Headers({ 'X-Trace': 'trace-1' })),
    ).toEqual({
      'x-trace': 'trace-1',
    });

    // Replaces existing case-insensitive idempotency-key without duplicating
    expect(
      withIdempotencyKey('22222222-2222-4222-8222-222222222222', {
        'idempotency-key': 'old-key',
        'X-Custom': 'keep',
      }),
    ).toEqual({
      'X-Custom': 'keep',
      'Idempotency-Key': '22222222-2222-4222-8222-222222222222',
    });

    expect(
      withIdempotencyKey(
        '33333333-3333-4333-8333-333333333333',
        new Headers({ 'idempotency-key': 'old-key', 'X-Trace': 't1' }),
      ),
    ).toEqual({
      'x-trace': 't1',
      'Idempotency-Key': '33333333-3333-4333-8333-333333333333',
    });

    // Blank key preserves existing caller idempotency-key header
    expect(
      withIdempotencyKey('  ', { 'idempotency-key': 'keep-existing' }),
    ).toEqual({
      'idempotency-key': 'keep-existing',
    });
  });
});

describe('M05 EP-P03/EP-P05 and EP-C01–EP-C07 typed fetchers', () => {
  const GOAL = {
    id: '11111111-1111-4111-8111-111111111111',
    goal_text: 'Backend developer',
    status: 'awaiting_confirmation' as const,
    clarification_round: 0,
    clarification_question: null,
    proposed_role: { canonical_role_id: 'role-1', name: 'Backend Development' },
    alternative_roles: [
      { canonical_role_id: 'role-2', name: 'DevOps', rationale: null },
    ],
    suggested_level: 'junior' as const,
    target_level: null,
    roadmap_id: null,
    created_at: '2026-11-01T00:00:00.000Z',
  };
  const ok = (data: unknown, extra: Record<string, unknown> = {}) =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data, ...extra }),
    });
  const lastCall = () => {
    const [url, init] = mockFetch.mock.calls.at(-1)!;
    return { url: url as string, init: init as RequestInit };
  };

  it('EP-P03 PATCH /profile/preferences sends learning_preference', async () => {
    ok({ learning_preference: 'hands_on' });
    await updatePreferences(MOCK_TOKEN, { learning_preference: 'hands_on' });
    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:3000/api/v1/profile/preferences');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ learning_preference: 'hands_on' });
  });

  it('EP-P02 updateSkills sends names, or explicit None without skills (R07)', async () => {
    ok({});
    await updateSkills(MOCK_TOKEN, { names: ['React', 'SQL'] });
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      existing_skills_none: false,
      existing_skills: [{ name: 'React' }, { name: 'SQL' }],
    });
    ok({});
    await updateSkills(MOCK_TOKEN, { none: true });
    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ existing_skills_none: true });
    expect(body).not.toHaveProperty('existing_skills');
    expect(lastCall().url).toBe('http://localhost:3000/api/v1/profile');
  });

  it('EP-P05 POST /profile/skill-alias-interpretations sends input + skill_id', async () => {
    ok({ input: 'node', skill_id: 's1', scope: 'user', added_to_profile: true, progress_initialization: 'deferred_until_level_confirmation' });
    const result = await interpretSkillAlias(MOCK_TOKEN, { input: 'node', skill_id: 's1' });
    expect(result.scope).toBe('user');
    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:3000/api/v1/profile/skill-alias-interpretations');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ input: 'node', skill_id: 's1' });
  });

  it('EP-C01 POST /career/goals', async () => {
    ok(GOAL);
    const result = await createCareerGoal(MOCK_TOKEN, { goal_text: 'Backend developer' });
    expect(result.alternative_roles[0].rationale).toBeNull();
    const { url, init } = lastCall();
    expect(url).toBe('http://localhost:3000/api/v1/career/goals');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ goal_text: 'Backend developer' });
  });

  it('EP-C02 GET /career/goals reads data array plus top-level meta and builds the query', async () => {
    ok([GOAL], { meta: { limit: 5, next_cursor: 'abc' } });
    const result = await listCareerGoals(MOCK_TOKEN, { status: 'confirmed', limit: 5, cursor: 'c1' });
    expect(result.items).toHaveLength(1);
    expect(result.meta).toEqual({ limit: 5, next_cursor: 'abc' });
    expect(lastCall().url).toBe(
      'http://localhost:3000/api/v1/career/goals?status=confirmed&limit=5&cursor=c1',
    );
  });

  it('EP-C02 rejects a missing or malformed meta envelope with INVALID_RESPONSE', async () => {
    ok([GOAL]);
    await expect(listCareerGoals(MOCK_TOKEN)).rejects.toMatchObject({
      statusCode: 502,
      code: 'INVALID_RESPONSE',
    });
  });

  it('EP-C03 GET /career/goals/:id encodes the id', async () => {
    ok(GOAL);
    await getCareerGoal(MOCK_TOKEN, ' a/b ');
    expect(lastCall().url).toBe('http://localhost:3000/api/v1/career/goals/a%2Fb');
  });

  it('EP-C04 POST …/clarifications', async () => {
    ok(GOAL);
    await submitGoalClarification(MOCK_TOKEN, GOAL.id, { answer: 'APIs' });
    const { url, init } = lastCall();
    expect(url).toBe(`http://localhost:3000/api/v1/career/goals/${GOAL.id}/clarifications`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ answer: 'APIs' });
  });

  it('EP-C05 POST …/confirm', async () => {
    ok({ ...GOAL, status: 'confirmed' });
    await confirmCareerGoal(MOCK_TOKEN, GOAL.id, { canonical_role_id: 'role-1', target_level: 'mid' });
    const { url, init } = lastCall();
    expect(url).toBe(`http://localhost:3000/api/v1/career/goals/${GOAL.id}/confirm`);
    expect(JSON.parse(init.body as string)).toEqual({ canonical_role_id: 'role-1', target_level: 'mid' });
  });

  it('EP-C06 PATCH /career/goals/:id', async () => {
    ok(GOAL);
    await updateCareerGoal(MOCK_TOKEN, GOAL.id, { goal_text: 'Data analyst' });
    const { url, init } = lastCall();
    expect(url).toBe(`http://localhost:3000/api/v1/career/goals/${GOAL.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ goal_text: 'Data analyst' });
  });

  it('EP-C07 DELETE /career/goals/:id', async () => {
    ok({ id: GOAL.id, status: 'discontinued', archived_roadmap_id: null, new_focus_roadmap_id: null });
    const result = await deleteCareerGoal(MOCK_TOKEN, GOAL.id);
    expect(result.status).toBe('discontinued');
    const { url, init } = lastCall();
    expect(url).toBe(`http://localhost:3000/api/v1/career/goals/${GOAL.id}`);
    expect(init.method).toBe('DELETE');
  });

  it('surfaces backend error codes on ApiError for M05 failures', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({ success: false, error: { code: 'OUT_OF_SCOPE_GOAL', message: 'raw' } }),
    });
    await expect(createCareerGoal(MOCK_TOKEN, { goal_text: 'Be a chef' })).rejects.toMatchObject({
      statusCode: 422,
      code: 'OUT_OF_SCOPE_GOAL',
    });
  });

  it('dispatchM05Operation routes each operation and rejects unknown names', async () => {
    ok(GOAL);
    await dispatchM05Operation(MOCK_TOKEN, 'getCareerGoal', { id: GOAL.id });
    expect(lastCall().url).toBe(`http://localhost:3000/api/v1/career/goals/${GOAL.id}`);
    ok([], { meta: { limit: 100, next_cursor: null } });
    await dispatchM05Operation(MOCK_TOKEN, 'listCareerGoals', undefined);
    expect(lastCall().url).toBe('http://localhost:3000/api/v1/career/goals');
    await expect(
      dispatchM05Operation(MOCK_TOKEN, 'nope' as never, undefined as never),
    ).rejects.toMatchObject({ code: 'INVALID_OPERATION' });
  });

  it('preserves explicit structured post-commit password-reset 5xx messages while sanitizing unclassified 5xx errors', async () => {
    const postCommitMessage =
      'Password was updated, but local session sync and auth session revocation did not complete. Do not resubmit the reset code; sign in with your new password.';
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 504,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          success: false,
          error: {
            code: 'PROVIDER_TIMEOUT',
            message: postCommitMessage,
            retryable: false,
            details: [
              {
                field: 'password_reset',
                code: 'PASSWORD_RESET_POST_COMMIT_CLEANUP_PENDING',
                message: postCommitMessage,
              },
            ],
          },
        }),
    });

    const { resetPassword } = await import('@/lib/api/client');
    await expect(
      resetPassword('user@example.com', '123456', 'NewPassw0rd!', 'NewPassw0rd!'),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: 'PROVIDER_TIMEOUT',
      message: postCommitMessage,
      retryable: false,
    });

    // Pre-write 504 timeout (retryable, no post-commit detail) stays sanitized
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 504,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          success: false,
          error: {
            code: 'PROVIDER_TIMEOUT',
            message: 'Internal GoTrue timeout stack trace',
            retryable: true,
          },
        }),
    });
    await expect(
      resetPassword('user@example.com', '123456', 'NewPassw0rd!', 'NewPassw0rd!'),
    ).rejects.toMatchObject({
      statusCode: 504,
      code: 'PROVIDER_TIMEOUT',
      message: 'Service temporarily unavailable. Please try again.',
    });
  });

  it('supports timeoutMs on getProfile via AbortSignal across fetch and response body consumption', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            current_role: 'Backend Developer',
            education: null,
            experience_level: 'mid',
            existing_skills: [],
            existing_skills_none: true,
            learning_preference: 'hands_on',
            preferred_daily_hours: 2,
            timezone: 'Asia/Dhaka',
            timezone_detected: false,
            active_career_goal_ids: [],
            profile_complete: false,
            missing_fields: [],
            updated_at: '2026-11-21T00:00:00Z',
          },
        }),
    });

    const result = await getProfile(MOCK_TOKEN, { timeoutMs: 2500 });
    expect(result.current_role).toBe('Backend Developer');
    const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('M06 Roadmap API Client (EP-R01..EP-R07, EP-R14, EP-R15)', () => {
  const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
  const GOAL_ID = '22222222-2222-4222-8222-222222222222';
  const IDEM_KEY = '33333333-3333-4333-8333-333333333333';

  it('creates valid UUID v4 idempotency keys', () => {
    const key = createIdempotencyKey();
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generateRoadmap calls POST /roadmaps/generate (EP-R01) with Idempotency-Key', async () => {
    const accepted = {
      job_id: '44444444-4444-4444-8444-444444444444',
      kind: 'roadmap_generate' as const,
      status: 'queued' as const,
      poll_url: '/api/v1/jobs/44444444-4444-4444-8444-444444444444',
      retry_after_seconds: 2,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ success: true, data: accepted }),
    });

    const result = await generateRoadmap(
      MOCK_TOKEN,
      { career_goal_id: GOAL_ID, target_level: 'mid', level_confirmed: true },
      IDEM_KEY,
    );

    expect(result).toEqual(accepted);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/roadmaps/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Idempotency-Key': IDEM_KEY,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          career_goal_id: GOAL_ID,
          target_level: 'mid',
          level_confirmed: true,
        }),
      }),
    );
  });

  it('listRoadmaps calls GET /roadmaps (EP-R02) and preserves top-level pagination meta', async () => {
    const items = [
      {
        id: ROADMAP_ID,
        career_goal_id: GOAL_ID,
        canonical_role_id: '55555555-5555-4555-8555-555555555555',
        role_name: 'Backend Developer',
        target_level: 'junior' as const,
        status: 'locked' as const,
        is_focus: true,
        current_version_id: '66666666-6666-4666-8666-666666666666',
        current_version_no: 1,
        draft_version_no: null,
        has_open_draft: false,
        has_open_merge: false,
        has_daily_plan: true,
        stale: false,
        stale_draft: false,
        locked_at: '2026-11-19T10:00:00.000Z',
        archived_at: null,
        created_at: '2026-11-19T09:00:00.000Z',
        updated_at: '2026-11-19T10:00:00.000Z',
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: items,
          meta: { limit: 10, next_cursor: 'cursor-2' },
        }),
    });

    const result = await listRoadmaps(MOCK_TOKEN, {
      status: 'locked',
      cursor: 'cursor-1',
      limit: 10,
    });

    expect(result).toEqual({
      items,
      meta: { limit: 10, next_cursor: 'cursor-2' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/roadmaps?status=locked&cursor=cursor-1&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
  });

  it('getRoadmap calls GET /roadmaps/:id (EP-R03) with optional ?version query', async () => {
    const detail = {
      id: ROADMAP_ID,
      version_no: 2,
      version_state: 'draft' as const,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: detail }),
    });

    const result = await getRoadmap(MOCK_TOKEN, ROADMAP_ID, 'draft');
    expect(result).toEqual(detail);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}?version=draft`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
  });

  it('reviseRoadmap calls POST /roadmaps/:id/revision (EP-R04) with Idempotency-Key', async () => {
    const accepted = {
      job_id: '77777777-7777-4777-8777-777777777777',
      kind: 'roadmap_revision' as const,
      status: 'queued' as const,
      poll_url: '/api/v1/jobs/77777777-7777-4777-8777-777777777777',
      retry_after_seconds: 2,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ success: true, data: accepted }),
    });

    const result = await reviseRoadmap(
      MOCK_TOKEN,
      ROADMAP_ID,
      { instruction: 'Add PostgreSQL indexing', expected_version_no: 1 },
      IDEM_KEY,
    );

    expect(result).toEqual(accepted);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/revision`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Idempotency-Key': IDEM_KEY,
        }),
        body: JSON.stringify({
          instruction: 'Add PostgreSQL indexing',
          expected_version_no: 1,
        }),
      }),
    );
  });

  it('lockRoadmap calls POST /roadmaps/:id/lock (EP-R05) with Idempotency-Key', async () => {
    const lockRes = {
      roadmap_id: ROADMAP_ID,
      status: 'locked' as const,
      version_no: 1,
      current_version_id: '88888888-8888-4888-8888-888888888888',
      is_focus: true,
      locked_at: '2026-11-19T10:30:00.000Z',
      next_step: 'confirm_learning_hours' as const,
      preferred_daily_hours: 2,
      size_guardrail: {
        active_topic_count: 12,
        soft_max_topics: 45,
        materially_large: false,
        warning: null,
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: lockRes }),
    });

    const result = await lockRoadmap(
      MOCK_TOKEN,
      ROADMAP_ID,
      { expected_version_no: 1, confirm_large_roadmap: true },
      IDEM_KEY,
    );

    expect(result).toEqual(lockRes);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/lock`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Idempotency-Key': IDEM_KEY,
        }),
        body: JSON.stringify({
          expected_version_no: 1,
          confirm_large_roadmap: true,
        }),
      }),
    );
  });

  it('listRoadmapVersions (EP-R06) and getRoadmapVersion (EP-R07) call version routes cleanly', async () => {
    const versions = [
      {
        id: '99999999-9999-4999-8999-999999999999',
        version_no: 1,
        state: 'locked' as const,
        created_by: 'ai' as const,
        target_level: 'junior' as const,
        base_version_id: null,
        merge_id: null,
        stale: false,
        locked_at: '2026-11-19T10:00:00.000Z',
        superseded_at: null,
        created_at: '2026-11-19T09:00:00.000Z',
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: versions,
          meta: { limit: 50, next_cursor: null },
        }),
    });

    const listRes = await listRoadmapVersions(MOCK_TOKEN, ROADMAP_ID);
    expect(listRes).toEqual({
      items: versions,
      meta: { limit: 50, next_cursor: null },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/versions`,
      expect.any(Object),
    );

    const snapshot = { id: ROADMAP_ID, version_no: 1 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: snapshot }),
    });

    const snapRes = await getRoadmapVersion(MOCK_TOKEN, ROADMAP_ID, 1);
    expect(snapRes).toEqual(snapshot);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/versions/1`,
      expect.any(Object),
    );
  });

  it('focusRoadmap (EP-R14) and archiveRoadmap (EP-R15) invoke POST endpoints cleanly', async () => {
    const focusRes = {
      focus_roadmap_id: ROADMAP_ID,
      daily_plan: {
        state: 'missing' as const,
        plan_id: null,
        requires_learning_hours: true,
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: focusRes }),
    });

    await expect(focusRoadmap(MOCK_TOKEN, ROADMAP_ID)).resolves.toEqual(focusRes);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/focus`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );

    const archiveRes = {
      archived_roadmap_id: ROADMAP_ID,
      status: 'archived' as const,
      new_focus_roadmap_id: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: archiveRes }),
    });

    await expect(
      archiveRoadmap(MOCK_TOKEN, ROADMAP_ID, { reason: 'Switching tracks' }),
    ).resolves.toEqual(archiveRes);
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${ROADMAP_ID}/archive`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reason: 'Switching tracks' }),
      }),
    );
  });
});

describe('M07 Learning API client (EP-L01..EP-L07)', () => {
  const ROADMAP_ID = '11111111-1111-4111-8111-111111111111';
  const PLAN_ID = '22222222-2222-4222-8222-222222222222';
  const TOPIC_ID = '33333333-3333-4333-8333-333333333333';

  it('calls EP-L01 getDailyPlan, EP-L02 createDailyPlan with Idempotency-Key, and EP-L03 rebuildDailyPlan', async () => {
    const planPayload: DailyPlanResponseDTO = {
      plan_id: PLAN_ID,
      roadmap_id: ROADMAP_ID,
      roadmap_version_no: 1,
      is_focus: true,
      hours_per_day: 2,
      total_days: 4,
      completed_days: 0,
      next_incomplete_day_no: 1,
      days: [],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: planPayload,
          meta: { limit: 14, next_cursor: 'day-15' },
        }),
    });

    const getRes = await getDailyPlan(MOCK_TOKEN, {
      roadmap_id: ROADMAP_ID,
      limit: 14,
      cursor: 'day-1',
    });
    expect(getRes).toEqual({
      plan: planPayload,
      meta: { limit: 14, next_cursor: 'day-15' },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/learning/daily-plan?roadmap_id=${ROADMAP_ID}&cursor=day-1&limit=14`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, data: planPayload }),
    });
    const idemKey = createIdempotencyKey();
    await expect(
      createDailyPlan(
        MOCK_TOKEN,
        { roadmap_id: ROADMAP_ID, hours_per_day: 2 },
        idemKey,
      ),
    ).resolves.toEqual(planPayload);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/learning/daily-plans',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Idempotency-Key': idemKey,
        }),
        body: JSON.stringify({ roadmap_id: ROADMAP_ID, hours_per_day: 2 }),
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ...planPayload, hours_per_day: 3 },
        }),
    });
    await expect(
      rebuildDailyPlan(MOCK_TOKEN, PLAN_ID, { hours_per_day: 3 }),
    ).resolves.toMatchObject({ hours_per_day: 3 });
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/learning/daily-plans/${PLAN_ID}/rebuild`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ hours_per_day: 3 }),
      }),
    );
  });

  it('calls EP-L04 getToday, EP-L05 listLearningTopics, EP-L06 getLearningTopic, and EP-L07 listLearningResources', async () => {
    const todayRes: TodayResponseDTO = {
      status: 'no_focus_roadmap',
      roadmap_id: null,
      plan_id: null,
      plan_day: null,
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: null,
      requires_learning_hours: false,
      preferred_daily_hours: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: todayRes }),
    });
    await expect(getToday(MOCK_TOKEN)).resolves.toEqual(todayRes);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/learning/today',
      expect.any(Object),
    );

    const topicJobKind: JobKind = 'topic_content';
    const preparingToday: TodayResponseDTO = {
      status: 'preparing',
      roadmap_id: ROADMAP_ID,
      plan_id: PLAN_ID,
      plan_day: { day_no: 1, total_days: 4 },
      topic: null,
      quiz: { attempt_id: null, status: null, can_retry: false },
      job: {
        job_id: '44444444-4444-4444-8444-444444444444',
        kind: topicJobKind,
        status: 'queued',
        poll_url: '/api/v1/jobs/44444444-4444-4444-8444-444444444444',
        retry_after_seconds: 3,
      },
      requires_learning_hours: false,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: preparingToday }),
    });
    await expect(getToday(MOCK_TOKEN)).resolves.toEqual(preparingToday);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { items: [] },
          meta: { limit: 20, next_cursor: null },
        }),
    });
    await expect(
      listLearningTopics(MOCK_TOKEN, {
        roadmap_id: ROADMAP_ID,
        priority: 'core',
        learning_state: 'not_started',
        limit: 20,
      }),
    ).resolves.toEqual({ items: [], meta: { limit: 20, next_cursor: null } });
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/learning/topics?roadmap_id=${ROADMAP_ID}&priority=core&learning_state=not_started&limit=20`,
      expect.any(Object),
    );

    const topicDetail: TopicDetailDTO = {
      topic_id: TOPIC_ID,
      title: 'Indexing',
      career_level: 'mid',
      content_version: 1,
      explanation_markdown: '## Indexing',
      important_questions: [],
      sources: [],
      learning_state: 'learning',
      required_depth: 'B-Tree internals',
      rating_allowed: true,
      report_allowed: true,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: topicDetail }),
    });
    await expect(getLearningTopic(MOCK_TOKEN, TOPIC_ID)).resolves.toEqual(
      topicDetail,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/learning/topics/${TOPIC_ID}`,
      expect.any(Object),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { items: [] },
          meta: { limit: 10, next_cursor: null },
        }),
    });
    await expect(
      listLearningResources(MOCK_TOKEN, { topic_id: TOPIC_ID, limit: 10 }),
    ).resolves.toEqual({ items: [], meta: { limit: 10, next_cursor: null } });
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/learning/resources?topic_id=${TOPIC_ID}&limit=10`,
      expect.any(Object),
    );
  });
});

describe('M08 Quiz, Practice Review & Progress API client (EP-Q01..Q07, EP-PR01..PR03, EP-G01..G03)', () => {
  const ITEM_ID = '11111111-1111-4111-8111-111111111111';
  const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';
  const REVIEW_ID = '33333333-3333-4333-8333-333333333333';
  const SKILL_ID = '44444444-4444-4444-8444-444444444444';
  const IDEM_KEY = '55555555-5555-4555-8555-555555555555';

  it('calls EP-Q01..EP-Q07 quiz endpoints and attaches Idempotency-Key on EP-Q01, EP-Q05, EP-Q07', async () => {
    const attemptDto = {
      attempt_id: ATTEMPT_ID,
      status: 'generated' as const,
      attempt_no: 1,
      topic_id: ITEM_ID,
      career_level: 'mid' as const,
      questions: [],
      saved_answers: [],
      submitted_at: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, data: attemptDto }),
    });
    const genRes = await generateQuiz(
      MOCK_TOKEN,
      { daily_plan_item_id: ITEM_ID },
      IDEM_KEY,
    );
    expect(isJobAcceptedDTO(genRes)).toBe(false);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/v1/quiz/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Idempotency-Key': IDEM_KEY }),
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: attemptDto }),
    });
    await expect(getQuizAttempt(MOCK_TOKEN, ATTEMPT_ID)).resolves.toEqual(
      attemptDto,
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ...attemptDto, status: 'started' },
        }),
    });
    await expect(startQuizAttempt(MOCK_TOKEN, ATTEMPT_ID)).resolves.toMatchObject(
      { status: 'started' },
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { saved: 1, saved_at: '2026-11-22T10:00:00.000Z' },
        }),
    });
    await expect(
      patchQuizAnswers(MOCK_TOKEN, ATTEMPT_ID, {
        answers: [{ question_id: ITEM_ID, selected_option_id: 'a' }],
      }),
    ).resolves.toEqual({ saved: 1, saved_at: '2026-11-22T10:00:00.000Z' });

    const submitPayload = {
      attempt_id: ATTEMPT_ID,
      status: 'submitted' as const,
      mcq_score: { correct: 1, total: 1 },
      plan_day_unlocked: true,
      next_plan_day_no: 2,
      review_job_id: null,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: submitPayload }),
    });
    await expect(
      submitQuizAttempt(
        MOCK_TOKEN,
        ATTEMPT_ID,
        { confirm_unanswered: true },
        IDEM_KEY,
      ),
    ).resolves.toEqual(submitPayload);

    const resultPayload = {
      attempt_id: ATTEMPT_ID,
      status: 'feedback_available' as const,
      attempt_no: 1,
      mcq_score: { correct: 1, total: 1 },
      performance_level: 'good' as const,
      questions: [],
      improvement_recommendations: [],
      progress_change: null,
      retry_available: true,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: resultPayload }),
    });
    await expect(getQuizResult(MOCK_TOKEN, ATTEMPT_ID)).resolves.toEqual(
      resultPayload,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      `http://localhost:3000/api/v1/quiz/${ATTEMPT_ID}/result`,
      expect.any(Object),
    );

    const jobPayload = {
      job_id: '66666666-6666-4666-8666-666666666666',
      kind: 'quiz_generate' as const,
      status: 'queued' as const,
      poll_url: '/api/v1/jobs/66666666-6666-4666-8666-666666666666',
      retry_after_seconds: 3,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () => Promise.resolve({ success: true, data: jobPayload }),
    });
    const retryRes = await retryQuizAttempt(MOCK_TOKEN, ATTEMPT_ID, IDEM_KEY);
    expect(isJobAcceptedDTO(retryRes)).toBe(true);
    expect(
      isJobAcceptedDTO({
        job_id: 'j1',
        poll_url: '/api/v1/jobs/j1',
        status: 'invalid_status',
        retry_after_seconds: 3,
      }),
    ).toBe(false);
    expect(
      isJobAcceptedDTO({
        job_id: 'j1',
        poll_url: '/api/v1/jobs/j1',
        status: 'queued',
      }),
    ).toBe(false);
  });

  it('calls EP-PR01..EP-PR03 practice review and EP-G01..EP-G03 progress endpoints cleanly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [] }),
    });
    await expect(
      listPracticeReviews(MOCK_TOKEN, ATTEMPT_ID),
    ).resolves.toEqual([]);

    const feedbackDto = {
      id: REVIEW_ID,
      question_id: ITEM_ID,
      review_status: 'reviewed' as const,
      performance_level: 'good' as const,
      dimensions: {
        correctness: 'good' as const,
        understanding: 'good' as const,
        reasoning: 'good' as const,
      },
      strengths: ['Clear explanation'],
      mistakes: [],
      weaknesses: [],
      improvement_recommendations: [],
      evidence_eligible: true,
      reportable: true,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: feedbackDto }),
    });
    await expect(
      getPracticeReviewFeedback(MOCK_TOKEN, REVIEW_ID),
    ).resolves.toEqual(feedbackDto);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: feedbackDto }),
    });
    await expect(retryPracticeReview(MOCK_TOKEN, REVIEW_ID)).resolves.toEqual(
      feedbackDto,
    );

    const progressPayload = {
      roadmap_id: ITEM_ID,
      career_level: 'mid' as const,
      roadmap_progress: { items_total: 5, items_completed: 2 },
      skills: [],
      weak_areas: [],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: progressPayload,
          meta: { limit: 20, next_cursor: null },
        }),
    });
    await expect(
      getProgress(MOCK_TOKEN, {
        roadmap_id: ITEM_ID,
        career_level: 'mid',
        learning_state: 'practicing',
        limit: 20,
      }),
    ).resolves.toEqual({
      progress: progressPayload,
      meta: { limit: 20, next_cursor: null },
    });

    const skillDetail = {
      skill_id: SKILL_ID,
      name: 'SQL',
      levels: [],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: skillDetail }),
    });
    await expect(
      getSkillProgressDetail(MOCK_TOKEN, SKILL_ID, { career_level: 'mid' }),
    ).resolves.toEqual(skillDetail);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          meta: { limit: 20, next_cursor: null },
        }),
    });
    await expect(
      getProgressHistory(MOCK_TOKEN, { skill_id: SKILL_ID, limit: 20 }),
    ).resolves.toEqual({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });

    // Normalized limit consistency between query string and fallback meta.limit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: progressPayload }),
    });
    const flooredProgress = await getProgress(MOCK_TOKEN, { limit: 5.9 });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/progress?limit=5',
      expect.any(Object),
    );
    expect(flooredProgress.meta.limit).toBe(5);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [] }),
    });
    const invalidLimitHistory = await getProgressHistory(MOCK_TOKEN, {
      limit: -4,
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/progress/history',
      expect.any(Object),
    );
    expect(invalidLimitHistory.meta.limit).toBe(20);
  });

  it('calls M09 roadmap merge endpoints (EP-R08–EP-R13) with Idempotency-Key and If-Match headers', async () => {
    const RM_ID = '22222222-2222-4222-8222-222222222222';
    const MERGE_ID = '66666666-6666-4666-8666-666666666666';
    const IDEM_1 = '11111111-1111-4111-8111-111111111111';
    const IDEM_2 = '33333333-3333-4333-8333-333333333333';
    const IDEM_3 = '44444444-4444-4444-8444-444444444444';

    // EP-R08 createRoadmapMerge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 202,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            job_id: 'job-m-1',
            kind: 'merge_proposal',
            status: 'queued',
            poll_url: '/api/v1/jobs/job-m-1',
            retry_after_seconds: 3,
          },
        }),
    });
    const created = await createRoadmapMerge(
      MOCK_TOKEN,
      RM_ID,
      { origin: 'level_change', target_level: 'senior', base_version_no: 2 },
      IDEM_1,
      2,
    );
    expect(created.kind).toBe('merge_proposal');
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': IDEM_1,
          'If-Match': '2',
        }),
      }),
    );

    // EP-R09 listRoadmapMerges
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          meta: { limit: 10, next_cursor: null },
        }),
    });
    const listed = await listRoadmapMerges(MOCK_TOKEN, RM_ID, {
      status: 'proposed',
      limit: 10.7,
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges?status=proposed&limit=10`,
      expect.any(Object),
    );
    expect(listed.meta.limit).toBe(10);

    // EP-R10 getRoadmapMerge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            id: MERGE_ID,
            roadmap_id: RM_ID,
            status: 'proposed',
            operations: [],
            size_impact: {
              active_topics_before: 10,
              active_topics_after: 11,
              before: 10,
              after: 11,
              delta: 1,
              soft_limit: 45,
              materially_large: false,
              warning: null,
            },
            daily_plan_impact: {
              has_active_plan: true,
              completed_days_unchanged: 2,
              future_days_affected: 3,
            },
          },
        }),
    });
    const detail = await getRoadmapMerge(MOCK_TOKEN, RM_ID, MERGE_ID);
    expect(detail.id).toBe(MERGE_ID);
    const getDetailCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(getDetailCall?.[0]).toBe(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges/${MERGE_ID}`,
    );
    expect((getDetailCall?.[1] as RequestInit | undefined)?.method ?? 'GET').toBe(
      'GET',
    );

    // EP-R11 acceptRoadmapMerge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            roadmap_id: RM_ID,
            merge_id: MERGE_ID,
            new_version_no: 3,
            undo_available: true,
            daily_plan_reconciled: true,
          },
        }),
    });
    const accepted = await acceptRoadmapMerge(
      MOCK_TOKEN,
      RM_ID,
      MERGE_ID,
      { base_version_no: 2, acknowledge_large_expansion: true },
      IDEM_2,
      2,
    );
    expect(accepted.new_version_no).toBe(3);
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges/${MERGE_ID}/accept`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': IDEM_2,
          'If-Match': '2',
        }),
      }),
    );

    // EP-R12 rejectRoadmapMerge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            merge_id: MERGE_ID,
            status: 'rejected',
            rejected_at: '2026-11-23T12:00:00.000Z',
          },
        }),
    });
    const rejected = await rejectRoadmapMerge(MOCK_TOKEN, RM_ID, MERGE_ID);
    expect(rejected.status).toBe('rejected');
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges/${MERGE_ID}/reject`,
      expect.objectContaining({
        method: 'POST',
      }),
    );

    // EP-R13 undoLastRoadmapMerge
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            restored_version_no: 2,
            merge_id: MERGE_ID,
            status: 'undone',
          },
        }),
    });
    const undone = await undoLastRoadmapMerge(MOCK_TOKEN, RM_ID, IDEM_3);
    expect(undone.restored_version_no).toBe(2);
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/roadmaps/${RM_ID}/merges/undo`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': IDEM_3,
        }),
      }),
    );
  });

  it('rejects malformed merge list and merge detail payloads with controlled ApiError', async () => {
    const RM_ID = '22222222-2222-4222-8222-222222222222';
    const MERGE_ID = '66666666-6666-4666-8666-666666666666';

    // Valid wrapped empty list still works
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { items: [] },
          meta: { limit: 20, next_cursor: null },
        }),
    });
    await expect(listRoadmapMerges(MOCK_TOKEN, RM_ID)).resolves.toEqual({
      items: [],
      meta: { limit: 20, next_cursor: null },
    });

    // Malformed { items: null } rejected
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { items: null },
        }),
    });
    await expect(listRoadmapMerges(MOCK_TOKEN, RM_ID)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed detail missing operations array rejected
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: MERGE_ID, roadmap_id: RM_ID, operations: null },
        }),
    });
    await expect(
      getRoadmapMerge(MOCK_TOKEN, RM_ID, MERGE_ID),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });
  });
});

describe('M10 Mentor API Client (EP-M01 through EP-M04)', () => {
  const CONV_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TOPIC_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const CLIENT_MSG_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const USER_MSG_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const ASST_MSG_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

  const MOCK_CONVERSATION = {
    id: CONV_ID,
    context_type: 'topic' as const,
    roadmap_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    topic_id: TOPIC_ID,
    title: 'TypeScript Generics',
    created_at: '2026-11-24T08:00:00.000Z',
  };

  it('calls EP-M01 createMentorConversation, EP-M02 listMentorConversations, EP-M03 sendMentorMessage, and EP-M04 getMentorHistory', async () => {
    // EP-M01 POST /mentor/conversations
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, data: MOCK_CONVERSATION }),
    });
    const created = await createMentorConversation(MOCK_TOKEN, {
      context_type: 'topic',
      topic_id: TOPIC_ID,
    });
    expect(created).toEqual(MOCK_CONVERSATION);
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/mentor/conversations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ context_type: 'topic', topic_id: TOPIC_ID }),
      }),
    );

    // EP-M02 GET /mentor/conversations?limit=20&cursor=cur-1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [MOCK_CONVERSATION],
          meta: { limit: 20, next_cursor: 'cur-2' },
        }),
    });
    const list = await listMentorConversations(MOCK_TOKEN, {
      limit: 20,
      cursor: 'cur-1',
    });
    expect(list).toEqual({
      items: [MOCK_CONVERSATION],
      meta: { limit: 20, next_cursor: 'cur-2' },
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/mentor/conversations?limit=20&cursor=cur-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );

    // EP-M03 POST /mentor/messages (synchronous 201 JSON, body client_message_id, NO Idempotency-Key header)
    const mockReply = {
      user_message_id: USER_MSG_ID,
      assistant_message: {
        id: ASST_MSG_ID,
        role: 'assistant' as const,
        content: 'Generics allow reusable type-safe helpers.',
        language: 'en' as const,
        created_at: '2026-11-24T08:01:00.000Z',
      },
      safety_mode: false,
      learning_claim_recorded: true,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () => Promise.resolve({ success: true, data: mockReply }),
    });
    const reply = await sendMentorMessage(MOCK_TOKEN, {
      conversation_id: CONV_ID,
      content: 'I studied generics!',
      client_message_id: CLIENT_MSG_ID,
    });
    expect(reply).toEqual(mockReply);
    const sendCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    expect(sendCall[0]).toBe('http://localhost:3000/api/v1/mentor/messages');
    expect(sendCall[1]?.method).toBe('POST');
    expect(sendCall[1]?.headers).toMatchObject({
      Authorization: `Bearer ${MOCK_TOKEN}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
    expect(new Headers(sendCall[1]?.headers).has('Idempotency-Key')).toBe(false);
    expect(sendCall[1]?.body).toBe(
      JSON.stringify({
        conversation_id: CONV_ID,
        content: 'I studied generics!',
        client_message_id: CLIENT_MSG_ID,
      }),
    );

    // EP-M04 GET /mentor/history?conversation_id=...&limit=20&cursor=hist-1
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [mockReply.assistant_message],
          meta: { limit: 20, next_cursor: null },
        }),
    });
    const history = await getMentorHistory(MOCK_TOKEN, {
      conversation_id: CONV_ID,
      limit: 20,
      cursor: 'hist-1',
    });
    expect(history).toEqual({
      items: [mockReply.assistant_message],
      meta: { limit: 20, next_cursor: null },
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/mentor/history?conversation_id=${CONV_ID}&limit=20&cursor=hist-1`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
  });

  it('rejects malformed EP-M01 through EP-M04 payloads with ApiError(502, INVALID_RESPONSE)', async () => {
    // Malformed EP-M01 missing id
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          success: true,
          data: { context_type: 'general', created_at: '2026-11-24T08:00:00.000Z' },
        }),
    });
    await expect(
      createMentorConversation(MOCK_TOKEN, { context_type: 'general' }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed EP-M02 non-array items
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { items: null },
        }),
    });
    await expect(listMentorConversations(MOCK_TOKEN)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed EP-M03 missing assistant_message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            user_message_id: USER_MSG_ID,
            safety_mode: false,
            learning_claim_recorded: false,
          },
        }),
    });
    await expect(
      sendMentorMessage(MOCK_TOKEN, {
        conversation_id: CONV_ID,
        content: 'Hello',
        client_message_id: CLIENT_MSG_ID,
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed EP-M04 invalid role in history message
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [
            {
              id: ASST_MSG_ID,
              role: 'system',
              content: 'bad',
              language: 'en',
              created_at: '2026-11-24T08:01:00.000Z',
            },
          ],
        }),
    });
    await expect(
      getMentorHistory(MOCK_TOKEN, { conversation_id: CONV_ID }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });
  });

  it('validates embedded data.meta (rejecting invalid next_cursor: 123) and keeps valid top-level meta authoritative', async () => {
    // 1. normalizePaginatedEnvelope (listRoadmaps): invalid embedded next_cursor: 123 falls back cleanly
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            items: [],
            meta: { limit: 15, next_cursor: 123 },
          },
        }),
    });
    const roadmapFallback = await listRoadmaps(MOCK_TOKEN, { limit: 10 });
    expect(roadmapFallback).toEqual({
      items: [],
      meta: { limit: 10, next_cursor: null },
    });

    // 2. normalizePaginatedEnvelope: valid top-level meta stays authoritative over embedded data.meta
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            items: [],
            meta: { limit: 10, next_cursor: 'embedded-cur' },
          },
          meta: { limit: 25, next_cursor: 'top-cur' },
        }),
    });
    const roadmapTopAuthoritative = await listRoadmaps(MOCK_TOKEN);
    expect(roadmapTopAuthoritative.meta).toEqual({
      limit: 25,
      next_cursor: 'top-cur',
    });

    // 3. extractValidatedArray (listMentorConversations): invalid embedded next_cursor: 123 falls back cleanly
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            items: [MOCK_CONVERSATION],
            meta: { limit: 20, next_cursor: 123 },
          },
        }),
    });
    const convFallback = await listMentorConversations(MOCK_TOKEN, {
      limit: 12,
    });
    expect(convFallback).toEqual({
      items: [MOCK_CONVERSATION],
      meta: { limit: 12, next_cursor: null },
    });
  });
});

describe('M11 Technology Intelligence API client (EP-T01..EP-T03)', () => {
  const MOCK_TOKEN = 'test-access-token';
  const UPDATE_ID = '11111111-1111-4111-8111-111111111111';
  const MOCK_UPDATE = {
    id: UPDATE_ID,
    local_date: '2026-11-24',
    title: 'PostgreSQL 17.2 Vacuum Memory Improvements',
    what_changed: 'Added TidStore for vacuum memory efficiency.',
    why_it_matters: 'Improves high-churn Backend table maintenance.',
    publisher: 'PostgreSQL Global Development Group',
    source_url: 'https://www.postgresql.org/docs/release/17.2/',
    fetched_at: '2026-11-24T06:15:00.000Z',
    release_status: 'released' as const,
    relevance: 'high' as const,
    action_timing: 'learn_later' as const,
    roadmap_relation: 'Relates to Backend Database Operations.',
    viewed: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls EP-T01 listTechnologyUpdates, EP-T02 getTechnologyUpdate, and EP-T03 markTechnologyUpdateViewed with exact URLs and methods', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            today_state: 'available',
            generation_pending: false,
            message: null,
            items: [MOCK_UPDATE],
          },
          meta: { limit: 10, next_cursor: 'tech-cur-2' },
        }),
    });

    const listRes = await listTechnologyUpdates(MOCK_TOKEN, {
      limit: 10,
      cursor: 'tech-cur-1',
    });
    expect(listRes).toEqual({
      data: {
        today_state: 'available',
        generation_pending: false,
        message: null,
        items: [MOCK_UPDATE],
      },
      meta: { limit: 10, next_cursor: 'tech-cur-2' },
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/technology-updates?limit=10&cursor=tech-cur-1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: MOCK_UPDATE,
        }),
    });

    const detailRes = await getTechnologyUpdate(MOCK_TOKEN, UPDATE_ID);
    expect(detailRes).toEqual(MOCK_UPDATE);
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/technology-updates/${UPDATE_ID}`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            id: UPDATE_ID,
            viewed: true,
            viewed_at: '2026-11-24T09:00:00.000Z',
          },
        }),
    });

    const viewRes = await markTechnologyUpdateViewed(MOCK_TOKEN, UPDATE_ID);
    expect(viewRes).toEqual({
      id: UPDATE_ID,
      viewed: true,
      viewed_at: '2026-11-24T09:00:00.000Z',
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/technology-updates/${UPDATE_ID}/view`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
  });

  it('rejects malformed EP-T01..EP-T03 payloads with ApiError(502, INVALID_RESPONSE)', async () => {
    // Malformed EP-T01 invalid today_state
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: {
            today_state: 'unknown_state',
            generation_pending: false,
            message: null,
            items: [],
          },
        }),
    });
    await expect(listTechnologyUpdates(MOCK_TOKEN)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed EP-T02 missing required fields
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: UPDATE_ID, title: 'Incomplete' },
        }),
    });
    await expect(
      getTechnologyUpdate(MOCK_TOKEN, UPDATE_ID),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });

    // Malformed EP-T03 viewed !== true
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { id: UPDATE_ID, viewed: false, viewed_at: '' },
        }),
    });
    await expect(
      markTechnologyUpdateViewed(MOCK_TOKEN, UPDATE_ID),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      statusCode: 502,
    });
  });
});

describe('M13 Admin API Client (EP-AD01..EP-AD08)', () => {
  const TARGET_USER_ID = '22222222-2222-4222-8222-222222222222';
  const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';

  const SAMPLE_USER_SUMMARY = {
    id: TARGET_USER_ID,
    email: 'learner@example.com',
    phone: '+8801712345678',
    contact_masked: 'l***@example.com / +8801****5678',
    status: 'active' as const,
    created_at: '2026-11-01T00:00:00.000Z',
    last_active_at: '2026-11-24T12:00:00.000Z',
    roadmap_count: 2,
    technology_update_enabled: false,
  };

  const SAMPLE_USER_DETAIL = {
    ...SAMPLE_USER_SUMMARY,
    feature_access: [
      {
        feature_key: 'technology_update' as const,
        global_enabled: true,
        user_override: null,
        effective: false,
      },
    ],
    counts: {
      roadmaps: 2,
      quizzes_submitted: 5,
      mentor_messages: 10,
      ai_requests: 25,
    },
  };

  const SAMPLE_FEATURE = {
    feature_key: 'technology_update' as const,
    enabled: true,
    updated_at: '2026-11-24T00:00:00.000Z',
    updated_by: ADMIN_USER_ID,
  };

  const SAMPLE_AUDIT = {
    id: '33333333-3333-4333-8333-333333333333',
    actor_id: ADMIN_USER_ID,
    action: 'user.suspend',
    target_type: 'user',
    target_id: TARGET_USER_ID,
    before: { status: 'active' },
    after: { status: 'suspended' },
    request_id: '44444444-4444-4444-8444-444444444444',
    created_at: '2026-11-24T12:00:00.000Z',
  };

  const SAMPLE_USAGE = {
    range: { from: '2026-11-24', to: '2026-11-25' },
    series: {
      group_by: 'day' as const,
      buckets: [
        {
          key: '2026-11-24',
          requests: 0,
          estimated_cost_usd: 0,
          failures: 0,
          fallbacks_used: 0,
          input_units: 0,
          output_units: 0,
        },
        {
          key: '2026-11-25',
          requests: 10,
          estimated_cost_usd: 0.02,
          failures: 1,
          fallbacks_used: 0,
          input_units: 3000,
          output_units: 1500,
        },
      ],
    },
    users: { total: 40, active_last_7_days: 22 },
    counts: {
      roadmaps_locked: 18,
      quizzes_submitted: 65,
      mentor_messages: 120,
      technology_updates_generated: 9,
    },
    ai: {
      requests: 10,
      failures: 1,
      fallbacks_used: 0,
      usage_units: { input: 3000, output: 1500 },
      estimated_cost_usd: 0.02,
      by_day: [],
      by_feature: [],
      by_provider: [],
    },
  };

  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls all 8 admin endpoints (EP-AD01..EP-AD08) with exact methods, query params, and validates envelopes', async () => {
    // EP-AD01
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [SAMPLE_USER_SUMMARY],
          meta: { limit: 10, next_cursor: 'cur-1' },
        }),
    });
    const users = await listAdminUsers(MOCK_TOKEN, {
      q: 'learner',
      status: 'active',
      limit: 10,
    });
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/admin/users?q=learner&status=active&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_TOKEN}`,
        }),
      }),
    );
    expect(users).toEqual({
      items: [SAMPLE_USER_SUMMARY],
      meta: { limit: 10, next_cursor: 'cur-1' },
    });

    // EP-AD02
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: SAMPLE_USER_DETAIL }),
    });
    const detail = await getAdminUser(MOCK_TOKEN, TARGET_USER_ID);
    expect(detail.counts.mentor_messages).toBe(10);

    // EP-AD03
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ...SAMPLE_USER_DETAIL, status: 'suspended' },
        }),
    });
    const suspended = await updateAdminUserStatus(MOCK_TOKEN, TARGET_USER_ID, {
      status: 'suspended',
      reason: 'Abuse detected',
    });
    expect(suspended.status).toBe('suspended');
    expect(mockFetch).toHaveBeenLastCalledWith(
      `http://localhost:3000/api/v1/admin/users/${TARGET_USER_ID}`,
      expect.objectContaining({ method: 'PATCH' }),
    );

    // EP-AD04
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [SAMPLE_FEATURE] }),
    });
    const features = await listAdminFeatures(MOCK_TOKEN);
    expect(features).toEqual([SAMPLE_FEATURE]);

    // EP-AD05
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { ...SAMPLE_FEATURE, enabled: false },
        }),
    });
    const updatedFeature = await updateGlobalFeature(MOCK_TOKEN, {
      feature_key: 'technology_update',
      enabled: false,
    });
    expect(updatedFeature.enabled).toBe(false);

    // EP-AD06 (null inherit)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: SAMPLE_USER_DETAIL }),
    });
    const updatedUserFeature = await updateUserFeatureOverride(
      MOCK_TOKEN,
      TARGET_USER_ID,
      { feature_key: 'technology_update', enabled: null },
    );
    expect(updatedUserFeature.id).toBe(TARGET_USER_ID);

    // EP-AD07
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [SAMPLE_AUDIT],
          meta: { limit: 20, next_cursor: null },
        }),
    });
    const logs = await listAdminAuditLogs(MOCK_TOKEN, {
      action: 'user.suspend',
      limit: 20,
    });
    expect(logs.items).toEqual([SAMPLE_AUDIT]);

    // EP-AD08
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: SAMPLE_USAGE }),
    });
    const usage = await getAdminUsage(MOCK_TOKEN, {
      from: '2026-11-24',
      to: '2026-11-25',
      group_by: 'day',
    });
    expect(usage.series.buckets).toHaveLength(2);
  });

  it('rejects malformed admin responses with ApiError(502, INVALID_RESPONSE)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ id: TARGET_USER_ID, status: 'bogus_status' }],
        }),
    });
    await expect(listAdminUsers(MOCK_TOKEN)).rejects.toMatchObject({
      statusCode: 502,
      code: 'INVALID_RESPONSE',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: { range: { from: '2026-11-24', to: '2026-11-25' } },
        }),
    });
    await expect(getAdminUsage(MOCK_TOKEN)).rejects.toMatchObject({
      statusCode: 502,
      code: 'INVALID_RESPONSE',
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          data: [{ feature_key: 'invalid_key', enabled: true }],
        }),
    });
    await expect(listAdminFeatures(MOCK_TOKEN)).rejects.toMatchObject({
      statusCode: 502,
      code: 'INVALID_RESPONSE',
    });

    // Rejects malformed entries inside ai.by_day, ai.by_feature, and ai.by_provider
    for (const key of ['by_day', 'by_feature', 'by_provider'] as const) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            success: true,
            data: {
              ...SAMPLE_USAGE,
              ai: {
                ...SAMPLE_USAGE.ai,
                [key]: [null],
              },
            },
          }),
      });
      await expect(getAdminUsage(MOCK_TOKEN)).rejects.toMatchObject({
        statusCode: 502,
        code: 'INVALID_RESPONSE',
      });
    }
  });
});
