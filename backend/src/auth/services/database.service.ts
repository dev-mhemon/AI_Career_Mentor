import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { fail } from '../../common/http.js';
@Injectable()
export class DatabaseService {
  constructor(private readonly source: DataSource) {}
  /** All application writes use a real transaction; the lock precedes data access. */
  async transaction<T>(
    userId: string | null,
    operation: (db: EntityManager) => Promise<T>,
    active = true,
  ): Promise<T> {
    return this.source.transaction('READ COMMITTED', async (db) => {
      await db.query('SET LOCAL ROLE service_role');
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
      return operation(db);
    });
  }
}
