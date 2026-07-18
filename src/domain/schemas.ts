import { z } from 'zod';

import { DomainValidationError } from './errors';
import { isCalendarDate } from './spending/calendar';
import { expenseCategories, paymentMethods } from './spending/catalog';
import type { Expense, Group, SpendingPlan, StoredCredentialV1 } from './types';

const isoInstant = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'), 'Timestamp must be UTC.');
const calendarDate = z.string().refine(isCalendarDate, 'Date must be a real YYYY-MM-DD calendar date.');
const login = z.string().trim().min(1);
const currency = z.enum(['EUR', 'USD', 'GBP']);

const groupSchema = z.object({
  schema_version: z.literal(1),
  name: z.string().trim().min(1),
  currency,
  created_by: login,
  created_at: isoInstant,
});

const positiveSafeInteger = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const categoryBudgetSchema = z.object(Object.fromEntries(expenseCategories.map((category) => [category, positiveSafeInteger.optional()])) as Record<(typeof expenseCategories)[number], z.ZodOptional<typeof positiveSafeInteger>>).strict();
const spendingPlanSchema = z.object({
  budget_minor: positiveSafeInteger.optional(),
  category_budgets_minor: categoryBudgetSchema.optional(),
  starts_on: calendarDate.optional(),
  ends_on: calendarDate.optional(),
  updated_by: login,
  updated_at: isoInstant,
}).strict().superRefine((plan, context) => {
  const hasDates = plan.starts_on !== undefined || plan.ends_on !== undefined;
  if (plan.budget_minor === undefined && !hasDates) context.addIssue({ code: 'custom', message: 'Spending plan must contain a budget or date range.' });
  if ((plan.starts_on === undefined) !== (plan.ends_on === undefined)) context.addIssue({ code: 'custom', message: 'Spending plan dates must both be set or both be absent.' });
  if (plan.starts_on && plan.ends_on && plan.ends_on < plan.starts_on) context.addIssue({ code: 'custom', message: 'Spending plan end date cannot be before its start date.' });
  const categoryBudgets = plan.category_budgets_minor ? Object.values(plan.category_budgets_minor).filter((value) => value !== undefined) : [];
  if (plan.category_budgets_minor && categoryBudgets.length === 0) context.addIssue({ code: 'custom', message: 'Category budgets cannot be empty.' });
  if (plan.category_budgets_minor && plan.budget_minor === undefined) context.addIssue({ code: 'custom', message: 'Category budgets require a total budget.' });
});

const expenseSchema = z.object({
  schema_version: z.literal(1),
  id: z.uuid().transform((value) => value.toLowerCase()),
  description: z.string().trim().min(1).max(120),
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
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
  spendingPlanWarning: string | null;
}

export function parseGroupDocument(input: unknown): ParsedGroupDocument {
  if (!isRecord(input)) throw new DomainValidationError('Invalid group file.');
  const result = groupSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid group file.');
  if (!Object.prototype.hasOwnProperty.call(input, 'spending_plan')) return { group: result.data, sourceDocument: input, spendingPlanWarning: null };
  const plan = spendingPlanSchema.safeParse(input.spending_plan);
  if (!plan.success) {
    return {
      group: result.data,
      sourceDocument: input,
      spendingPlanWarning: plan.error.issues[0]?.message ?? 'Invalid spending plan.',
    };
  }
  return { group: { ...result.data, spending_plan: plan.data as SpendingPlan }, sourceDocument: input, spendingPlanWarning: null };
}

export function parseCredential(input: unknown): StoredCredentialV1 {
  const result = credentialSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError('Invalid stored credential.');
  return result.data;
}

export function parseExpenseFile(input: unknown, path: string, groupCurrency: string): Expense {
  return parseExpenseDocument(input, path, groupCurrency).expense;
}

export function parseExpenseDocument(input: unknown, path: string, groupCurrency: string): { expense: Expense; sourceDocument: Record<string, unknown> } {
  if (!isRecord(input)) throw new DomainValidationError('Invalid expense file.');
  const result = expenseSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid expense file.');
  const raw = result.data;
  const expectedPath = `expenses/${raw.id}.json`;
  if (path.toLowerCase() !== expectedPath) throw new DomainValidationError('Expense filename does not match its id.');
  if (raw.currency !== groupCurrency) throw new DomainValidationError('Expense currency does not match its group.');
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
  const expense = {
    ...raw,
    category: raw.category ?? null,
    payment_method: raw.payment_method ?? null,
    expense_date: raw.expense_date ?? raw.created_at.slice(0, 10),
  } as Expense;
  return { expense, sourceDocument: input };
}

export function parseSpendingPlan(input: unknown): SpendingPlan {
  const result = spendingPlanSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid spending plan.');
  return result.data as SpendingPlan;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
