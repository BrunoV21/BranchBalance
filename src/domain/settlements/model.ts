import type { Clock } from '@/features/auth/contracts';

import { DomainValidationError } from '../errors';
import { parseAmountToMinor } from '../money';
import { isCalendarDate } from '../spending/calendar';
import {
  normalizeLogin,
  type CalendarDate,
  type CurrencyCode,
  type SettlementPayment,
  type SettlementReservation,
  type SuggestedSettlement,
} from '../types';

export interface SettlementPaymentDraft {
  from: string;
  to: string;
  amount: string;
  paidOn: CalendarDate;
  note: string;
}

export interface ValidSettlementPaymentInput {
  from: string;
  to: string;
  amountMinor: number;
  paidOn: CalendarDate;
  note?: string;
}

export function sortSettlementPayments(payments: readonly SettlementPayment[]): SettlementPayment[] {
  return [...payments].sort((a, b) => b.paid_on.localeCompare(a.paid_on)
    || b.recorded_at.localeCompare(a.recorded_at)
    || a.id.localeCompare(b.id));
}

export function deriveSettlementReservations(
  suggestions: readonly SuggestedSettlement[],
  payments: readonly SettlementPayment[],
): SettlementReservation[] {
  const pendingByPair = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'pending') continue;
    const key = pairKey(payment.from, payment.to);
    const next = (pendingByPair.get(key) ?? 0) + payment.amount_minor;
    if (!Number.isSafeInteger(next)) throw new DomainValidationError('Pending settlement amounts exceed the supported range.');
    pendingByPair.set(key, next);
  }
  return suggestions.map((suggestion) => {
    const pendingMinor = pendingByPair.get(pairKey(suggestion.from, suggestion.to)) ?? 0;
    return {
      from: suggestion.from,
      to: suggestion.to,
      pendingMinor,
      availableToRecordMinor: Math.max(suggestion.amountMinor - pendingMinor, 0),
    };
  });
}

export function validateSettlementDraft(
  draft: SettlementPaymentDraft,
  suggestions: readonly SuggestedSettlement[],
  reservations: readonly SettlementReservation[],
  currency: CurrencyCode,
  today: CalendarDate,
): ValidSettlementPaymentInput {
  const suggestion = suggestions.find((item) => pairKey(item.from, item.to) === pairKey(draft.from, draft.to));
  if (!suggestion) throw new DomainValidationError('This settlement suggestion is no longer available.', 'settlement');
  const reservation = reservations.find((item) => pairKey(item.from, item.to) === pairKey(draft.from, draft.to));
  const available = reservation?.availableToRecordMinor ?? suggestion.amountMinor;
  const amountMinor = parseAmountToMinor(draft.amount, currency);
  if (amountMinor > available) {
    throw new DomainValidationError('Amount exceeds the current unreserved settlement amount.', 'amount');
  }
  if (!isCalendarDate(draft.paidOn)) throw new DomainValidationError('Choose a valid payment date.', 'paidOn');
  if (draft.paidOn > today) throw new DomainValidationError('Payment date cannot be in the future.', 'paidOn');
  const trimmedNote = draft.note.trim();
  if (Array.from(trimmedNote).length > 2_000) throw new DomainValidationError('Note cannot exceed 2,000 characters.', 'note');
  return {
    from: suggestion.from,
    to: suggestion.to,
    amountMinor,
    paidOn: draft.paidOn,
    ...(trimmedNote ? { note: trimmedNote } : {}),
  };
}

export function buildSettlementPayment(
  input: ValidSettlementPaymentInput,
  id: string,
  currency: CurrencyCode,
  recordedBy: string,
  clock: Clock,
): SettlementPayment {
  return {
    id: id.toLowerCase(),
    from: input.from,
    to: input.to,
    amount_minor: input.amountMinor,
    currency,
    paid_on: input.paidOn,
    ...(input.note ? { note: input.note } : {}),
    status: 'pending',
    recorded_by: recordedBy,
    recorded_at: clock.now().toISOString(),
    confirmed_by: null,
    confirmed_at: null,
  };
}

export function settlementCreationMatches(left: SettlementPayment, right: SettlementPayment): boolean {
  return left.id === right.id
    && normalizeLogin(left.from) === normalizeLogin(right.from)
    && normalizeLogin(left.to) === normalizeLogin(right.to)
    && left.amount_minor === right.amount_minor
    && left.currency === right.currency
    && left.paid_on === right.paid_on
    && left.note === right.note
    && normalizeLogin(left.recorded_by) === normalizeLogin(right.recorded_by)
    && left.recorded_at === right.recorded_at;
}

export function pairKey(from: string, to: string): string {
  return `${normalizeLogin(from)}\u0000${normalizeLogin(to)}`;
}
