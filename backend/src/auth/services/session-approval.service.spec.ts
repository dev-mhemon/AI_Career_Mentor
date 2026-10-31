import type { EntityManager } from 'typeorm';
import { SessionApprovalService } from './session-approval.service.js';
import type { DatabaseService } from './database.service.js';

describe('SessionApprovalService', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  it('approves only the exact live provider session selected by the database', async () => {
    const query = vi.fn().mockResolvedValue([{ approved: true }]);
    const service = new SessionApprovalService();

    await service.approve(
      { query } as unknown as EntityManager,
      userId,
      sessionId,
      'password_login',
    );

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('private.approve_auth_session'),
      [userId, sessionId, 'password_login'],
    );
  });

  it('fails closed when no matching verified live session can be persisted', async () => {
    const service = new SessionApprovalService();

    await expect(
      service.approve(
        { query: vi.fn().mockResolvedValue([]) } as unknown as EntityManager,
        userId,
        sessionId,
        'email_verification',
      ),
    ).rejects.toMatchObject({
      status: 503,
      response: { code: 'SERVICE_UNAVAILABLE' },
    });
  });

  describe('revokeSession', () => {
    it('executes UPDATE on private.approved_auth_sessions setting revoked_at and updated_at', async () => {
      const query = vi.fn().mockResolvedValue([[], 1]);
      const database = { query } as unknown as DatabaseService;
      const service = new SessionApprovalService(database);

      const result = await service.revokeSession(userId, sessionId);

      expect(result).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(
          /UPDATE private\.approved_auth_sessions\s+SET revoked_at = clock_timestamp\(\),\s+updated_at = clock_timestamp\(\)\s+WHERE user_id = \$1::uuid\s+AND session_id = \$2::uuid\s+AND revoked_at IS NULL/,
        ),
        [userId, sessionId],
      );
    });

    it('uses passed EntityManager when provided', async () => {
      const dbQuery = vi.fn().mockResolvedValue({ rowCount: 1 });
      const service = new SessionApprovalService();

      const result = await service.revokeSession(userId, sessionId, {
        query: dbQuery,
      } as unknown as EntityManager);

      expect(result).toBe(true);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE private.approved_auth_sessions'),
        [userId, sessionId],
      );
    });

    it('returns false when no rows were updated', async () => {
      const query = vi.fn().mockResolvedValue([[], 0]);
      const database = { query } as unknown as DatabaseService;
      const service = new SessionApprovalService(database);

      const result = await service.revokeSession(userId, sessionId);
      expect(result).toBe(false);
    });
  });

  describe('isSessionApproved', () => {
    it('returns true when session exists, is not revoked, and user is active/verified', async () => {
      const query = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
      const database = { query } as unknown as DatabaseService;
      const service = new SessionApprovalService(database);

      const approved = await service.isSessionApproved(userId, sessionId);

      expect(approved).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(
          /SELECT 1\s+FROM private\.approved_auth_sessions a\s+JOIN public\.users u ON u\.id = a\.user_id\s+WHERE a\.user_id = \$1::uuid\s+AND a\.session_id = \$2::uuid\s+AND a\.revoked_at IS NULL\s+AND u\.status = 'active'\s+AND u\.verified_contact = true/,
        ),
        [userId, sessionId],
      );
    });

    it('returns false when query returns empty rows (revoked, unapproved, or unverified user)', async () => {
      const query = vi.fn().mockResolvedValue([]);
      const database = { query } as unknown as DatabaseService;
      const service = new SessionApprovalService(database);

      const approved = await service.isSessionApproved(userId, sessionId);

      expect(approved).toBe(false);
    });
  });

  describe('revokeAllUserSessions', () => {
    it('executes UPDATE on private.approved_auth_sessions revoking all unrevoked sessions for user', async () => {
      const query = vi.fn().mockResolvedValue([[], 3]);
      const database = { query } as unknown as DatabaseService;
      const service = new SessionApprovalService(database);

      const count = await service.revokeAllUserSessions(userId);

      expect(count).toBe(3);
      expect(query).toHaveBeenCalledWith(
        expect.stringMatching(
          /UPDATE private\.approved_auth_sessions\s+SET revoked_at = clock_timestamp\(\),\s+updated_at = clock_timestamp\(\)\s+WHERE user_id = \$1::uuid\s+AND revoked_at IS NULL/,
        ),
        [userId],
      );
    });

    it('uses passed EntityManager when provided', async () => {
      const dbQuery = vi.fn().mockResolvedValue({ rowCount: 2 });
      const service = new SessionApprovalService();

      const count = await service.revokeAllUserSessions(userId, {
        query: dbQuery,
      } as unknown as EntityManager);

      expect(count).toBe(2);
      expect(dbQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE private.approved_auth_sessions'),
        [userId],
      );
    });
  });
});
