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

    it('throws ApiError with backend message on non-401 errors', async () => {
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
        new ApiError(500, 'Database connection failed', 'INTERNAL_ERROR'),
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
