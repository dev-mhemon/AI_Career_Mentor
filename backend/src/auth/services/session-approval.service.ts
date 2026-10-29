import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { fail } from '../../common/http.js';

export type SessionApprovalSource =
  'email_verification' | 'password_login' | 'oauth';

@Injectable()
export class SessionApprovalService {
  async approve(
    db: EntityManager,
    userId: string,
    sessionId: string,
    source: SessionApprovalSource,
  ): Promise<void> {
    const rows = await db.query(
      'SELECT private.approve_auth_session($1,$2,$3) AS approved',
      [userId, sessionId, source],
    );
    if (rows.length !== 1 || rows[0].approved !== true)
      fail(
        503,
        'SERVICE_UNAVAILABLE',
        'Session approval could not be persisted',
      );
  }
}
