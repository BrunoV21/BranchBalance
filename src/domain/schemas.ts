import { z } from 'zod';

import { currencies } from './money';
import { DomainValidationError } from './errors';
import { isCalendarDate } from './spending/calendar';
import { expenseCategories, paymentMethods } from './spending/catalog';
import type {
  CurrencyCode,
  Expense,
  ExpenseLineItem,
  FuelExpenseDataV1,
  FuelMonthlyPlanV2,
  Group,
  KnownGroupType,
  LegacyTripPlan,
  SpendingPlan,
  StoredCredentialV1,
  TripPlanV2,
} from './types';

const isoInstant = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'), 'Timestamp must be UTC.');
const calendarDate = z.string().refine(isCalendarDate, 'Date must be a real YYYY-MM-DD calendar date.');
const receiptDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/, 'Receipt date/time must be YYYY-MM-DDTHH:mm.')
  .refine((value) => isCalendarDate(value.slice(0, 10)), 'Receipt date/time must contain a real calendar date.');
const login = z.string().trim().min(1);
const currency = z.enum(['EUR', 'USD', 'GBP']);
const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const monthKey = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month must be a real YYYY-MM value.');

const groupBaseSchema = z.object({
  name: z.string().trim().min(1),
  currency,
  created_by: login,
  created_at: isoInstant,
});

const groupV1Schema = groupBaseSchema.extend({ schema_version: z.literal(1) });
const groupV2EnvelopeSchema = groupBaseSchema.extend({ schema_version: z.literal(2), group_type: z.string().trim().min(1).max(80) });

const categoryBudgetSchema = z.object(Object.fromEntries(expenseCategories.map((category) => [category, positiveSafeInteger.optional()])) as Record<(typeof expenseCategories)[number], z.ZodOptional<typeof positiveSafeInteger>>).strict();

export const legacyTripPlanSchema = z.object({
  budget_minor: positiveSafeInteger.optional(),
  category_budgets_minor: categoryBudgetSchema.optional(),
  starts_on: calendarDate.optional(),
  ends_on: calendarDate.optional(),
  updated_by: login,
  updated_at: isoInstant,
}).strict().superRefine((plan, context) => {
  const hasDates = plan.starts_on !== undefined || plan.ends_on !== undefined;
  if (plan.budget_minor === undefined && !hasDates) context.addIssue({ code: 'custom', message: 'Spending plan must contain a budget or date range.' });
  validateTripPlanFields(plan, context);
});

export const tripPlanV2Schema = z.object({
  kind: z.literal('trip'),
  budget_minor: positiveSafeInteger.optional(),
  category_budgets_minor: categoryBudgetSchema.optional(),
  starts_on: calendarDate,
  ends_on: calendarDate,
  updated_by: login,
  updated_at: isoInstant,
}).strict().superRefine(validateTripPlanFields);

export const fuelMonthlyPlanV2Schema = z.object({
  kind: z.literal('fuel_monthly'),
  monthly_limits: z.array(z.object({ effective_month: monthKey, limit_minor: positiveSafeInteger }).strict()).min(1).max(240),
  updated_by: login,
  updated_at: isoInstant,
}).strict().superRefine((plan, context) => {
  for (let index = 1; index < plan.monthly_limits.length; index += 1) {
    const previous = plan.monthly_limits[index - 1]!.effective_month;
    const current = plan.monthly_limits[index]!.effective_month;
    if (current <= previous) {
      context.addIssue({ code: 'custom', path: ['monthly_limits', index, 'effective_month'], message: current === previous ? 'Fuel monthly limits cannot contain duplicate months.' : 'Fuel monthly limits must be sorted by effective month.' });
    }
  }
});

const lineItemSchema = z.object({
  description: z.string().trim().min(1).max(120),
  quantity: z.string().regex(/^(?:[1-9]\d*)(?:\.\d*[1-9])?$/, 'Quantity must be a normalized positive decimal.').optional(),
  unit_price_minor: nonnegativeSafeInteger.optional(),
  line_total_minor: nonnegativeSafeInteger,
}).passthrough();

