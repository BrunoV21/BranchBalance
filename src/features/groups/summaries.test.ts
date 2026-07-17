import type { DiscoveredGroup } from '@/domain/types';

import { calculateGroupAggregates } from './summaries';

function group(currency: 'EUR' | 'USD', balance: number, syncedAt: string): DiscoveredGroup {
  return { group: { currency }, summary: { currency, currentUserBalanceMinor: balance, syncedAt } } as DiscoveredGroup;
}

describe('group aggregates', () => {
  it('keeps currencies and owed/owing totals separate', () => {
    expect(calculateGroupAggregates([
      group('EUR', 1000, '2026-07-17T00:00:00.000Z'),
      group('EUR', -400, '2026-07-16T00:00:00.000Z'),
      group('USD', 500, '2026-07-18T00:00:00.000Z'),
    ])).toEqual([
      { currency: 'EUR', owedMinor: 1000, owingMinor: 400, asOf: '2026-07-16T00:00:00.000Z' },
      { currency: 'USD', owedMinor: 500, owingMinor: 0, asOf: '2026-07-18T00:00:00.000Z' },
    ]);
  });
});
