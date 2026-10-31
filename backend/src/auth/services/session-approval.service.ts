import { Injectable, Optional } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DatabaseService } from './database.service.js';
import { fail } from '../../common/http.js';

export type SessionApprovalSource =
  'email_verification' | 'password_login' | 'oauth';

@Injectable()
export class SessionApprovalService {
  constructor(@Optional() private readonly database?: DatabaseService) {}

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

  async revokeSession(
    userId: string,
    sessionId: string,
    db?: EntityManager,
  ): Promise<boolean> {
    const runner = db ?? this.database;
    if (!runner) {
      fail(500, 'INTERNAL_ERROR', 'Database unavailable');
    }
    const result = await runner.query(
      `UPDATE private.approved_auth_sessions
          SET revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE user_id = $1::uuid
          AND session_id = $2::uuid
          AND revoked_at IS NULL`,
      [userId, sessionId],
    );
    if (Array.isArray(result) && typeof result[1] === 'number') {
      return result[1] > 0;
    }
    if (result && typeof (result as any).rowCount === 'number') {
      return (result as any).rowCount > 0;
    }
    return true;
  }

  async revokeAllUserSessions(
    userId: string,
    db?: EntityManager,
  ): Promise<number> {
    const runner = db ?? this.database;
    if (!runner) {
      fail(500, 'INTERNAL_ERROR', 'Database unavailable');
    }
    const result = await runner.query(
      `UPDATE private.approved_auth_sessions
          SET revoked_at = clock_timestamp(),
              updated_at = clock_timestamp()
        WHERE user_id = $1::uuid
          AND revoked_at IS NULL`,
      [userId],
    );
    if (Array.isArray(result) && typeof result[1] === 'number') {
      return result[1];
    }
    if (result && typeof (result as any).rowCount === 'number') {
      return (result as any).rowCount;
    }
    return 0;
  }

  async isSessionApproved(
    userId: string,
    sessionId: string,
    db?: EntityManager,
  ): Promise<boolean> {
    const runner = db ?? this.database;
    if (!runner) {
      fail(500, 'INTERNAL_ERROR', 'Database unavailable');
    }
    const rows = await runner.query(
      `SELECT 1
         FROM private.approved_auth_sessions a
         JOIN public.users u ON u.id = a.user_id
        WHERE a.user_id = $1::uuid
          AND a.session_id = $2::uuid
          AND a.revoked_at IS NULL
          AND u.status = 'active'
          AND u.verified_contact = true
        LIMIT 1`,
      [userId, sessionId],
    );
    return Array.isArray(rows) && rows.length > 0;
  }
}
