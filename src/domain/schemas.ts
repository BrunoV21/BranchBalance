import { z } from 'zod';

import { DomainValidationError } from './errors';
import type { Expense, Group, StoredCredentialV1 } from './types';

const isoInstant = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'), 'Timestamp must be UTC.');
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const login = z.string().trim().min(1);
const currency = z.enum(['EUR', 'USD', 'GBP']);

const groupSchema = z.object({
  schema_version: z.literal(1),
  name: z.string().trim().min(1),
  currency,
  created_by: login,
  created_at: isoInstant,
});

const expenseSchema = z.object({
  schema_version: z.literal(1),
  id: z.uuid().transform((value) => value.toLowerCase()),
  description: z.string().trim().min(1).max(120),
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency,
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
  const result = groupSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError(result.error.issues[0]?.message ?? 'Invalid group file.');
  return result.data;
}

export function parseCredential(input: unknown): StoredCredentialV1 {
  const result = credentialSchema.safeParse(input);
  if (!result.success) throw new DomainValidationError('Invalid stored credential.');
  return result.data;
}

export function parseExpenseFile(input: unknown, path: string, groupCurrency: string): Expense {
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
  if (Object.values(raw.shares_minor).reduce((sum, value) => sum + value, 0) !== raw.amount_minor) throw new DomainValidationError('Expense shares must total the amount.');
  if (raw.split_type === 'full') {
    if (raw.participants.length !== 1 || raw.participants[0]?.toLowerCase() === raw.paid_by.toLowerCase() || Object.values(raw.shares_minor)[0] !== raw.amount_minor) {
      throw new DomainValidationError('Full-to-one expense is invalid.');
    }
  }
  if ((raw.updated_by === null) !== (raw.updated_at === null)) throw new DomainValidationError('Expense update audit fields must both be set or both be null.');
  return { ...raw, expense_date: raw.expense_date ?? raw.created_at.slice(0, 10) } as Expense;
}
