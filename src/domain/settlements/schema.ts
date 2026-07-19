import { z } from 'zod';

import { DomainValidationError } from '@/domain/errors';
import { isCalendarDate } from '@/domain/spending/calendar';
import { normalizeLogin, type CurrencyCode, type DataWarning, type SettlementPayment } from '@/domain/types';

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const utcInstant = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'), 'Timestamp must be UTC.');
const login = z.string().trim().min(1, 'Login is required.');
const note = z.string()
  .refine((value) => value === value.trim(), 'Note must be trimmed.')
  .refine((value) => Array.from(value).length > 0, 'Note cannot be empty.')
  .refine((value) => Array.from(value).length <= 2_000, 'Note cannot exceed 2,000 characters.');

const paymentSchema = z.object({
  id: z.string().regex(uuidV4, 'Payment ID must be a lowercase UUID v4.'),
  from: login,
  to: login,
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.enum(['EUR', 'USD', 'GBP']),
  paid_on: z.string().refine(isCalendarDate, 'Payment date must be a real YYYY-MM-DD date.'),
  note: note.optional(),
  status: z.enum(['pending', 'confirmed']),
  recorded_by: login,
  recorded_at: utcInstant,
  confirmed_by: login.nullable(),
  confirmed_at: utcInstant.nullable(),
}).superRefine((payment, context) => {
  if (normalizeLogin(payment.from) === normalizeLogin(payment.to)) {
    context.addIssue({ code: 'custom', message: 'Sender and recipient must differ.', path: ['to'] });
  }
  if (payment.status === 'pending' && (payment.confirmed_by !== null || payment.confirmed_at !== null)) {
    context.addIssue({ code: 'custom', message: 'Pending payments cannot contain confirmation audit fields.', path: ['status'] });
  }
  if (payment.status === 'confirmed') {
    if (!payment.confirmed_by || !payment.confirmed_at) {
      context.addIssue({ code: 'custom', message: 'Confirmed payments require confirmation audit fields.', path: ['status'] });
    } else {
      if (normalizeLogin(payment.confirmed_by) !== normalizeLogin(payment.to)) {
        context.addIssue({ code: 'custom', message: 'Only the recipient can confirm a payment.', path: ['confirmed_by'] });
      }
      if (Date.parse(payment.confirmed_at) < Date.parse(payment.recorded_at)) {
        context.addIssue({ code: 'custom', message: 'Confirmation cannot predate recording.', path: ['confirmed_at'] });
      }
    }
  }
});

export interface ParsedSettlementLedgerDocument {
  payments: SettlementPayment[];
  sourceDocument: Record<string, unknown>;
  warnings: DataWarning[];
}

export function parseSettlementLedgerDocument(input: unknown, groupCurrency: CurrencyCode): ParsedSettlementLedgerDocument {
  if (!isRecord(input) || input.schema_version !== 1 || !Array.isArray(input.payments)) {
    throw new DomainValidationError('Invalid settlement ledger. Expected schema_version 1 and a payments array.');
  }

  const duplicateIds = duplicatedIds(input.payments);
  const payments: SettlementPayment[] = [];
  const warnings: DataWarning[] = [];
  input.payments.forEach((raw, index) => {
    const path = `settlements.json#payments[${index}]`;
    const rawId = isRecord(raw) && typeof raw.id === 'string' ? raw.id.trim().toLowerCase() : null;
    if (rawId && duplicateIds.has(rawId)) {
      warnings.push({ path, reason: 'Payment ID is duplicated; every occurrence was excluded.' });
      return;
    }
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push({ path, reason: parsed.error.issues[0]?.message ?? 'Invalid settlement payment.' });
      return;
    }
    if (parsed.data.currency !== groupCurrency) {
      warnings.push({ path, reason: 'Payment currency does not match its group.' });
      return;
    }
    payments.push(parsed.data as SettlementPayment);
  });
  return { payments, sourceDocument: input, warnings };
}

export function parseSettlementPayment(input: unknown, groupCurrency: CurrencyCode): SettlementPayment {
  const parsed = parseSettlementLedgerDocument({ schema_version: 1, payments: [input] }, groupCurrency);
  if (!parsed.payments[0]) throw new DomainValidationError(parsed.warnings[0]?.reason ?? 'Invalid settlement payment.');
  return parsed.payments[0];
}

function duplicatedIds(payments: unknown[]): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of payments) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue;
    const id = raw.id.trim().toLowerCase();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([id]) => id));
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}
