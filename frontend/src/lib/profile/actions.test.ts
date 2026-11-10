import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadProfileForSetup,
  saveProfileSetupAction,
  updateLearningSettingsAction,
} from '@/lib/profile/actions';
import {
  getProfile,
  updateProfile,
  updateLearningSettings,
  refreshSession,
  ApiError,
  NetworkError,
  type FieldError,
} from '@/lib/api/client';

const mockGetSession = vi.fn();
const mockSetSession = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });
const mockCreateSupabaseServerClient = vi.fn().mockImplementation(() => ({
  auth: {
    getSession: mockGetSession,
    setSession: mockSetSession,
    signOut: mockSignOut,
  },
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: (...args: unknown[]) => mockCreateSupabaseServerClient(...args),
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

  class MockUnauthorizedError extends MockApiError {
    constructor(message = 'Unauthorized', code?: string, requestId?: string) {
      super(401, message, code, requestId);
      this.name = 'UnauthorizedError';
    }
  }

  return {
    getProfile: vi.fn(),
    updateProfile: vi.fn(),
    updateLearningSettings: vi.fn(),
    refreshSession: vi.fn(),
    ApiError: MockApiError,
    NetworkError: MockNetworkError,
    UnauthorizedError: MockUnauthorizedError,
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
    it('initializes supabase client with readOnly: true during SSR', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: { session: { access_token: 'valid-token' } },
      });
      vi.mocked(getProfile).mockResolvedValueOnce(MOCK_PROFILE);

      await loadProfileForSetup();
      expect(mockCreateSupabaseServerClient).toHaveBeenCalledWith({ readOnly: true });
    });

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

    it('returns unauthorized on 401 ApiError without calling refreshSession', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'expired-token',
            refresh_token: 'valid-refresh-token',
          },
        },
      });
      vi.mocked(getProfile).mockRejectedValueOnce(
        new ApiError(401, 'Unauthorized', 'TOKEN_EXPIRED'),
      );

      const result = await loadProfileForSetup();
      expect(result).toEqual({ profile: null, unauthorized: true });
      expect(refreshSession).not.toHaveBeenCalled();
      expect(mockSetSession).not.toHaveBeenCalled();
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
      formData.set('education_touched', 'false');
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
      // Ensures untouched blank education is omitted and no artificial skills are sent
      const sentBody = vi.mocked(updateProfile).mock.calls[0]?.[1];
      expect(sentBody).not.toHaveProperty('education');
      expect(sentBody).not.toHaveProperty('education_level');
      expect(sentBody).not.toHaveProperty('existing_skills');

      expect(updateLearningSettings).toHaveBeenCalledWith('valid-token', {
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: 2,
      });

      const learningOrder =
        vi.mocked(updateLearningSettings).mock.invocationCallOrder[0] ?? 0;
      const profileOrder =
        vi.mocked(updateProfile).mock.invocationCallOrder[0] ?? 0;
      expect(learningOrder).toBeLessThan(profileOrder);
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
        education_level: 'BSc CSE',
        experience_level: 'junior',
      });
      expect(updateLearningSettings).not.toHaveBeenCalled();
    });

    it('omits education when blank and education_touched is false, and sends education_level: "" when education_touched is true', async () => {
      // 1. Untouched blank education (e.g. after profile load failure) omits education from PATCH /profile
      vi.mocked(updateProfile).mockResolvedValueOnce({
        ...MOCK_PROFILE,
        current_role: 'Lead Architect',
        education: 'MSc CS',
        experience_level: 'senior',
      });

      const untouchedFormData = new FormData();
      untouchedFormData.set('current_role', 'Lead Architect');
      untouchedFormData.set('education', '   ');
      untouchedFormData.set('education_touched', 'false');
      untouchedFormData.set('experience_level', 'senior');
      untouchedFormData.set('existing_skills_none', 'false');
      untouchedFormData.set('existing_skills_none_touched', 'false');
      untouchedFormData.set('timezone', '');
      untouchedFormData.set('preferred_daily_hours', '');

      const untouchedResult = await saveProfileSetupAction({}, untouchedFormData);

      expect(untouchedResult.success).toBe(true);
      expect(updateProfile).toHaveBeenCalledWith('valid-token', {
        current_role: 'Lead Architect',
        experience_level: 'senior',
      });
      expect(untouchedResult.values?.education).toBe('MSc CS');

      // 2. Touched blank education explicitly sends education: "" and education_level: "" to clear DB field
      vi.mocked(updateProfile).mockClear();
      vi.mocked(updateProfile).mockResolvedValueOnce({
        ...MOCK_PROFILE,
        current_role: 'Lead Architect',
        education: null,
        experience_level: 'senior',
      });

      const touchedFormData = new FormData();
      touchedFormData.set('current_role', 'Lead Architect');
      touchedFormData.set('education', '   ');
      touchedFormData.set('education_touched', 'true');
      touchedFormData.set('experience_level', 'senior');
      touchedFormData.set('existing_skills_none', 'false');
      touchedFormData.set('existing_skills_none_touched', 'false');
      touchedFormData.set('timezone', '');
      touchedFormData.set('preferred_daily_hours', '');

      const touchedResult = await saveProfileSetupAction({}, touchedFormData);

      expect(touchedResult.success).toBe(true);
      expect(updateProfile).toHaveBeenCalledWith('valid-token', {
        current_role: 'Lead Architect',
        education: '',
        education_level: '',
        experience_level: 'senior',
      });
      expect(touchedResult.values?.education).toBe('');
      expect(touchedResult.profile?.education).toBeNull();

      // 3. Populated education with education_touched = false omits education from PATCH /profile so server data is not overwritten
      vi.mocked(updateProfile).mockClear();
      vi.mocked(updateProfile).mockResolvedValueOnce({
        ...MOCK_PROFILE,
        current_role: 'Lead Architect',
        education: 'BSc CSE',
        experience_level: 'senior',
      });

      const populatedUntouchedFormData = new FormData();
      populatedUntouchedFormData.set('current_role', 'Lead Architect');
      populatedUntouchedFormData.set('education', 'BSc CSE');
      populatedUntouchedFormData.set('education_touched', 'false');
      populatedUntouchedFormData.set('experience_level', 'senior');

      const populatedResult = await saveProfileSetupAction({}, populatedUntouchedFormData);

      expect(populatedResult.success).toBe(true);
      expect(updateProfile).toHaveBeenCalledWith('valid-token', {
        current_role: 'Lead Architect',
        experience_level: 'senior',
      });
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

    it('maps backend 422 INVALID_TIMEZONE without calling updateProfile so stored skills are not cleared', async () => {
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
      formData.set('existing_skills_none_touched', 'true');
      formData.set('timezone', 'Invalid/Zone');
      formData.set('preferred_daily_hours', '1.5');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.error).toBe('Invalid IANA timezone');
      expect(result.fieldErrors?.timezone).toBe('Invalid IANA timezone');
      expect(result.values?.current_role).toBe('Backend Learner');
      expect(result.values?.timezone).toBe('Invalid/Zone');
      expect(result.values?.preferred_daily_hours).toBe('1.5');
      expect(updateProfile).not.toHaveBeenCalled();
    });

    it('returns committed profile snapshot when updateLearningSettings succeeds but updateProfile fails', async () => {
      const committedLearningProfile = {
        ...MOCK_PROFILE,
        timezone: 'Europe/Berlin',
        preferred_daily_hours: 3.5,
      };
      vi.mocked(updateLearningSettings).mockResolvedValueOnce(
        committedLearningProfile,
      );
      vi.mocked(updateProfile).mockRejectedValueOnce(
        new NetworkError('Transient failure during profile patch'),
      );

      const formData = new FormData();
      formData.set('current_role', 'Platform Engineer');
      formData.set('education', 'BSc CS');
      formData.set('experience_level', 'mid');
      formData.set('existing_skills_none', 'false');
      formData.set('existing_skills_none_touched', 'false');
      formData.set('timezone', 'Europe/Berlin');
      formData.set('preferred_daily_hours', '3.5');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.error).toContain('Unable to reach the server');
      expect(result.retryable).toBe(true);
      expect(result.profile).toEqual(committedLearningProfile);
      expect(result.values?.current_role).toBe('Platform Engineer');
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

    it('propagates rotated tokens across sequential calls when the first call triggers a 401 refresh', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'expired-token',
            refresh_token: 'valid-refresh-token',
          },
        },
      });
      mockSetSession.mockResolvedValueOnce({ error: null });
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });

      vi.mocked(updateLearningSettings)
        .mockRejectedValueOnce(new ApiError(401, 'Expired token', 'TOKEN_EXPIRED'))
        .mockResolvedValueOnce({
          ...MOCK_PROFILE,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: 2,
        });

      vi.mocked(updateProfile).mockResolvedValueOnce({
        ...MOCK_PROFILE,
        current_role: 'Engineer',
      });

      const formData = new FormData();
      formData.set('current_role', 'Engineer');
      formData.set('experience_level', 'junior');
      formData.set('timezone', 'Asia/Dhaka');
      formData.set('preferred_daily_hours', '2');

      const result = await saveProfileSetupAction({}, formData);

      expect(result.success).toBe(true);
      expect(refreshSession).toHaveBeenCalledTimes(1);
      expect(refreshSession).toHaveBeenCalledWith('valid-refresh-token');
      expect(updateLearningSettings).toHaveBeenNthCalledWith(1, 'expired-token', {
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: 2,
      });
      expect(updateLearningSettings).toHaveBeenNthCalledWith(2, 'new-token', {
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: 2,
      });
      expect(updateProfile).toHaveBeenCalledTimes(1);
      expect(updateProfile).toHaveBeenCalledWith(
        'new-token',
        expect.objectContaining({
          current_role: 'Engineer',
        }),
      );
    });
  });

  describe('updateLearningSettingsAction (M02-04 Screen 22 EP-P04)', () => {
    it('validates IANA timezone and preferred_daily_hours (0.5..12.0 in 0.5 increments) and rejects invalid inputs', async () => {
      const invalidTzForm = new FormData();
      invalidTzForm.set('timezone', 'Not/A_Real_Zone');
      invalidTzForm.set('preferred_daily_hours', '1.3');

      const invalidResult = await updateLearningSettingsAction({}, invalidTzForm);
      expect(invalidResult.code).toBe('VALIDATION_FAILED');
      expect(invalidResult.fieldErrors?.timezone).toContain('valid IANA timezone');
      expect(invalidResult.fieldErrors?.preferred_daily_hours).toContain(
        'between 0.5 and 12 in 0.5-hour increments',
      );
      expect(updateLearningSettings).not.toHaveBeenCalled();

      const outOfRangeForm = new FormData();
      outOfRangeForm.set('timezone', 'Asia/Dhaka');
      outOfRangeForm.set('preferred_daily_hours', '12.5');

      const outOfRangeResult = await updateLearningSettingsAction(
        {},
        outOfRangeForm,
      );
      expect(outOfRangeResult.code).toBe('VALIDATION_FAILED');
      expect(outOfRangeResult.fieldErrors?.preferred_daily_hours).toBeDefined();
    });

    it('updates learning settings via EP-P04 and retries once after refreshing session on 401', async () => {
      mockGetSession.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'expired-token',
            refresh_token: 'valid-refresh-token',
          },
        },
      });
      mockSetSession.mockResolvedValueOnce({ error: null });
      vi.mocked(refreshSession).mockResolvedValueOnce({
        access_token: 'new-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        user: {
          id: 'user-1',
          email: 'user@example.com',
          phone: null,
          role: 'USER',
          status: 'active',
          linked_providers: ['email'],
          verified_contact: true,
        },
        profile_complete: true,
        next_step: 'app_home',
      });
      vi.mocked(updateLearningSettings)
        .mockRejectedValueOnce(new ApiError(401, 'Expired token', 'TOKEN_EXPIRED'))
        .mockResolvedValueOnce({
          ...MOCK_PROFILE,
          timezone: 'Asia/Dhaka',
          preferred_daily_hours: 3.5,
        });

      const formData = new FormData();
      formData.set('timezone', 'Asia/Dhaka');
      formData.set('preferred_daily_hours', '3.5');

      const result = await updateLearningSettingsAction({}, formData);
      expect(result.success).toBe(true);
      expect(refreshSession).toHaveBeenCalledWith('valid-refresh-token');
      expect(updateLearningSettings).toHaveBeenCalledTimes(2);
      expect(updateLearningSettings).toHaveBeenNthCalledWith(2, 'new-token', {
        timezone: 'Asia/Dhaka',
        preferred_daily_hours: 3.5,
      });
    });

    it('safely handles non-string or File payloads without throwing TypeError', async () => {
      const badForm = new FormData();
      badForm.set('timezone', new File([''], 'test.png'));
      badForm.set('preferred_daily_hours', new File([''], 'test.png'));

      const res = await updateLearningSettingsAction({}, badForm);
      expect(res.code).toBe('VALIDATION_FAILED');
      expect(res.fieldErrors?.timezone).toBeDefined();
      expect(res.fieldErrors?.preferred_daily_hours).toBeDefined();
    });
  });
});
