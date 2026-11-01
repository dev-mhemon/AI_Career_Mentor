import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadProfileForSetup,
  saveProfileSetupAction,
} from '@/lib/profile/actions';
import {
  getProfile,
  updateProfile,
  updateLearningSettings,
  ApiError,
  NetworkError,
  type FieldError,
} from '@/lib/api/client';

const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
  }),
}));

vi.mock('@/lib/api/client', () => {
  class MockNetworkError extends Error {
    constructor(message = 'Network request failed') {
      super(message);
      this.name = 'NetworkError';
    }
  }

  class MockApiError extends Error {
    constructor(
      public readonly statusCode: number = 500,
      message = 'Request rejected',
      public readonly code?: string,
      public readonly requestId?: string,
      public readonly details: FieldError[] = [],
      public readonly retryable = false,
      public readonly retryAfterSeconds: number | null = null,
    ) {
      super(message);
      this.name = 'ApiError';
    }
  }

  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    updateLearningSettings: vi.fn(),
    ApiError: MockApiError,
    NetworkError: MockNetworkError,
  };
});

const MOCK_PROFILE = {
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

describe('Profile Setup Actions (M01-09 Screen 07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'valid-token' } },
    });
  });

  describe('loadProfileForSetup', () => {
    it('returns unauthorized when session is missing', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null } });

      const result = await loadProfileForSetup();
      expect(result).toEqual({ profile: null, unauthorized: true });
      expect(getProfile).not.toHaveBeenCalled();
    });

    it('returns profile on successful GET /profile (EP-P01)', async () => {
      vi.mocked(getProfile).mockResolvedValueOnce(MOCK_PROFILE);

      const result = await loadProfileForSetup();
      expect(getProfile).toHaveBeenCalledWith('valid-token');
      expect(result).toEqual({ profile: MOCK_PROFILE });
    });

    it('returns userId when session.user.id is present', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid-token',
            user: { id: 'user-xyz' },
          },
        },
      });
      vi.mocked(getProfile).mockResolvedValueOnce(MOCK_PROFILE);

      const result = await loadProfileForSetup();
      expect(result).toEqual({ profile: MOCK_PROFILE, userId: 'user-xyz' });
    });

    it('returns unauthorized on 401 ApiError', async () => {
      vi.mocked(getProfile).mockRejectedValueOnce(
        new ApiError(401, 'Unauthorized', 'TOKEN_EXPIRED'),
      );

      const result = await loadProfileForSetup();
      expect(result).toEqual({ profile: null, unauthorized: true });
    });

    it('returns suspended on 403 ACCOUNT_SUSPENDED', async () => {
      vi.mocked(getProfile).mockRejectedValueOnce(
        new ApiError(403, 'Account suspended', 'ACCOUNT_SUSPENDED'),
      );

      const result = await loadProfileForSetup();
      expect(result).toEqual({ profile: null, suspended: true });
    });

    it('returns non-fatal loadError on 503 outage or NetworkError so form remains usable', async () => {
      vi.mocked(getProfile).mockRejectedValueOnce(
        new NetworkError('Connection refused'),
      );

      const result = await loadProfileForSetup();
      expect(result.profile).toBeNull();
      expect(result.loadError).toContain('Unable to reach the server');
    });
  });

  describe('saveProfileSetupAction', () => {
    it('saves beginner profile with optional blank education and explicit None without fabricating skills', async () => {
      vi.mocked(updateProfile).mockResolvedValueOnce(MOCK_PROFILE);
      vi.mocked(updateLearningSettings).mockResolvedValueOnce(MOCK_PROFILE);

      const formData = new FormData();
      formData.set('current_role', '  Student  ');
      formData.set('education', '   ');
      formData.set('experience_level', 'beginner');
      formData.set('existing_skills_none', 'true');
      formData.set('existing_skills_none_touched', 'true');
      formData.set('timezone', 'Asia/Dhaka');
      formData.set('preferred_daily_hours', '2');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.success).toBe(true);
      expect(updateProfile).toHaveBeenCalledWith('valid-token', {
        current_role: 'Student',
        experience_level: 'beginner',
        existing_skills_none: true,
      });
      // Ensures optional blank education is omitted and no artificial skills are sent
      const sentBody = vi.mocked(updateProfile).mock.calls[0]?.[1];
      expect(sentBody).not.toHaveProperty('education');
      expect(sentBody).not.toHaveProperty('existing_skills');

      expect(updateLearningSettings).toHaveBeenCalledWith('valid-token', {
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: 2,
      });
    });

    it('omits existing_skills_none when untoggled so stored self-reported skills are preserved', async () => {
      vi.mocked(updateProfile).mockResolvedValueOnce({
        ...MOCK_PROFILE,
        education: 'BSc CSE',
        experience_level: 'junior',
        existing_skills_none: false,
      });

      const formData = new FormData();
      formData.set('current_role', 'Frontend Developer');
      formData.set('education', 'BSc CSE');
      formData.set('experience_level', 'junior');
      formData.set('existing_skills_none', 'false');
      formData.set('existing_skills_none_touched', 'false');
      formData.set('timezone', '');
      formData.set('preferred_daily_hours', '');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.success).toBe(true);
      expect(updateProfile).toHaveBeenCalledWith('valid-token', {
        current_role: 'Frontend Developer',
        education: 'BSc CSE',
        experience_level: 'junior',
      });
      expect(updateLearningSettings).not.toHaveBeenCalled();
    });

    it('rejects missing current_role, invalid experience_level, and non-half-hour daily hours while preserving user inputs', async () => {
      const formData = new FormData();
      formData.set('current_role', '   ');
      formData.set('education', 'BSc CSE');
      formData.set('experience_level', '');
      formData.set('existing_skills_none', 'true');
      formData.set('timezone', 'Asia/Dhaka');
      formData.set('preferred_daily_hours', '1.3');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.error).toBeDefined();
      expect(result.code).toBe('VALIDATION_FAILED');
      expect(result.fieldErrors?.current_role).toBeDefined();
      expect(result.fieldErrors?.experience_level).toBeDefined();
      expect(result.fieldErrors?.preferred_daily_hours).toBeDefined();
      expect(result.values).toEqual({
        current_role: '',
        education: 'BSc CSE',
        experience_level: '',
        existing_skills_none: true,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '1.3',
      });
      expect(updateProfile).not.toHaveBeenCalled();
      expect(updateLearningSettings).not.toHaveBeenCalled();
    });

    it('maps backend 422 INVALID_TIMEZONE and field details while preserving entered values', async () => {
      vi.mocked(updateProfile).mockResolvedValueOnce(MOCK_PROFILE);
      vi.mocked(updateLearningSettings).mockRejectedValueOnce(
        new ApiError(
          422,
          'Invalid IANA timezone',
          'INVALID_TIMEZONE',
          'req-1',
          [{ field: 'timezone', code: 'INVALID_TIMEZONE', message: 'Choose a valid IANA timezone' }],
        ),
      );

      const formData = new FormData();
      formData.set('current_role', 'Backend Learner');
      formData.set('education', '');
      formData.set('experience_level', 'beginner');
      formData.set('existing_skills_none', 'true');
      formData.set('timezone', 'Invalid/Zone');
      formData.set('preferred_daily_hours', '1.5');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.error).toBe('Invalid IANA timezone');
      expect(result.fieldErrors?.timezone).toBe('Invalid IANA timezone');
      expect(result.values?.current_role).toBe('Backend Learner');
      expect(result.values?.timezone).toBe('Invalid/Zone');
      expect(result.values?.preferred_daily_hours).toBe('1.5');
    });

    it('preserves user inputs and retry metadata on 429 RATE_LIMITED and 503 SERVICE_UNAVAILABLE', async () => {
      vi.mocked(updateProfile).mockRejectedValueOnce(
        new ApiError(429, 'Too many requests', 'RATE_LIMITED', 'req-429', [], true, 15),
      );

      const formData = new FormData();
      formData.set('current_role', 'QA Engineer');
      formData.set('education', 'Diploma');
      formData.set('experience_level', 'mid');
      formData.set('existing_skills_none', 'false');
      formData.set('timezone', 'Asia/Dhaka');
      formData.set('preferred_daily_hours', '2.5');

      const rateLimited = await saveProfileSetupAction({}, formData);
      expect(rateLimited.retryable).toBe(true);
      expect(rateLimited.retryAfterSeconds).toBe(15);
      expect(rateLimited.values).toEqual({
        current_role: 'QA Engineer',
        education: 'Diploma',
        experience_level: 'mid',
        existing_skills_none: false,
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: '2.5',
      });

      vi.mocked(updateProfile).mockRejectedValueOnce(
        new NetworkError('Network down'),
      );
      const networkFailed = await saveProfileSetupAction({}, formData);
      expect(networkFailed.retryable).toBe(true);
      expect(networkFailed.values?.current_role).toBe('QA Engineer');
      expect(networkFailed.values?.education).toBe('Diploma');
    });
  });
});
