import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncUser, getMe, ApiError, UnauthorizedError, NetworkError } from '@/lib/api/client';

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
});
