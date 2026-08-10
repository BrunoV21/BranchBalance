import { DomainValidationError } from '@/domain/errors';
import { isTripPlan } from '@/domain/groups';
import { normalizeLogin, type CalendarDate, type Expense, type SpendingInsight, type SpendingPlan, type SpendingSummary } from '@/domain/types';

import { calendarDayOrdinal, inclusiveCalendarDays } from './calendar';
import { categoryBuckets, paymentMethodBuckets, type CategoryBucket, type ExpenseCategory, type PaymentMethodBucket } from './catalog';

export type ExpenseScope = 'all' | 'shared' | 'just_me';

export interface SpendingFilters {
  date: 'all' | CalendarDate;
  category: 'all' | CategoryBucket;
  paymentMethod: 'all' | PaymentMethodBucket;
  payer: 'all' | string;
  scope: ExpenseScope;
}

export const emptySpendingFilters: SpendingFilters = {
  date: 'all',
  category: 'all',
  paymentMethod: 'all',
  payer: 'all',
  scope: 'all',
};

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainValidationError('Spending totals exceed the supported safe-integer range.');
  return result;
}

function percentage(spent: number, limit: number): number {
  return spent === 0 ? 0 : (spent / limit) * 100;
}

function statusFor(remaining: number): 'under' | 'at' | 'over' {
  return remaining > 0 ? 'under' : remaining === 0 ? 'at' : 'over';
}

export function categoryBucketFor(expense: Expense): CategoryBucket {
  return expense.category ?? 'uncategorized';
}

export function paymentMethodBucketFor(expense: Expense): PaymentMethodBucket {
  return expense.payment_method ?? 'unspecified';
}

export function isJustMeExpense(expense: Expense): boolean {
  if (expense.split_type !== 'equal' || expense.participants.length !== 1) return false;
  const payer = normalizeLogin(expense.paid_by);
  if (normalizeLogin(expense.participants[0] ?? '') !== payer) return false;
  const shares = Object.entries(expense.shares_minor);
  return shares.length === 1 && normalizeLogin(shares[0]?.[0] ?? '') === payer && shares[0]?.[1] === expense.amount_minor;
}

export function matchesSpendingFilters(expense: Expense, filters: SpendingFilters): boolean {
  if (filters.date !== 'all' && expense.expense_date !== filters.date) return false;
  if (filters.category !== 'all' && categoryBucketFor(expense) !== filters.category) return false;
  if (filters.paymentMethod !== 'all' && paymentMethodBucketFor(expense) !== filters.paymentMethod) return false;
  if (filters.payer !== 'all' && normalizeLogin(expense.paid_by) !== normalizeLogin(filters.payer)) return false;
  const justMe = isJustMeExpense(expense);
  if (filters.scope === 'just_me' && !justMe) return false;
  if (filters.scope === 'shared' && justMe) return false;
  return true;
}

export function filterExpenses(expenses: readonly Expense[], filters: SpendingFilters): Expense[] {
  return expenses.filter((expense) => matchesSpendingFilters(expense, filters));
}