const fuelTypeDataSchema = z.object({
  schema_version: z.literal(1),
  type: z.literal('fuel'),
  volume_millilitres: positiveSafeInteger,
  receipt_datetime: receiptDateTime.optional(),
  unit_price_micros_per_litre: positiveSafeInteger.optional(),
  gross_amount_minor: positiveSafeInteger.optional(),
  discount_minor: nonnegativeSafeInteger.optional(),
  fuel_type: z.enum(['petrol', 'diesel', 'lpg', 'other']).optional(),
}).passthrough();

const expenseSchema = z.object({
  schema_version: z.literal(1),
  id: z.uuid().transform((value) => value.toLowerCase()),
  description: z.string().trim().min(1).max(120),
  amount_minor: positiveSafeInteger,
  currency,
  category: z.enum(expenseCategories).optional(),
  payment_method: z.enum(paymentMethods).optional(),
  paid_by: login,
  split_type: z.enum(['equal', 'full']),
  participants: z.array(login).min(1),
  shares_minor: z.record(z.string(), z.number().int().nonnegative()),
  expense_date: calendarDate.optional(),
  created_by: login,
  created_at: isoInstant,
  updated_by: login.nullable(),
  updated_at: isoInstant.nullable(),
});

export const credentialSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().min(1),
  accessTokenExpiresAt: isoInstant,
  refreshToken: z.string().min(1),
  refreshTokenExpiresAt: isoInstant,
});

export function parseGroup(input: unknown): Group {
  return parseGroupDocument(input).group;
}

export interface ParsedGroupDocument {
  group: Group;
  sourceDocument: Record<string, unknown>;
  sourceVersion: 1 | 2;
  effectiveType: KnownGroupType | null;
  unsupportedType: string | null;
  spendingPlanWarning: string | null;
}

export function parseGroupDocument(input: unknown): ParsedGroupDocument {
  if (!isRecord(input)) throw new DomainValidationError('Invalid group file.');
  if (input.schema_version === 1) return parseV1Group(input);
  if (input.schema_version === 2) return parseV2Group(input);
  throw new DomainValidationError('Unsupported group schema version.');
}

function parseV1Group(input: Record<string, unknown>): ParsedGroupDocument {
  const result = groupV1Schema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid group file.');
  if (!Object.prototype.hasOwnProperty.call(input, 'spending_plan')) {
    return { group: result.data, sourceDocument: input, sourceVersion: 1, effectiveType: 'trip', unsupportedType: null, spendingPlanWarning: null };
  }
  const plan = legacyTripPlanSchema.safeParse(input.spending_plan);
  if (!plan.success) {
    return {
      group: result.data,
      sourceDocument: input,
      sourceVersion: 1,
      effectiveType: 'trip',
      unsupportedType: null,
      spendingPlanWarning: plan.error.issues[0]?.message ?? 'Invalid spending plan.',
    };
  }
  return { group: { ...result.data, spending_plan: plan.data as LegacyTripPlan }, sourceDocument: input, sourceVersion: 1, effectiveType: 'trip', unsupportedType: null, spendingPlanWarning: null };
}

function parseV2Group(input: Record<string, unknown>): ParsedGroupDocument {
  const result = groupV2EnvelopeSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid group file.');
  const base = result.data;
  if (base.group_type !== 'trip' && base.group_type !== 'fuel') {
    return { group: base, sourceDocument: input, sourceVersion: 2, effectiveType: null, unsupportedType: base.group_type, spendingPlanWarning: null };
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'spending_plan')) {
    return { group: { ...base, group_type: base.group_type }, sourceDocument: input, sourceVersion: 2, effectiveType: base.group_type, unsupportedType: null, spendingPlanWarning: null };
  }
  const planResult = base.group_type === 'trip' ? tripPlanV2Schema.safeParse(input.spending_plan) : fuelMonthlyPlanV2Schema.safeParse(input.spending_plan);
  if (!planResult.success) {
    const expected = base.group_type === 'trip' ? 'Trip' : 'Fuel monthly';
    throw new DomainValidationError(`${expected} spending plan is invalid: ${planResult.error.issues[0]?.message ?? 'plan type mismatch'}`);
  }
  return {
    group: { ...base, group_type: base.group_type, spending_plan: planResult.data as TripPlanV2 | FuelMonthlyPlanV2 },
    sourceDocument: input,
    sourceVersion: 2,
    effectiveType: base.group_type,
    unsupportedType: null,
    spendingPlanWarning: null,
  };
}

