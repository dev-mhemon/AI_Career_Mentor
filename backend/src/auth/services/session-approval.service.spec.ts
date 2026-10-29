import type { EntityManager } from 'typeorm';
import { SessionApprovalService } from './session-approval.service.js';

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
});
