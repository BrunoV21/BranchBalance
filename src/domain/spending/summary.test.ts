import type { Expense, MemberBalance, SpendingPlan } from '@/domain/types';

import { inclusiveCalendarDays, isCalendarDate } from './calendar';
import { deriveExpenseFundingAnalytics } from './funding';
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
    expect(summary.analytics.scopeMix).toEqual({ sharedMinor: 1200, justMeMinor: 300 });
    expect(summary.analytics.scopeMix.sharedMinor + summary.analytics.scopeMix.justMeMinor).toBe(summary.totalSpentMinor);
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
    expect(filterExpenses([shared, justMe, { ...legacy, expense_date: '2026-07-15' }], { ...emptySpendingFilters, date: '2026-07-15' })).toEqual([{ ...legacy, expense_date: '2026-07-15' }]);
  });

  it('derives sparse daily values, boundary totals, and overflow-safe even pace', () => {
    const before = { ...shared, id: 'a1111111-1111-4111-8111-111111111111', amount_minor: 100, shares_minor: { alice: 50, bob: 50 }, expense_date: '2026-07-13' };
    const firstDay = { ...shared, id: 'b1111111-1111-4111-8111-111111111111', amount_minor: 1_000, shares_minor: { alice: 500, bob: 500 }, expense_date: '2026-07-14' };
    const middleDay = { ...justMe, id: 'c1111111-1111-4111-8111-111111111111', expense_date: '2026-07-16' };
    const futureDay = { ...shared, id: 'd1111111-1111-4111-8111-111111111111', amount_minor: 500, shares_minor: { alice: 250, bob: 250 }, expense_date: '2026-07-18' };
    const after = { ...shared, id: 'e1111111-1111-4111-8111-111111111111', amount_minor: 700, shares_minor: { alice: 350, bob: 350 }, expense_date: '2026-07-21' };
    const analyticsPlan: SpendingPlan = { ...plan, budget_minor: 7_001, category_budgets_minor: { food_drink: 1_000 } };

    const summary = deriveSpendingSummary([futureDay, middleDay, before, after, firstDay], analyticsPlan, 'alice', '2026-07-17');

    expect(summary.analytics.daily).toMatchObject({
      period: { startsOn: '2026-07-14', endsOn: '2026-07-20', totalDays: 7 },
      preTripMinor: 100,
      afterTripMinor: 700,
      futureDatedMinor: 1_200,
      distinctExpenseDateCount: 5,
    });
    expect(summary.analytics.daily.buckets).toEqual([
      { date: '2026-07-13', amountMinor: 100 },
      { date: '2026-07-14', amountMinor: 1_000 },
      { date: '2026-07-16', amountMinor: 300 },
      { date: '2026-07-18', amountMinor: 500 },
      { date: '2026-07-21', amountMinor: 700 },
    ]);
    expect(summary.analytics.pace).toMatchObject({
      actualToDateMinor: 1_400,
      evenPaceMinor: 4_000,
      deltaMinor: -2_600,
      direction: 'below',
      elapsedDays: 4,
      totalDays: 7,
      events: [
        { date: '2026-07-14', cumulativeMinor: 1_100 },
        { date: '2026-07-16', cumulativeMinor: 1_400 },
        { date: '2026-07-17', cumulativeMinor: 1_400 },
      ],
      referenceEvents: [
        { date: '2026-07-14', cumulativeMinor: 1_000 },
        { date: '2026-07-20', cumulativeMinor: 7_001 },
      ],
    });
    expect(summary.analytics.insights.map((insight) => insight.kind)).toEqual(['pace', 'category_overage', 'largest_category']);
    expect(summary.analytics.insights).toHaveLength(3);
  });

  it('omits pace outside the active period and does not allocate dense domain buckets', () => {
    expect(deriveSpendingSummary([], plan, 'alice', '2026-07-01').analytics.pace).toBeNull();
    expect(deriveSpendingSummary([], plan, 'alice', '2026-07-21').analytics.pace).toBeNull();

    const longPlan: SpendingPlan = { ...plan, budget_minor: Number.MAX_SAFE_INTEGER, starts_on: '1000-01-01', ends_on: '9999-12-31' };
    const summary = deriveSpendingSummary([], longPlan, 'alice', '5000-01-01');
    expect(summary.analytics.daily.period?.totalDays).toBeGreaterThan(3_000_000);
    expect(summary.analytics.daily.buckets).toHaveLength(0);
    expect(summary.analytics.pace?.events).toHaveLength(2);
    expect(Number.isSafeInteger(summary.analytics.pace?.evenPaceMinor)).toBe(true);
  });

  it('handles a one-day period and deterministic category and insight ties', () => {
    const food = { ...shared, amount_minor: 100, shares_minor: { alice: 50, bob: 50 }, expense_date: '2026-07-17' };
    const groceries = { ...shared, id: 'f1111111-1111-4111-8111-111111111111', category: 'groceries' as const, amount_minor: 100, shares_minor: { alice: 50, bob: 50 }, expense_date: '2026-07-17' };
    const uncategorized = { ...legacy, id: 'f2222222-2222-4222-8222-222222222222', amount_minor: 100, shares_minor: { alice: 50, bob: 50 }, expense_date: '2026-07-17' };
    const oneDayPlan: SpendingPlan = {
      ...plan,
      budget_minor: 301,
      category_budgets_minor: { food_drink: 50, groceries: 50 },
      starts_on: '2026-07-17',
      ends_on: '2026-07-17',
    };

    const summary = deriveSpendingSummary([uncategorized, groceries, food], oneDayPlan, 'alice', '2026-07-17');

    expect(summary.analytics.pace).toMatchObject({ evenPaceMinor: 301, actualToDateMinor: 300, deltaMinor: -1, elapsedDays: 1, totalDays: 1 });
    expect(summary.analytics.pace?.events).toEqual([{ date: '2026-07-17', cumulativeMinor: 300 }]);
    expect(summary.analytics.categoryMix.map((row) => row.category)).toEqual(['food_drink', 'groceries', 'uncategorized']);
    for (const row of summary.analytics.categoryMix) expect(row.sharePercentage).toBeCloseTo(100 / 3);
    expect(summary.analytics.insights.map((insight) => insight.kind)).toEqual(['pace', 'category_overage', 'largest_category']);
    expect(summary.analytics.insights[1]).toMatchObject({ kind: 'category_overage', category: 'food_drink', overMinor: 50 });
    expect(summary.analytics.insights[2]).toMatchObject({ kind: 'largest_category', category: 'food_drink' });
  });

  it('keeps empty, no-budget, and date-only analytics honest', () => {
    const empty = deriveSpendingSummary([], undefined, 'alice', '2026-07-17');
    expect(empty.analytics).toMatchObject({ pace: null, categoryMix: [], scopeMix: { sharedMinor: 0, justMeMinor: 0 }, insights: [] });

    const noBudget = deriveSpendingSummary([shared], undefined, 'alice', '2026-07-17');
    expect(noBudget.analytics.pace).toBeNull();
    expect(noBudget.analytics.daily.buckets).toEqual([{ date: shared.expense_date, amountMinor: shared.amount_minor }]);

    const dateOnly = deriveSpendingSummary([shared], { ...plan, budget_minor: undefined, category_budgets_minor: undefined }, 'alice', '2026-07-17');
    expect(dateOnly.analytics.pace).toBeNull();
    expect(dateOnly.analytics.daily.period).toMatchObject({ totalDays: 7 });
  });

  it('rejects unsafe aggregate totals and formats one shared percentage policy', () => {
    const huge = { ...shared, amount_minor: Number.MAX_SAFE_INTEGER, shares_minor: { alice: Number.MAX_SAFE_INTEGER } };
    expect(() => deriveSpendingSummary([huge, { ...huge, id: '44444444-4444-4444-8444-444444444444' }], undefined, 'alice', '2026-07-17')).toThrow(/safe-integer/i);
    expect(formatPercentage(41.26)).toBe('41.3%');
    expect(formatPercentage(100)).toBe('100%');
  });
});

describe('expense funding analytics', () => {
  it('uses expense paid/share values, a common scale, and current-user-first ordering', () => {
    const members: MemberBalance[] = [
      { login: 'friend', totalPaidMinor: 100, totalShareMinor: 700, settlementSentMinor: 300, settlementReceivedMinor: 0, netMinor: -300, currentMember: true },
      { login: 'Owner', totalPaidMinor: 1_000, totalShareMinor: 400, settlementSentMinor: 0, settlementReceivedMinor: 300, netMinor: 300, currentMember: true },
    ];

    expect(deriveExpenseFundingAnalytics(members, 'owner')).toEqual({
      scaleMaxMinor: 1_000,
      rows: [
        { login: 'Owner', paidMinor: 1_000, shareMinor: 400, gapMinor: 600, currentMember: true },
        { login: 'friend', paidMinor: 100, shareMinor: 700, gapMinor: -600, currentMember: true },
      ],
    });
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
