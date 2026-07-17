import type { CurrencyCode, DiscoveredGroup } from '@/domain/types';

export type GroupAggregate = { currency: CurrencyCode; owedMinor: number; owingMinor: number; asOf: string };

export function calculateGroupAggregates(groups: DiscoveredGroup[]): GroupAggregate[] {
  const map = new Map<CurrencyCode, GroupAggregate>();
  for (const group of groups) {
    if (!group.summary) continue;
    const existing = map.get(group.summary.currency) ?? { currency: group.summary.currency, owedMinor: 0, owingMinor: 0, asOf: group.summary.syncedAt };
    if (group.summary.currentUserBalanceMinor > 0) existing.owedMinor += group.summary.currentUserBalanceMinor;
    if (group.summary.currentUserBalanceMinor < 0) existing.owingMinor += Math.abs(group.summary.currentUserBalanceMinor);
    if (group.summary.syncedAt < existing.asOf) existing.asOf = group.summary.syncedAt;
    map.set(existing.currency, existing);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
