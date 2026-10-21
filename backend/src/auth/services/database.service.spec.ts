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
});