export function parseCredential(input: unknown): StoredCredentialV1 {
  const result = credentialSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError('Invalid stored credential.');
  return result.data;
}

export function parseExpenseFile(input: unknown, path: string, groupCurrency: string, effectiveType: KnownGroupType = 'trip'): Expense {
  return parseExpenseDocument(input, path, groupCurrency, effectiveType).expense;
}

export interface ParsedExpenseDocument {
  expense: Expense;
  sourceDocument: Record<string, unknown>;
  enrichmentWarnings: string[];
}

export function parseExpenseDocument(input: unknown, path: string, groupCurrency: string, effectiveType: KnownGroupType = 'trip'): ParsedExpenseDocument {
  if (!isRecord(input)) throw new DomainValidationError('Invalid expense file.');
  const result = expenseSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid expense file.');
  const raw = result.data;
  const expectedPath = `expenses/${raw.id}.json`;
  if (path.toLowerCase() !== expectedPath) throw new DomainValidationError('Expense filename does not match its id.');
  if (raw.currency !== groupCurrency) throw new DomainValidationError('Expense currency does not match its group.');
  validateExpenseShares(raw);
  const enrichmentWarnings: string[] = [];
  const expense: Expense = {
    ...raw,
    category: raw.category ?? null,
    payment_method: raw.payment_method ?? null,
    expense_date: raw.expense_date ?? raw.created_at.slice(0, 10),
  };

  if (effectiveType === 'trip' && Object.prototype.hasOwnProperty.call(input, 'line_items')) {
    const items = z.array(lineItemSchema).min(1).max(80).safeParse(input.line_items);
    if (items.success) expense.line_items = items.data.map(({ description, quantity, unit_price_minor, line_total_minor }) => ({ description, quantity, unit_price_minor, line_total_minor })) as ExpenseLineItem[];
    else enrichmentWarnings.push(`Invalid line items: ${items.error.issues[0]?.message ?? 'invalid item list'}`);
  } else if (effectiveType === 'fuel' && Object.prototype.hasOwnProperty.call(input, 'line_items')) {
    enrichmentWarnings.push('Generic line items are not used by Fuel groups.');
  }

  if (effectiveType === 'fuel' && Object.prototype.hasOwnProperty.call(input, 'type_data')) {
    const typeData = fuelTypeDataSchema.safeParse(input.type_data);
    if (!typeData.success) enrichmentWarnings.push(`Invalid Fuel details: ${typeData.error.issues[0]?.message ?? 'invalid type data'}`);
    else {
      const normalized = pickFuelTypeData(typeData.data);
      const validationError = validateFuelTypeData(normalized, raw.amount_minor, raw.currency);
      if (validationError) enrichmentWarnings.push(`Invalid Fuel details: ${validationError}`);
      else expense.type_data = normalized;
    }
  } else if (effectiveType === 'trip' && Object.prototype.hasOwnProperty.call(input, 'type_data')) {
    enrichmentWarnings.push('Fuel details are not used by Trip groups.');
  }

  return { expense, sourceDocument: input, enrichmentWarnings };
}

export function parseSpendingPlan(input: unknown, effectiveType: KnownGroupType = 'trip', sourceVersion: 1 | 2 = 1): SpendingPlan {
  const schema = effectiveType === 'fuel' ? fuelMonthlyPlanV2Schema : sourceVersion === 1 ? legacyTripPlanSchema : tripPlanV2Schema;
  const result = schema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid spending plan.');
  return result.data as SpendingPlan;
}

export function validateFuelTypeData(data: FuelExpenseDataV1, amountMinor: number, currencyCode: CurrencyCode): string | null {
  if (data.discount_minor !== undefined && data.gross_amount_minor === undefined) return 'Discount requires a pre-discount total.';
  if (data.gross_amount_minor !== undefined) {
    const discount = data.discount_minor ?? 0;
    if (data.gross_amount_minor - discount !== amountMinor) return 'Pre-discount total minus discount must equal Amount paid.';
  }
  if (data.gross_amount_minor !== undefined && data.unit_price_micros_per_litre !== undefined) {
    const calculated = calculatedFuelGrossMinor(data.volume_millilitres, data.unit_price_micros_per_litre, currencyCode);
    if (Math.abs(calculated - data.gross_amount_minor) > 2) return 'Litres and printed unit price do not match the pre-discount total.';
  }
  return null;
}

