import { DomainValidationError } from '@/domain/errors';
import { normalizeLogin, type CalendarDate, type Expense, type SpendingPlan, type SpendingSummary } from '@/domain/types';

import { calendarDayOrdinal, inclusiveCalendarDays } from './calendar';
import { categoryBuckets, paymentMethodBuckets, type CategoryBucket, type ExpenseCategory, type PaymentMethodBucket } from './catalog';

export type ExpenseScope = 'all' | 'shared' | 'just_me';

export interface SpendingFilters {
  category: 'all' | CategoryBucket;
  paymentMethod: 'all' | PaymentMethodBucket;
  payer: 'all' | string;
  scope: ExpenseScope;
}

export const emptySpendingFilters: SpendingFilters = {
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
  const categorySpentMinor = Object.fromEntries(categoryBuckets.map((bucket) => [bucket, 0])) as Record<CategoryBucket, number>;
  const paymentMethodSpentMinor = Object.fromEntries(paymentMethodBuckets.map((bucket) => [bucket, 0])) as Record<PaymentMethodBucket, number>;
  const normalizedCurrentUser = normalizeLogin(currentUser);
  let totalSpentMinor = 0;
  let currentUserPaidMinor = 0;
  let currentUserShareMinor = 0;

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
  }

  let budget: SpendingSummary['budget'] = null;
  if (plan?.budget_minor !== undefined) {
    const remainingMinor = plan.budget_minor - totalSpentMinor;
    const categoryLimits: NonNullable<SpendingSummary['budget']>['categoryLimits'] = {};
    for (const [category, limitMinor] of Object.entries(plan.category_budgets_minor ?? {}) as [ExpenseCategory, number][]) {
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
      budgetMinor: plan.budget_minor,
      remainingMinor,
      status: statusFor(remainingMinor),
      percentageUsed: percentage(totalSpentMinor, plan.budget_minor),
      categoryLimits,
    };
  }

  let trip: SpendingSummary['trip'] = null;
  if (plan?.starts_on && plan.ends_on) {
    const start = calendarDayOrdinal(plan.starts_on);
    const end = calendarDayOrdinal(plan.ends_on);
    const current = calendarDayOrdinal(today);
    const totalDays = inclusiveCalendarDays(plan.starts_on, plan.ends_on);
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

  return {
    totalSpentMinor,
    currentUserPaidMinor,
    currentUserShareMinor,
    categorySpentMinor,
    paymentMethodSpentMinor,
    budget,
    trip,
  };
}

export function formatPercentage(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}
