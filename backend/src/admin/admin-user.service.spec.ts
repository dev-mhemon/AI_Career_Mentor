import { describe, expect, it, vi } from 'vitest';
import type { DatabaseService } from '../auth/services/database.service.js';
import {
  AdminUserService,
  escapeLikePattern,
  formatMaskedContact,
  maskEmail,
} from './services/admin-user.service.js';
import { AuditService, decodeKeysetCursor } from './services/audit.service.js';

const ADMIN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '99999999-9999-4999-8999-999999999999';

function createMockDb(
  handler: (sql: string, params?: unknown[]) => Promise<unknown[]>,
) {
  const queryMock = vi.fn(handler);
  const database = {
    transaction: vi.fn(
      async (
        _userId: string | null,
        operation: (db: { query: typeof queryMock }) => Promise<unknown>,
      ) => operation({ query: queryMock }),
    ),
  };
  return {
    database: database as unknown as DatabaseService,
    queryMock,
    transactionMock: database.transaction,
  };
}

describe('AdminUserService (EP-AD01..EP-AD03)', () => {
  describe('masking and LIKE escaping helpers', () => {
    it('masks email and phone contacts without exposing raw PII', () => {
      expect(maskEmail('mehedi@example.com')).toBe('m***@example.com');
      expect(maskEmail('a@bd.dev')).toBe('a***@bd.dev');
      expect(formatMaskedContact('mehedi@example.com', null)).toBe(
        'm***@example.com',
      );
      expect(formatMaskedContact(null, '+8801712345678')).toBe('+8801****5678');
      expect(formatMaskedContact('mehedi@example.com', '+8801712345678')).toBe(
        'm***@example.com / +8801****5678',
      );
      expect(formatMaskedContact(null, null)).toBe('unverified');
    });

    it('escapes PostgreSQL LIKE wildcards (%, _, \\)', () => {
      expect(escapeLikePattern('100%_test\\path')).toBe(
        '100\\%\\_test\\\\path',
      );
    });
  });

  describe('EP-AD01 listUsers', () => {
    it('excludes platform admin accounts, uses exact UUID match when q is a UUID, escapes LIKE wildcards otherwise, exposes full email/phone alongside contact_masked, and emits base64url microsecond cursor', async () => {
      const executed: Array<{ sql: string; params?: unknown[] }> = [];
      const { database } = createMockDb(async (sql, params) => {
        executed.push({ sql, params });
        return [
          {
            id: TARGET_ID,
            email: 'learner@example.com',
            phone: '+8801712345678',
            status: 'active',
            created_at: new Date('2026-11-24T10:00:00.123Z'),
            created_at_cursor: '2026-11-24T10:00:00.123456Z',
            last_active_at: new Date('2026-11-24T12:00:00.000Z'),
            roadmap_count: 2,
            technology_update_enabled: false,
          },
          {
            id: '33333333-3333-4333-8333-333333333333',
            email: 'second@example.com',
            phone: null,
            status: 'active',
            created_at: new Date('2026-11-23T10:00:00.000Z'),
            created_at_cursor: '2026-11-23T10:00:00.000000Z',
            last_active_at: null,
            roadmap_count: 0,
            technology_update_enabled: true,
          },
        ];
      });

      const auditService = new AuditService(database);
      const service = new AdminUserService(database, auditService);

      const page = await service.listUsers(ADMIN_ID, {
        q: '100%_admin\\x',
        status: 'active',
        limit: 1,
      });

      expect(page.items).toHaveLength(1);
      expect(page.items[0].email).toBe('learner@example.com');
      expect(page.items[0].phone).toBe('+8801712345678');
      expect(page.items[0].contact_masked).toBe(
        'l***@example.com / +8801****5678',
      );
      expect(page.meta.limit).toBe(1);
      expect(page.meta.next_cursor).toBeTruthy();

      const decoded = decodeKeysetCursor(page.meta.next_cursor!);
      expect(decoded).toEqual({
        createdAt: '2026-11-24T10:00:00.123456Z',
        id: TARGET_ID,
      });

      // Platform admin accounts are strictly excluded from EP-AD01 results
      expect(executed[0].sql).toContain(
        'NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = u.id)',
      );
      expect(executed[0].sql).toContain("ESCAPE '\\'");
      expect(executed[0].params).toContain('%100\\%\\_admin\\\\x%');

      // Exact UUID search branch also preserves admin exclusion
      await service.listUsers(ADMIN_ID, { q: TARGET_ID.toUpperCase() });
      expect(executed[1].sql).toContain(
        'NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.user_id = u.id)',
      );
      expect(executed[1].sql).toContain('u.id = $1::uuid');
      expect(executed[1].params?.[0]).toBe(TARGET_ID);
    });
  });

  describe('EP-AD02 getUserDetail', () => {
    it('returns masked summary, 7-row effective feature matrix, and aggregate counts only (zero private text)', async () => {
      const queries: string[] = [];
      const { database } = createMockDb(async (sql) => {
        queries.push(sql);
        if (sql.includes('FROM public.users u')) {
          return [
            {
              id: TARGET_ID,
              email: 'student@example.com',
              phone: null,
              status: 'active',
              created_at: '2026-11-01T00:00:00.000Z',
              last_active_at: null,
            },
          ];
        }
        if (sql.includes('FROM public.feature_controls fc')) {
          return [
            {
              feature_key: 'roadmap_generator',
              global_enabled: true,
              default_user_enabled: true,
              user_override: null,
            },
            {
              feature_key: 'daily_plan',
              global_enabled: false,
              default_user_enabled: true,
              user_override: true,
            },
            {
              feature_key: 'quiz_practice',
              global_enabled: true,
              default_user_enabled: true,
              user_override: false,
            },
            {
              feature_key: 'ai_practice_review',
              global_enabled: true,
              default_user_enabled: true,
              user_override: null,
            },
            {
              feature_key: 'progress_tracking',
              global_enabled: true,
              default_user_enabled: true,
              user_override: null,
            },
            {
              feature_key: 'ai_mentor',
              global_enabled: true,
              default_user_enabled: true,
              user_override: null,
            },
            {
              feature_key: 'technology_update',
              global_enabled: true,
              default_user_enabled: false,
              user_override: true,
            },
          ];
        }
        if (sql.includes('AS mentor_messages')) {
          return [
            {
              roadmaps: 2,
              quizzes_submitted: 4,
              mentor_messages: 19,
              ai_requests: 44,
            },
          ];
        }
        return [];
      });

      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      const detail = await service.getUserDetail(ADMIN_ID, TARGET_ID);

      expect(detail.email).toBe('student@example.com');
      expect(detail.phone).toBeNull();
      expect(detail.contact_masked).toBe('s***@example.com');
      expect(detail.feature_access).toHaveLength(7);
      // Global OFF beats user_override=true
      expect(
        detail.feature_access.find((f) => f.feature_key === 'daily_plan'),
      ).toEqual({
        feature_key: 'daily_plan',
        global_enabled: false,
        user_override: true,
        effective: false,
      });
      // User override=true on technology_update with global ON => effective true
      expect(detail.technology_update_enabled).toBe(true);
      expect(detail.counts).toEqual({
        roadmaps: 2,
        quizzes_submitted: 4,
        mentor_messages: 19,
        ai_requests: 44,
      });

      // Strict privacy boundary: never selects message content, answer_text, summary_text, or input_payload
      const joinedSql = queries.join('\n').toLowerCase();
      expect(joinedSql).not.toContain('content');
      expect(joinedSql).not.toContain('answer_text');
      expect(joinedSql).not.toContain('summary_text');
      expect(joinedSql).not.toContain('input_payload');
    });

    it('throws 404 RESOURCE_NOT_FOUND when target user does not exist', async () => {
      const { database } = createMockDb(async () => []);
      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      await expect(
        service.getUserDetail(ADMIN_ID, TARGET_ID),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'RESOURCE_NOT_FOUND' },
      });
    });
  });

  describe('EP-AD03 updateUserStatus (suspend & reactivate)', () => {
    it('acquires locks in deterministic ascending UUID order, suspends user with ck_users_suspension_consistent fields, and writes atomic audit log', async () => {
      const lockedOrder: string[] = [];
      let updateSql = '';
      let updateParams: unknown[] | undefined;
      let auditSql = '';
      let auditParams: unknown[] | undefined;
      let currentStatus: 'active' | 'suspended' = 'active';

      const { database } = createMockDb(async (sql, params) => {
        if (sql.includes('pg_advisory_xact_lock(hashtextextended')) {
          lockedOrder.push(String(params?.[0]));
          return [];
        }
        if (sql.includes('FOR UPDATE')) {
          return [
            {
              id: TARGET_ID,
              status: currentStatus,
              status_reason: null,
              suspended_at: null,
              suspended_by: null,
            },
            {
              id: ADMIN_ID,
              status: 'active',
              status_reason: null,
              suspended_at: null,
              suspended_by: null,
            },
          ];
        }
        if (sql.includes('AS is_admin')) {
          return [{ status: 'active', is_admin: true }];
        }
        if (sql.includes('FROM public.admin_users WHERE user_id = $1')) {
          return [];
        }
        if (sql.startsWith('UPDATE public.users')) {
          updateSql = sql;
          updateParams = params;
          currentStatus = 'suspended';
          return [];
        }
        if (sql.includes('INSERT INTO public.admin_audit_logs')) {
          auditSql = sql;
          auditParams = params;
          return [];
        }
        if (sql.includes('FROM public.users u')) {
          return [
            {
              id: TARGET_ID,
              email: 'learner@example.com',
              phone: null,
              status: currentStatus,
              created_at: '2026-11-01T00:00:00.000Z',
              last_active_at: null,
            },
          ];
        }
        if (sql.includes('FROM public.feature_controls fc')) {
          return [
            {
              feature_key: 'technology_update',
              global_enabled: true,
              default_user_enabled: false,
              user_override: true,
            },
          ];
        }
        if (sql.includes('AS mentor_messages')) {
          return [
            {
              roadmaps: 1,
              quizzes_submitted: 2,
              mentor_messages: 3,
              ai_requests: 4,
            },
          ];
        }
        return [];
      });

      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      const updated = await service.updateUserStatus(
        ADMIN_ID,
        TARGET_ID,
        { status: 'suspended', reason: '  Abuse of AI endpoints  ' },
        { requestId: REQUEST_ID, ipAddress: '203.0.113.10' },
      );

      // TARGET_ID ('2222...') < ADMIN_ID ('aaaa...') so TARGET_ID must be locked first
      expect(lockedOrder).toEqual([TARGET_ID, ADMIN_ID]);
      expect(updateSql).toContain("status = 'suspended'::public.user_status");
      expect(updateSql).toContain('suspended_at = now()');
      expect(updateSql).toContain('suspended_by = $3');
      expect(updateParams).toEqual([
        TARGET_ID,
        'Abuse of AI endpoints',
        ADMIN_ID,
      ]);

      expect(auditSql).toContain('INSERT INTO public.admin_audit_logs');
      expect(auditParams?.[0]).toBe(ADMIN_ID);
      expect(auditParams?.[1]).toBe('user.suspend');
      expect(auditParams?.[2]).toBe('user');
      expect(auditParams?.[3]).toBe(TARGET_ID);
      expect(auditParams?.[4]).toBe(TARGET_ID);
      expect(auditParams?.[7]).toBe(REQUEST_ID);
      expect(auditParams?.[8]).toBe('203.0.113.10');

      // Suspension overrides all feature permissions
      expect(updated.status).toBe('suspended');
      expect(updated.technology_update_enabled).toBe(false);
      expect(updated.feature_access.every((f) => f.effective === false)).toBe(
        true,
      );
    });

    it('clears status_reason, suspended_at, and suspended_by on reactivation (ck_users_suspension_consistent)', async () => {
      let updateSql = '';
      let currentStatus: 'active' | 'suspended' = 'suspended';

      const { database } = createMockDb(async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return [
            {
              id: TARGET_ID,
              status: currentStatus,
              status_reason: 'Prior issue',
              suspended_at: '2026-11-20T00:00:00.000Z',
              suspended_by: ADMIN_ID,
            },
          ];
        }
        if (sql.includes('AS is_admin')) {
          return [{ status: 'active', is_admin: true }];
        }
        if (sql.includes('FROM public.admin_users WHERE user_id = $1')) {
          return [];
        }
        if (sql.startsWith('UPDATE public.users')) {
          updateSql = sql;
          currentStatus = 'active';
          return [];
        }
        if (sql.includes('FROM public.users u')) {
          return [
            {
              id: TARGET_ID,
              email: 'learner@example.com',
              phone: null,
              status: currentStatus,
              created_at: '2026-11-01T00:00:00.000Z',
              last_active_at: null,
            },
          ];
        }
        if (sql.includes('FROM public.feature_controls fc')) {
          return [
            {
              feature_key: 'roadmap_generator',
              global_enabled: true,
              default_user_enabled: true,
              user_override: null,
            },
          ];
        }
        if (sql.includes('AS mentor_messages')) {
          return [
            {
              roadmaps: 1,
              quizzes_submitted: 0,
              mentor_messages: 0,
              ai_requests: 0,
            },
          ];
        }
        return [];
      });

      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      const updated = await service.updateUserStatus(
        ADMIN_ID,
        TARGET_ID,
        { status: 'active', reason: 'Appeal approved' },
        { requestId: null, ipAddress: null },
      );

      expect(updateSql).toContain("status = 'active'::public.user_status");
      expect(updateSql).toContain('status_reason = NULL');
      expect(updateSql).toContain('suspended_at = NULL');
      expect(updateSql).toContain('suspended_by = NULL');
      expect(updated.status).toBe('active');
    });

    it('rejects modifying an admin account with 403 CANNOT_MODIFY_ADMIN', async () => {
      const { database } = createMockDb(async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return [
            {
              id: TARGET_ID,
              status: 'active',
              status_reason: null,
              suspended_at: null,
              suspended_by: null,
            },
          ];
        }
        if (sql.includes('AS is_admin')) {
          return [{ status: 'active', is_admin: true }];
        }
        if (sql.includes('FROM public.admin_users WHERE user_id = $1')) {
          return [{ '?column?': 1 }];
        }
        return [];
      });

      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      await expect(
        service.updateUserStatus(
          ADMIN_ID,
          TARGET_ID,
          { status: 'suspended', reason: 'Attempting admin suspend' },
          { requestId: null, ipAddress: null },
        ),
      ).rejects.toMatchObject({
        status: 403,
        response: { code: 'CANNOT_MODIFY_ADMIN' },
      });
    });

    it('rejects unchanged status with 409 STATUS_UNCHANGED', async () => {
      const { database } = createMockDb(async (sql) => {
        if (sql.includes('FOR UPDATE')) {
          return [
            {
              id: TARGET_ID,
              status: 'suspended',
              status_reason: 'Already suspended',
              suspended_at: '2026-11-20T00:00:00.000Z',
              suspended_by: ADMIN_ID,
            },
          ];
        }
        if (sql.includes('AS is_admin')) {
          return [{ status: 'active', is_admin: true }];
        }
        if (sql.includes('FROM public.admin_users WHERE user_id = $1')) {
          return [];
        }
        return [];
      });

      const service = new AdminUserService(
        database,
        new AuditService(database),
      );
      await expect(
        service.updateUserStatus(
          ADMIN_ID,
          TARGET_ID,
          { status: 'suspended', reason: 'Duplicate suspend' },
          { requestId: null, ipAddress: null },
        ),
      ).rejects.toMatchObject({
        status: 409,
        response: { code: 'STATUS_UNCHANGED' },
      });
    });
  });
});
