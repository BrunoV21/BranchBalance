import type { RemoteGroupSnapshot } from '@/domain/types';

import { hydrateCachedSnapshot } from './snapshot-reconciliation';

describe('CR-001 cache hydration', () => {
  it('normalizes a Phase 1 snapshot and recomputes spending without changing its cache key version', () => {
    const legacy = {
      key: 'owner/branch-balance-trip',
      repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
      group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-13T12:00:00.000Z' },
      members: [{ login: 'owner', name: null, avatarUrl: null, role: 'owner' }], pendingMembers: [],
      expenses: [{ expense: { schema_version: 1, id: '11111111-1111-4111-8111-111111111111', description: 'Legacy dinner', amount_minor: 1000, currency: 'EUR', paid_by: 'owner', split_type: 'equal', participants: ['owner'], shares_minor: { owner: 1000 }, expense_date: '2026-07-16', created_by: 'owner', created_at: '2026-07-16T12:00:00.000Z', updated_by: null, updated_at: null }, blobSha: 'expense-sha', path: 'expenses/11111111-1111-4111-8111-111111111111.json' }],
      balances: { totalSpentMinor: 1000, members: [], zeroSum: true }, settlements: [], warnings: [], syncedAt: '2026-07-17T12:00:00.000Z',
    } as unknown as RemoteGroupSnapshot;

    const hydrated = hydrateCachedSnapshot(legacy, 'owner', '2026-07-17');

    expect(hydrated.groupFile).toBeNull();
    expect(hydrated.expenses[0]?.expense).toMatchObject({ category: null, payment_method: null });
    expect(hydrated.expenses[0]?.sourceDocument).not.toHaveProperty('category');
    expect(hydrated.spending).toMatchObject({ totalSpentMinor: 1000, currentUserPaidMinor: 1000, currentUserShareMinor: 1000 });
    expect(hydrated.spending?.categorySpentMinor.uncategorized).toBe(1000);
  });
});