export function deriveSpendingSummary(
  expenses: readonly Expense[],
  plan: SpendingPlan | undefined,
  currentUser: string,
  today: CalendarDate,
): SpendingSummary {
  const tripPlan = isTripPlan(plan) ? plan : undefined;
  const categorySpentMinor = Object.fromEntries(categoryBuckets.map((bucket) => [bucket, 0])) as Record<CategoryBucket, number>;
  const paymentMethodSpentMinor = Object.fromEntries(paymentMethodBuckets.map((bucket) => [bucket, 0])) as Record<PaymentMethodBucket, number>;
  const normalizedCurrentUser = normalizeLogin(currentUser);
  let totalSpentMinor = 0;
  let currentUserPaidMinor = 0;
  let currentUserShareMinor = 0;
  let justMeMinor = 0;
  let futureDatedMinor = 0;
  let actualToDateMinor = 0;
  const dailyAmounts = new Map<CalendarDate, number>();

  for (const expense of expenses) {
    totalSpentMinor = checkedAdd(totalSpentMinor, expense.amount_minor);
    const category = categoryBucketFor(expense);
    categorySpentMinor[category] = checkedAdd(categorySpentMinor[category], expense.amount_minor);
    const method = paymentMethodBucketFor(expense);
    paymentMethodSpentMinor[method] = checkedAdd(paymentMethodSpentMinor[method], expense.amount_minor);
    if (normalizeLogin(expense.paid_by) === normalizedCurrentUser) currentUserPaidMinor = checkedAdd(currentUserPaidMinor, expense.amount_minor);
    for (const [login, share] of Object.entries(expense.shares_minor)) {
      if (normalizeLogin(login) === normalizedCurrentUser) currentUserShareMinor = checkedAdd(currentUserShareMinor, share);
    }
    dailyAmounts.set(expense.expense_date, checkedAdd(dailyAmounts.get(expense.expense_date) ?? 0, expense.amount_minor));
    if (isJustMeExpense(expense)) justMeMinor = checkedAdd(justMeMinor, expense.amount_minor);
    if (expense.expense_date > today) futureDatedMinor = checkedAdd(futureDatedMinor, expense.amount_minor);
    else actualToDateMinor = checkedAdd(actualToDateMinor, expense.amount_minor);
  }

  let budget: SpendingSummary['budget'] = null;
  if (tripPlan?.budget_minor !== undefined) {
    const remainingMinor = tripPlan.budget_minor - totalSpentMinor;
    const categoryLimits: NonNullable<SpendingSummary['budget']>['categoryLimits'] = {};
    for (const [category, limitMinor] of Object.entries(tripPlan.category_budgets_minor ?? {}) as [ExpenseCategory, number][]) {
      const spentMinor = categorySpentMinor[category];
      const categoryRemainingMinor = limitMinor - spentMinor;
      categoryLimits[category] = {
        limitMinor,
        spentMinor,
        remainingMinor: categoryRemainingMinor,
        status: statusFor(categoryRemainingMinor),
        percentageUsed: percentage(spentMinor, limitMinor),
      };
    }
    budget = {
      budgetMinor: tripPlan.budget_minor,
      remainingMinor,
      status: statusFor(remainingMinor),
      percentageUsed: percentage(totalSpentMinor, tripPlan.budget_minor),
      categoryLimits,
    };
  }

  let trip: SpendingSummary['trip'] = null;
  if (tripPlan?.starts_on && tripPlan.ends_on) {
    const start = calendarDayOrdinal(tripPlan.starts_on);
    const end = calendarDayOrdinal(tripPlan.ends_on);
    const current = calendarDayOrdinal(today);
    const totalDays = inclusiveCalendarDays(tripPlan.starts_on, tripPlan.ends_on);
    const phase = current < start ? 'before' : current > end ? 'after' : 'during';
    const availableDays = phase === 'before' ? totalDays : phase === 'during' ? end - current + 1 : 0;
    trip = {
      phase,
      totalDays,
      currentDay: phase === 'during' ? current - start + 1 : null,
      availableDays,
      dailyAvailableMinor: budget && availableDays > 0 ? Math.floor(Math.max(budget.remainingMinor, 0) / availableDays) : null,
    };
  }

  const buckets = [...dailyAmounts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, amountMinor]) => ({ date, amountMinor }));
  const period = tripPlan?.starts_on && tripPlan.ends_on ? { startsOn: tripPlan.starts_on, endsOn: tripPlan.ends_on, totalDays: inclusiveCalendarDays(tripPlan.starts_on, tripPlan.ends_on) } : null;
  let preTripMinor = 0;
  let afterTripMinor = 0;
  if (period) {
    for (const bucket of buckets) {
      if (bucket.date < period.startsOn) preTripMinor = checkedAdd(preTripMinor, bucket.amountMinor);
      else if (bucket.date > period.endsOn) afterTripMinor = checkedAdd(afterTripMinor, bucket.amountMinor);
    }
  }

  let pace: SpendingSummary['analytics']['pace'] = null;
  if (period && budget && trip?.phase === 'during' && trip.currentDay !== null) {
    const elapsedDays = trip.currentDay;
    const quotient = Math.floor(budget.budgetMinor / period.totalDays);
    const remainder = budget.budgetMinor % period.totalDays;
    const evenPaceMinor = checkedAdd(quotient * elapsedDays, Math.floor((remainder * elapsedDays) / period.totalDays));
    const deltaMinor = actualToDateMinor - evenPaceMinor;
    let cumulativeMinor = preTripMinor;
    const events: NonNullable<SpendingSummary['analytics']['pace']>['events'] = [];
    const startAmount = dailyAmounts.get(period.startsOn) ?? 0;
    cumulativeMinor = checkedAdd(cumulativeMinor, startAmount);
    events.push({ date: period.startsOn, cumulativeMinor });
    for (const bucket of buckets) {
      if (bucket.date <= period.startsOn || bucket.date > today || bucket.date > period.endsOn) continue;
      cumulativeMinor = checkedAdd(cumulativeMinor, bucket.amountMinor);
      events.push({ date: bucket.date, cumulativeMinor });
    }
    if (events.at(-1)?.date !== today) events.push({ date: today, cumulativeMinor });
    pace = {
      actualToDateMinor,
      evenPaceMinor,
      deltaMinor,
      direction: deltaMinor < 0 ? 'below' : deltaMinor > 0 ? 'above' : 'on',
      elapsedDays,
      totalDays: period.totalDays,
      events,
      referenceEvents: [
        { date: period.startsOn, cumulativeMinor: Math.floor(budget.budgetMinor / period.totalDays) },
        { date: period.endsOn, cumulativeMinor: budget.budgetMinor },
      ],
    };
  }

  const categoryOrder = new Map(categoryBuckets.map((category, index) => [category, index]));
  const categoryMix = categoryBuckets.filter((category) => categorySpentMinor[category] > 0).map((category) => ({
    category,
    spentMinor: categorySpentMinor[category],
    sharePercentage: totalSpentMinor ? percentage(categorySpentMinor[category], totalSpentMinor) : 0,
  })).sort((left, right) => right.spentMinor - left.spentMinor || (categoryOrder.get(left.category) ?? 0) - (categoryOrder.get(right.category) ?? 0));
  const sharedMinor = totalSpentMinor - justMeMinor;
  const insights: SpendingInsight[] = [];
  if (totalSpentMinor > 0) {
    if (pace) insights.push({ kind: 'pace', actualToDateMinor: pace.actualToDateMinor, evenPaceMinor: pace.evenPaceMinor, deltaMinor: pace.deltaMinor, direction: pace.direction });
    if (budget?.status === 'over') insights.push({ kind: 'budget_overage', overMinor: Math.abs(budget.remainingMinor) });
    else if (budget) {
      const categoryOverage = (Object.entries(budget.categoryLimits) as [ExpenseCategory, NonNullable<SpendingSummary['budget']>['categoryLimits'][ExpenseCategory]][])
        .filter((entry): entry is [ExpenseCategory, NonNullable<typeof entry[1]>] => entry[1]?.status === 'over')
        .sort((left, right) => Math.abs(right[1].remainingMinor) - Math.abs(left[1].remainingMinor) || (categoryOrder.get(left[0]) ?? 0) - (categoryOrder.get(right[0]) ?? 0))[0];
      if (categoryOverage) insights.push({ kind: 'category_overage', category: categoryOverage[0], overMinor: Math.abs(categoryOverage[1].remainingMinor), spentMinor: categoryOverage[1].spentMinor, limitMinor: categoryOverage[1].limitMinor });
    }
    const largestCategory = categoryMix[0];
    if (largestCategory) insights.push({ kind: 'largest_category', ...largestCategory });
    const fundingGap = currentUserPaidMinor - currentUserShareMinor;
    if (fundingGap !== 0) insights.push({ kind: 'funding_gap', gapMinor: fundingGap });
    if (period) {
      const tripBuckets = buckets.filter((bucket) => bucket.date >= period.startsOn && bucket.date <= period.endsOn);
      if (tripBuckets.length >= 2) {
        const highest = [...tripBuckets].sort((left, right) => right.amountMinor - left.amountMinor || left.date.localeCompare(right.date))[0]!;
        insights.push({ kind: 'highest_day', date: highest.date, amountMinor: highest.amountMinor });
      }
    }
    if (sharedMinor > 0 && justMeMinor > 0) insights.push({ kind: 'scope_split', sharedMinor, justMeMinor });
  }

  return {
    totalSpentMinor,
    currentUserPaidMinor,
    currentUserShareMinor,
    categorySpentMinor,
    paymentMethodSpentMinor,
    budget,
    trip,
    analytics: {
      today,
      daily: { buckets, period, preTripMinor, afterTripMinor, futureDatedMinor, distinctExpenseDateCount: buckets.length },
      pace,
      categoryMix,
      scopeMix: { sharedMinor, justMeMinor },
      insights: insights.slice(0, 3),
    },
  };
}

export function formatPercentage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