export function calculatedFuelGrossMinor(volumeMl: number, unitPriceMicros: number, currencyCode: CurrencyCode): number {
  const numerator = BigInt(volumeMl) * BigInt(unitPriceMicros) * 10n ** BigInt(currencies[currencyCode].minorDigits);
  const denominator = 1_000_000_000n;
  const rounded = (numerator + denominator / 2n) / denominator;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainValidationError('Fuel arithmetic exceeds the supported safe-integer range.');
  return Number(rounded);
}

function validateTripPlanFields(plan: { budget_minor?: number; category_budgets_minor?: Partial<Record<(typeof expenseCategories)[number], number>>; starts_on?: string; ends_on?: string }, context: z.RefinementCtx) {
  if ((plan.starts_on === undefined) !== (plan.ends_on === undefined)) context.addIssue({ code: 'custom', message: 'Spending plan dates must both be set or both be absent.' });
  if (plan.starts_on && plan.ends_on && plan.ends_on < plan.starts_on) context.addIssue({ code: 'custom', message: 'Spending plan end date cannot be before its start date.' });
  const categoryBudgets = plan.category_budgets_minor ? Object.values(plan.category_budgets_minor).filter((value) => value !== undefined) : [];
  if (plan.category_budgets_minor && categoryBudgets.length === 0) context.addIssue({ code: 'custom', message: 'Category budgets cannot be empty.' });
  if (plan.category_budgets_minor && plan.budget_minor === undefined) context.addIssue({ code: 'custom', message: 'Category budgets require a total budget.' });
}

function validateExpenseShares(raw: z.infer<typeof expenseSchema>) {
  const normalizedParticipants = raw.participants.map((value) => value.toLowerCase());
  if (new Set(normalizedParticipants).size !== raw.participants.length) throw new DomainValidationError('Expense participants must be unique.');
  const shareKeys = Object.keys(raw.shares_minor);
  if (shareKeys.length !== raw.participants.length || !normalizedParticipants.every((participant) => shareKeys.some((key) => key.toLowerCase() === participant))) {
    throw new DomainValidationError('Expense shares must exactly match participants.');
  }
  let shareTotal = 0;
  for (const value of Object.values(raw.shares_minor)) {
    shareTotal += value;
    if (!Number.isSafeInteger(shareTotal)) throw new DomainValidationError('Expense shares exceed the supported safe-integer range.');
  }
  if (shareTotal !== raw.amount_minor) throw new DomainValidationError('Expense shares must total the amount.');
  if (raw.split_type === 'full') {
    if (raw.participants.length !== 1 || raw.participants[0]?.toLowerCase() === raw.paid_by.toLowerCase() || Object.values(raw.shares_minor)[0] !== raw.amount_minor) {
      throw new DomainValidationError('Full-to-one expense is invalid.');
    }
  }
  if ((raw.updated_by === null) !== (raw.updated_at === null)) throw new DomainValidationError('Expense update audit fields must both be set or both be null.');
}

function pickFuelTypeData(input: z.infer<typeof fuelTypeDataSchema>): FuelExpenseDataV1 {
  return {
    schema_version: 1,
    type: 'fuel',
    volume_millilitres: input.volume_millilitres,
    ...(input.receipt_datetime === undefined ? {} : { receipt_datetime: input.receipt_datetime }),
    ...(input.unit_price_micros_per_litre === undefined ? {} : { unit_price_micros_per_litre: input.unit_price_micros_per_litre }),
    ...(input.gross_amount_minor === undefined ? {} : { gross_amount_minor: input.gross_amount_minor }),
    ...(input.discount_minor === undefined ? {} : { discount_minor: input.discount_minor }),
    ...(input.fuel_type === undefined ? {} : { fuel_type: input.fuel_type }),
  };
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
