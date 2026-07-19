import type { Expense, SpendingPlan } from '@/domain/types';

import { inclusiveCalendarDays, isCalendarDate } from './calendar';
import { deriveSpendingSummary, emptySpendingFilters, filterExpenses, formatPercentage, isJustMeExpense } from './summary';

const shared: Expense = {
  schema_version: 1, id: '11111111-1111-4111-8111-111111111111', description: 'Dinner', amount_minor: 1000,
  currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'alice', split_type: 'equal',
  participants: ['alice', 'bob'], shares_minor: { alice: 500, bob: 500 }, expense_date: '2026-07-16',
  created_by: 'alice', created_at: '2026-07-16T12:00:00.000Z', updated_by: null, updated_at: null,
};
const justMe: Expense = {
  ...shared, id: '22222222-2222-4222-8222-222222222222', description: 'Coffee', amount_minor: 300,
  category: 'transport', payment_method: 'cash', participants: ['alice'], shares_minor: { alice: 300 },
};
const legacy: Expense = {
  ...shared, id: '33333333-3333-4333-8333-333333333333', description: 'Toll', amount_minor: 200,
  category: null, payment_method: null, paid_by: 'bob', shares_minor: { alice: 100, bob: 100 },
};
const plan: SpendingPlan = {
  budget_minor: 2000, category_budgets_minor: { food_drink: 800, transport: 500 }, starts_on: '2026-07-14', ends_on: '2026-07-20',
  updated_by: 'alice', updated_at: '2026-07-13T12:00:00.000Z',
};

describe('spending summary', () => {
  it('reconciles totals, legacy buckets, personal context, budgets, and inclusive trip guidance', () => {
    const summary = deriveSpendingSummary([shared, justMe, legacy], plan, 'Alice', '2026-07-17');
    expect(summary).toMatchObject({ totalSpentMinor: 1500, currentUserPaidMinor: 1300, currentUserShareMinor: 900 });
    expect(summary.categorySpentMinor).toMatchObject({ food_drink: 1000, transport: 300, uncategorized: 200 });
    expect(summary.paymentMethodSpentMinor).toMatchObject({ card: 1000, cash: 300, unspecified: 200 });
    expect(Object.values(summary.categorySpentMinor).reduce((sum, value) => sum + value, 0)).toBe(1500);
    expect(Object.values(summary.paymentMethodSpentMinor).reduce((sum, value) => sum + value, 0)).toBe(1500);
    expect(summary.budget).toMatchObject({ remainingMinor: 500, status: 'under', percentageUsed: 75 });
    expect(summary.budget?.categoryLimits.food_drink).toMatchObject({ spentMinor: 1000, remainingMinor: -200, status: 'over', percentageUsed: 125 });
    expect(summary.trip).toEqual({ phase: 'during', totalDays: 7, currentDay: 4, availableDays: 4, dailyAvailableMinor: 125 });
  });

  it('handles before/after ranges, date-only plans, and non-negative allowance', () => {
    expect(deriveSpendingSummary([], plan, 'alice', '2026-07-01').trip).toMatchObject({ phase: 'before', currentDay: null, availableDays: 7, dailyAvailableMinor: 285 });
    expect(deriveSpendingSummary([], plan, 'alice', '2026-07-21').trip).toMatchObject({ phase: 'after', availableDays: 0, dailyAvailableMinor: null });
    expect(deriveSpendingSummary([shared], { ...plan, budget_minor: 500 }, 'alice', '2026-07-17').trip?.dailyAvailableMinor).toBe(0);
    expect(deriveSpendingSummary([], { starts_on: plan.starts_on, ends_on: plan.ends_on, updated_by: 'alice', updated_at: plan.updated_at }, 'alice', '2026-07-17').trip?.dailyAvailableMinor).toBeNull();
  });

  it('classifies Just me and combines filters with logical AND', () => {
    expect(isJustMeExpense(justMe)).toBe(true);
    expect(isJustMeExpense(shared)).toBe(false);
    expect(filterExpenses([shared, justMe, legacy], { ...emptySpendingFilters, category: 'transport', paymentMethod: 'cash', payer: 'ALICE', scope: 'just_me' })).toEqual([justMe]);
    expect(filterExpenses([shared, justMe, legacy], { ...emptySpendingFilters, category: 'transport', scope: 'shared' })).toEqual([]);
  });

  it('rejects unsafe aggregate totals and formats one shared percentage policy', () => {
    const huge = { ...shared, amount_minor: Number.MAX_SAFE_INTEGER, shares_minor: { alice: Number.MAX_SAFE_INTEGER } };
    expect(() => deriveSpendingSummary([huge, { ...huge, id: '44444444-4444-4444-8444-444444444444' }], undefined, 'alice', '2026-07-17')).toThrow(/safe-integer/i);
    expect(formatPercentage(41.26)).toBe('41.3%');
    expect(formatPercentage(100)).toBe('100%');
  });
});

describe('calendar arithmetic', () => {
  it('validates real dates and counts inclusive days across leap and DST boundaries', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(inclusiveCalendarDays('2028-02-28', '2028-03-01')).toBe(3);
    expect(inclusiveCalendarDays('2026-03-28', '2026-03-30')).toBe(3);
  });
});
