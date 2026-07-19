import type { Member } from '@/domain/types';

import { buildNewExpense, buildUpdatedExpense } from './model';

const members: Member[] = [
  { login: 'alice', name: null, avatarUrl: null, role: 'owner' },
  { login: 'bob', name: null, avatarUrl: null, role: 'member' },
];
const clock = { now: () => new Date('2026-07-16T12:00:00.000Z') };

describe('expense form model', () => {
  it('builds deterministic equal shares and audit fields', () => {
    const expense = buildNewExpense({ description: ' Dinner ', amount: '10.01', category: 'food_drink', paymentMethod: 'card', paidBy: 'alice', splitType: 'equal', participants: ['bob', 'alice'], expenseDate: '2026-07-15' }, '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', 'EUR', members, 'alice', clock);
    expect(expense.description).toBe('Dinner');
    expect(expense.shares_minor).toEqual({ alice: 501, bob: 500 });
    expect(expense.created_at).toBe('2026-07-16T12:00:00.000Z');
  });

  it('preserves creation audit fields on update', () => {
    const original = buildNewExpense({ description: 'Dinner', amount: '10', category: 'food_drink', paymentMethod: 'card', paidBy: 'alice', splitType: 'full', participants: ['bob'], expenseDate: '2026-07-15' }, '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', 'EUR', members, 'alice', clock);
    const updated = buildUpdatedExpense(original, { description: 'Lunch', amount: '12', category: 'groceries', paymentMethod: 'cash', paidBy: 'alice', splitType: 'full', participants: ['bob'], expenseDate: '2026-07-16' }, members, 'bob', { now: () => new Date('2026-07-17T12:00:00.000Z') });
    expect(updated.id).toBe(original.id);
    expect(updated.created_at).toBe(original.created_at);
    expect(updated.updated_by).toBe('bob');
    expect(updated).toMatchObject({ category: 'groceries', payment_method: 'cash' });
  });

  it('persists Just me as a payer-only equal split', () => {
    const expense = buildNewExpense({ description: 'Coffee', amount: '4.25', category: 'food_drink', paymentMethod: 'cash', paidBy: 'alice', splitType: 'just_me', participants: ['bob'], expenseDate: '2026-07-15' }, '7a3d2c4b-1e5f-4a8b-9c6d-2f0e1a3b4c5d', 'EUR', members, 'alice', clock);
    expect(expense).toMatchObject({ split_type: 'equal', participants: ['alice'], shares_minor: { alice: 425 } });
  });
});
