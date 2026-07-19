import { calculateBalances, simplifySettlements } from './balances';
import type { Expense, Member } from './types';

const members: Member[] = [
  { login: 'alice', avatarUrl: null, name: null, role: 'owner' },
  { login: 'bob', avatarUrl: null, name: null, role: 'member' },
  { login: 'cara', avatarUrl: null, name: null, role: 'member' },
];

const expense: Expense = {
  schema_version: 1,
  id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234',
  description: 'Dinner', amount_minor: 1000, currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'alice',
  split_type: 'equal', participants: ['alice', 'bob', 'cara'],
  shares_minor: { alice: 334, bob: 333, cara: 333 }, expense_date: '2026-07-16',
  created_by: 'alice', created_at: '2026-07-16T12:00:00.000Z', updated_by: null, updated_at: null,
};

describe('balances and settlements', () => {
  it('calculates a zero-sum result', () => {
    const result = calculateBalances([expense], members);
    expect(result.totalSpentMinor).toBe(1000);
    expect(result.zeroSum).toBe(true);
    expect(result.members.map((member) => [member.login, member.netMinor])).toEqual([
      ['alice', 666], ['bob', -333], ['cara', -333],
    ]);
  });

  it('keeps historical identities and simplifies deterministically', () => {
    const result = calculateBalances([{ ...expense, paid_by: 'former' }], members);
    expect(result.members.some((member) => member.login === 'former')).toBe(true);
    expect(simplifySettlements(result.members)).toEqual([
      { from: 'alice', to: 'former', amountMinor: 334 },
      { from: 'bob', to: 'former', amountMinor: 333 },
      { from: 'cara', to: 'former', amountMinor: 333 },
    ]);
  });

  it('keeps balances and settlements identical when only spending metadata changes', () => {
    const originalBalances = calculateBalances([expense], members);
    const metadataOnlyEdit = { ...expense, category: 'transport' as const, payment_method: 'cash' as const };
    const editedBalances = calculateBalances([metadataOnlyEdit], members);

    expect(editedBalances).toEqual(originalBalances);
    expect(simplifySettlements(editedBalances.members)).toEqual(simplifySettlements(originalBalances.members));
  });
});
