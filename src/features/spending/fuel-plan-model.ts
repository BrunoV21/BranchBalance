import { DomainValidationError } from '@/domain/errors';
import { parseAmountToMinor } from '@/domain/money';
import { isFuelMonthlyPlan } from '@/domain/groups';
import { normalizeLogin, type CurrencyCode, type FuelMonthlyPlanV2, type MonthKey, type SpendingPlan } from '@/domain/types';
import type { Clock } from '@/features/auth/contracts';

import { minorUnitsForInput } from './model';

export interface FuelLimitDraft {
  effectiveMonth: string;
  amount: string;
}
export function fuelLimitDraftsFrom(plan: SpendingPlan | undefined, currency: CurrencyCode): FuelLimitDraft[] {
  if (!isFuelMonthlyPlan(plan)) return [];
  return plan.monthly_limits.map((entry) => ({ effectiveMonth: entry.effective_month, amount: minorUnitsForInput(entry.limit_minor, currency) }));
}

export function buildFuelMonthlyPlan(drafts: readonly FuelLimitDraft[], currency: CurrencyCode, actor: string, clock: Clock): FuelMonthlyPlanV2 {
  if (!drafts.length) throw new DomainValidationError('Add at least one monthly limit.', 'monthlyLimits');
  const monthly_limits = drafts.map((draft, index) => {
    const effectiveMonth = draft.effectiveMonth.trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(effectiveMonth)) throw new DomainValidationError(`Limit ${index + 1} needs a valid YYYY-MM month.`, `month-${index}`);
    let limitMinor: number;
    try { limitMinor = parseAmountToMinor(draft.amount, currency); }
    catch (error) { throw new DomainValidationError(error instanceof Error ? error.message : 'Enter a positive monthly limit.', `amount-${index}`); }
    return { effective_month: effectiveMonth as MonthKey, limit_minor: limitMinor };
  }).sort((left, right) => left.effective_month.localeCompare(right.effective_month));
  if (new Set(monthly_limits.map((entry) => entry.effective_month)).size !== monthly_limits.length) throw new DomainValidationError('Each effective month can appear only once.', 'monthlyLimits');
  return { kind: 'fuel_monthly', monthly_limits, updated_by: normalizeLogin(actor), updated_at: clock.now().toISOString() };
}
