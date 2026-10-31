import { DatabaseService } from './database.service.js';
import type { DataSource } from 'typeorm';
function fixture() {
  const query = vi.fn().mockResolvedValue([{ status: 'active' }]);
  const source = {
    transaction: vi.fn((_isolation, operation) => operation({ query })),
  };
  return {
    query,
    service: new DatabaseService(source as unknown as DataSource),
  };
}
describe('C05 R24 foreground activity transaction', () => {
  it('runs coalesced server activity only after successful explicit work', async () => {
    const { query, service } = fixture();
    const work = vi.fn(async () => {
      expect(
        query.mock.calls.some(([sql]) => sql.includes('UPDATE public.users')),
      ).toBe(false);
      return 'saved';
    });
    expect(await service.transaction('owner', work, true, true)).toBe('saved');
    expect(
      query.mock.calls.filter(([sql]) => sql.includes('UPDATE public.users')),
    ).toHaveLength(1);
  });
  it('does not update activity for passive reads', async () => {
    const { query, service } = fixture();
    await service.transaction('owner', async () => 'read');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.users')),
    ).toBe(false);
  });
  it('does not update activity when foreground work throws', async () => {
    const { query, service } = fixture();
    await expect(
      service.transaction(
        'owner',
        async () => {
          throw Error('rollback');
        },
        true,
        true,
      ),
    ).rejects.toThrow('rollback');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('UPDATE public.users')),
    ).toBe(false);
  });
  it('releases query runner without calling rollbackTransaction if startTransaction rejects after connect', async () => {
    let releaseAwaited = false;
    const qr = {
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi
        .fn()
        .mockRejectedValue(new Error('BEGIN failed after connect')),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi.fn(),
      release: vi.fn(async () => {
        await Promise.resolve();
        releaseAwaited = true;
      }),
      manager: { query: vi.fn() },
    };
    const source = {
      createQueryRunner: vi.fn(() => qr),
    };
    const service = new DatabaseService(source as unknown as DataSource);

    await expect(
      service.transaction('owner', async () => 'unreachable'),
    ).rejects.toThrow('BEGIN failed after connect');

    expect(qr.connect).toHaveBeenCalledTimes(1);
    expect(qr.startTransaction).toHaveBeenCalledWith('READ COMMITTED');
    expect(qr.rollbackTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalledTimes(1);
    expect(releaseAwaited).toBe(true);
  });

  it('preserves and rethrows the original error if rollbackTransaction rejects, while still releasing query runner', async () => {
    let releaseAwaited = false;
    const originalError = Object.assign(
      new Error('canceling statement due to statement timeout'),
      { code: '57014' },
    );
    const qr = {
      connect: vi.fn().mockResolvedValue(undefined),
      startTransaction: vi.fn().mockResolvedValue(undefined),
      commitTransaction: vi.fn(),
      rollbackTransaction: vi
        .fn()
        .mockRejectedValue(new Error('connection terminated unexpectedly')),
      release: vi.fn(async () => {
        await Promise.resolve();
        releaseAwaited = true;
      }),
      manager: {
        query: vi.fn().mockResolvedValue([{ status: 'active' }]),
      },
    };
    const source = {
      createQueryRunner: vi.fn(() => qr),
    };
    const service = new DatabaseService(source as unknown as DataSource);

    await expect(
      service.transaction('owner', async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);

    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(qr.release).toHaveBeenCalledTimes(1);
    expect(releaseAwaited).toBe(true);
  });
});
