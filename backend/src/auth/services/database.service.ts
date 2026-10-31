import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { fail } from '../../common/http.js';
@Injectable()
export class DatabaseService {
  constructor(private readonly source: DataSource) {}
  async query<T = any>(query: string, parameters?: unknown[]): Promise<T> {
    return this.source.query(query, parameters);
  }
  /** All application writes use a real transaction; the lock precedes data access. */
  async transaction<T>(
    userId: string | null,
    operation: (db: EntityManager) => Promise<T>,
    active = true,
    foreground = false,
    useServiceRole = true,
  ): Promise<T> {
    const runInTransaction = async (db: EntityManager): Promise<T> => {
      if (useServiceRole) {
        await db.query('SET LOCAL ROLE service_role');
      }
      if (userId) {
        await db.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [userId],
        );
        const [account] = await db.query(
          'SELECT status FROM public.users WHERE id=$1 FOR UPDATE',
          [userId],
        );
        if (active && !account)
          fail(401, 'AUTH_REQUIRED', 'Application account not found');
        if (active && account.status !== 'active')
          fail(403, 'ACCOUNT_SUSPENDED', 'Account suspended');
      }
      const result = await operation(db);
      if (userId && foreground) {
        // C05 R24: server time; serialized, coalesced and committed with the successful action.
        await db.query(
          `UPDATE public.users SET last_active_at=GREATEST(COALESCE(last_active_at,'-infinity'::timestamptz),clock_timestamp())
          WHERE id=$1 AND (last_active_at IS NULL OR last_active_at <= clock_timestamp()-interval '5 minutes')`,
          [userId],
        );
      }
      return result;
    };

    if (typeof this.source.createQueryRunner === 'function') {
      const qr = this.source.createQueryRunner();
      let transactionStarted = false;
      try {
        await qr.connect();
        await qr.startTransaction('READ COMMITTED');
        transactionStarted = true;
        const result = await runInTransaction(qr.manager);
        await qr.commitTransaction();
        return result;
      } catch (error) {
        if (transactionStarted) {
          await qr.rollbackTransaction();
        }
        throw error;
      } finally {
        await qr.release();
      }
    }

    return this.source.transaction('READ COMMITTED', runInTransaction);
  }
}
