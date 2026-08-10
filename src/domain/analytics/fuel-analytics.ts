import { DomainValidationError } from '@/domain/errors';
import { isFuelMonthlyPlan } from '@/domain/groups';
import type {
  CalendarDate,
  DataWarning,
  Expense,
  FuelAnalytics,
  FuelMonthSummary,
  FuelMonthlyPlanV2,
  FuelStationSummary,
  MonthKey,
  SpendingPlan,
} from '@/domain/types';

export function monthKeyForDate(date: CalendarDate): MonthKey {
  return date.slice(0, 7) as MonthKey;
}
export function applicableFuelLimit(plan: SpendingPlan | undefined, month: MonthKey): number | null {
  if (!isFuelMonthlyPlan(plan)) return null;
  let result: number | null = null;
  for (const entry of plan.monthly_limits) {
    if (entry.effective_month > month) break;
    result = entry.limit_minor;
  }
  return result;
}

export function deriveFuelAnalytics(
  expenses: readonly Expense[],
  plan: SpendingPlan | undefined,
  today: CalendarDate,
  selectedMonth: MonthKey = monthKeyForDate(today),
  warnings: DataWarning[] = [],
): FuelAnalytics {
  const fuelPlan = isFuelMonthlyPlan(plan) ? plan : undefined;
  const months = contiguousMonths(expenses, fuelPlan, monthKeyForDate(today));
  if (!months.includes(selectedMonth)) months.push(selectedMonth);
  months.sort();
  const monthlySeries = months.map((month) => summarizeMonth(expenses, fuelPlan, month, today));
  const selected = monthlySeries.find((row) => row.month === selectedMonth) ?? summarizeMonth(expenses, fuelPlan, selectedMonth, today);
  const selectedExpenses = expenses.filter((expense) => monthKeyForDate(expense.expense_date) === selectedMonth);
  return {
    selectedMonth: selected,
    monthlySeries,
    stationRows: deriveStationRows(selectedExpenses),
    coverage: {
      expenseCount: selectedExpenses.length,
      withValidFuelData: selectedExpenses.filter((expense) => expense.type_data).length,
      withVolume: selectedExpenses.filter((expense) => expense.type_data?.volume_millilitres).length,
      withPrintedPrice: selectedExpenses.filter((expense) => expense.type_data?.unit_price_micros_per_litre !== undefined).length,
      withGross: selectedExpenses.filter((expense) => expense.type_data?.gross_amount_minor !== undefined).length,
      withExplicitDiscount: selectedExpenses.filter((expense) => expense.type_data?.discount_minor !== undefined).length,
    },
    warnings,
  };
}

function summarizeMonth(expenses: readonly Expense[], plan: FuelMonthlyPlanV2 | undefined, month: MonthKey, today: CalendarDate): FuelMonthSummary {
  const rows = expenses.filter((expense) => monthKeyForDate(expense.expense_date) === month);
  let paidMinor = 0;
  let representedVolumeMl = 0;
  let expensesWithVolume = 0;
  let explicitDiscountMinor = 0;
  let expensesWithExplicitDiscount = 0;
  let futureDatedMinor = 0;
  for (const expense of rows) {
    paidMinor = checkedAdd(paidMinor, expense.amount_minor);
    if (expense.expense_date > today) futureDatedMinor = checkedAdd(futureDatedMinor, expense.amount_minor);
    const data = expense.type_data;
    if (!data) continue;
    representedVolumeMl = checkedAdd(representedVolumeMl, data.volume_millilitres);
    expensesWithVolume += 1;
    if (data.discount_minor !== undefined) {
      explicitDiscountMinor = checkedAdd(explicitDiscountMinor, data.discount_minor);
      expensesWithExplicitDiscount += 1;
    }
  }
  const applicableLimitMinor = applicableFuelLimit(plan, month);
  const remainingMinor = applicableLimitMinor === null ? null : applicableLimitMinor - paidMinor;
  return {
    month,
    paidMinor,
    applicableLimitMinor,
    remainingMinor,
    status: remainingMinor === null ? 'no_limit' : remainingMinor > 0 ? 'under' : remainingMinor < 0 ? 'over' : 'at',
    expenseCount: rows.length,
    representedVolumeMl,
    expensesWithVolume,
    weightedPaidPrice: representedVolumeMl > 0 ? safeRational(paidMinor, representedVolumeMl) : null,
    explicitDiscountMinor,
    expensesWithExplicitDiscount,
    futureDatedMinor,
  };
}

function deriveStationRows(expenses: readonly Expense[]): FuelStationSummary[] {
  const groups = new Map<string, { originals: Map<string, number>; paidMinor: number; representedVolumeMl: number; expenseCount: number }>();
  for (const expense of expenses) {
    const key = normalizeStation(expense.description);
    const current = groups.get(key) ?? { originals: new Map(), paidMinor: 0, representedVolumeMl: 0, expenseCount: 0 };
    current.originals.set(expense.description.trim(), (current.originals.get(expense.description.trim()) ?? 0) + 1);
    current.paidMinor = checkedAdd(current.paidMinor, expense.amount_minor);
    current.representedVolumeMl = checkedAdd(current.representedVolumeMl, expense.type_data?.volume_millilitres ?? 0);
    current.expenseCount += 1;
    groups.set(key, current);
  }
  return [...groups.entries()].map(([key, value]) => ({
    key,
    label: [...value.originals.entries()].sort((left, right) => right[1] - left[1] || codePointCompare(left[0], right[0]))[0]?.[0] ?? key,
    paidMinor: value.paidMinor,
    representedVolumeMl: value.representedVolumeMl,
    expenseCount: value.expenseCount,
  })).sort((left, right) => right.paidMinor - left.paidMinor || codePointCompare(left.label, right.label));
}

export function normalizeStation(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('und');
}

function contiguousMonths(expenses: readonly Expense[], plan: FuelMonthlyPlanV2 | undefined, current: MonthKey): MonthKey[] {
  const candidates = [current, ...expenses.map((expense) => monthKeyForDate(expense.expense_date)), ...(plan?.monthly_limits.map((entry) => entry.effective_month) ?? [])].sort();
  const first = candidates[0] ?? current;
  const last = candidates.at(-1) ?? current;
  const output: MonthKey[] = [];
  for (let cursor = first; cursor <= last; cursor = nextMonth(cursor)) output.push(cursor);
  return output;
}

export function nextMonth(month: MonthKey): MonthKey {
  const [year, rawMonth] = month.split('-').map(Number) as [number, number];
  const nextYear = rawMonth === 12 ? year + 1 : year;
  const next = rawMonth === 12 ? 1 : rawMonth + 1;
  return `${String(nextYear).padStart(4, '0')}-${String(next).padStart(2, '0')}` as MonthKey;
}

export function previousMonth(month: MonthKey): MonthKey {
  const [year, rawMonth] = month.split('-').map(Number) as [number, number];
  const previousYear = rawMonth === 1 ? year - 1 : year;
  const previous = rawMonth === 1 ? 12 : rawMonth - 1;
  return `${String(previousYear).padStart(4, '0')}-${String(previous).padStart(2, '0')}` as MonthKey;
}

function checkedAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new DomainValidationError('Fuel totals exceed the supported safe-integer range.');
  return result;
}

function safeRational(numerator: number, denominator: number) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new DomainValidationError('Fuel price ratio is outside the supported range.');
  return { numerator, denominator };
}

function codePointCompare(left: string, right: string): number {
  const leftPoints = [...left].map((value) => value.codePointAt(0)!);
  const rightPoints = [...right].map((value) => value.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
  }
  return leftPoints.length - rightPoints.length;
}
