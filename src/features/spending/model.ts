import { DomainValidationError } from '@/domain/errors';
import { currencies, parseAmountToMinor } from '@/domain/money';
import { isTripPlan } from '@/domain/groups';
import { expenseCategories, isCalendarDate, type ExpenseCategory } from '@/domain/spending';
import { normalizeLogin, type CalendarDate, type CurrencyCode, type SpendingPlan, type TripPlanV2 } from '@/domain/types';
import type { Clock } from '@/features/auth/contracts';

export interface SpendingPlanDraft {
  budget: string;
  categoryBudgets: Record<ExpenseCategory, string>;
  startsOn: CalendarDate | '';
  endsOn: CalendarDate | '';
}

export function emptySpendingPlanDraft(): SpendingPlanDraft {
  return {
    budget: '',
    categoryBudgets: Object.fromEntries(expenseCategories.map((category) => [category, ''])) as Record<ExpenseCategory, string>,
    startsOn: '',
    endsOn: '',
  };
}

export function spendingPlanDraftFrom(plan: SpendingPlan | undefined, currency: CurrencyCode): SpendingPlanDraft {
  const draft = emptySpendingPlanDraft();
  if (!isTripPlan(plan)) return draft;
  draft.budget = plan.budget_minor === undefined ? '' : minorUnitsForInput(plan.budget_minor, currency);
  for (const category of expenseCategories) {
    const value = plan.category_budgets_minor?.[category];
    draft.categoryBudgets[category] = value === undefined ? '' : minorUnitsForInput(value, currency);
  }
  draft.startsOn = plan.starts_on ?? '';
  draft.endsOn = plan.ends_on ?? '';
  return draft;
}

export function buildSpendingPlan(draft: SpendingPlanDraft, currency: CurrencyCode, actor: string, clock: Clock): TripPlanV2 {
  const budget = draft.budget.trim() ? parsePlanAmount(draft.budget, currency, 'budget') : undefined;
  const categoryBudgets: Partial<Record<ExpenseCategory, number>> = {};
  for (const category of expenseCategories) {
    const value = draft.categoryBudgets[category].trim();
    if (value) categoryBudgets[category] = parsePlanAmount(value, currency, category);
  }
  if (Object.keys(categoryBudgets).length && budget === undefined) throw new DomainValidationError('Category limits require a total budget.', 'budget');
  if (!draft.startsOn || !draft.endsOn) throw new DomainValidationError('Set both inclusive Trip dates.', 'dates');
  if (draft.startsOn && !isCalendarDate(draft.startsOn)) throw new DomainValidationError('Select a valid budget start date.', 'startsOn');
  if (draft.endsOn && !isCalendarDate(draft.endsOn)) throw new DomainValidationError('Select a valid budget end date.', 'endsOn');
  if (draft.startsOn && draft.endsOn && draft.endsOn < draft.startsOn) throw new DomainValidationError('Budget end date cannot be before its start date.', 'endsOn');
  return {
    kind: 'trip',
    ...(budget === undefined ? {} : { budget_minor: budget }),
    ...(Object.keys(categoryBudgets).length ? { category_budgets_minor: categoryBudgets } : {}),
    starts_on: draft.startsOn,
    ends_on: draft.endsOn,
    updated_by: normalizeLogin(actor),
    updated_at: clock.now().toISOString(),
  };
}

function parsePlanAmount(value: string, currency: CurrencyCode, field: string): number {
  try { return parseAmountToMinor(value, currency); }
  catch (error) { throw new DomainValidationError(error instanceof Error ? error.message : 'Enter a valid positive amount.', field); }
}

export function minorUnitsForInput(amountMinor: number, currency: CurrencyCode): string {
  const digits = currencies[currency].minorDigits;
  const scale = 10 ** digits;
  const whole = Math.floor(amountMinor / scale);
  const fraction = String(amountMinor % scale).padStart(digits, '0');
  return `${whole}.${fraction}`;
}
