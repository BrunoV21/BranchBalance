import { DomainValidationError } from './errors';
import type { CurrencyCode } from './types';

export const currencies = {
  EUR: { minorDigits: 2, symbol: '€', name: 'Euro' },
  USD: { minorDigits: 2, symbol: '$', name: 'US dollar' },
  GBP: { minorDigits: 2, symbol: '£', name: 'Pound sterling' },
} as const satisfies Record<CurrencyCode, { minorDigits: number; symbol: string; name: string }>;

export function parseAmountToMinor(input: string, currency: CurrencyCode): number {
  const value = input.trim();
  if (!value || /[+\-eE\s]/.test(value) || (value.includes('.') && value.includes(','))) {
    throw new DomainValidationError('Enter a positive amount using one decimal separator.', 'amount');
  }
  const separator = value.includes(',') ? ',' : '.';
  const parts = value.split(separator);
  if (parts.length > 2 || !/^\d+$/.test(parts[0] ?? '') || (parts[1] !== undefined && !/^\d+$/.test(parts[1]))) {
    throw new DomainValidationError('Enter a valid amount.', 'amount');
  }
  const digits = currencies[currency].minorDigits;
  const fraction = parts[1] ?? '';
  if (fraction.length > digits) throw new DomainValidationError(`Use no more than ${digits} decimal places.`, 'amount');
  const minorText = `${(parts[0] ?? '').replace(/^0+(?=\d)/, '') || '0'}${fraction.padEnd(digits, '0')}`;
  const amount = Number(minorText);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new DomainValidationError('Amount must be greater than zero.', 'amount');
  return amount;
}

export function formatMoney(amountMinor: number, currency: CurrencyCode, locale?: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 10 ** currencies[currency].minorDigits);
}

function uniqueSorted(participants: string[]): string[] {
  const byNormalized = new Map<string, string>();
  for (const raw of participants) {
    const login = raw.trim();
    if (!login) continue;
    const normalized = login.toLowerCase();
    if (!byNormalized.has(normalized)) byNormalized.set(normalized, login);
  }
  return [...byNormalized.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()) || a.localeCompare(b));
}

export function allocateEqual(amountMinor: number, participants: string[]): Record<string, number> {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new DomainValidationError('Amount must be a positive integer.');
  const sorted = uniqueSorted(participants);
  if (!sorted.length) throw new DomainValidationError('Select at least one participant.', 'participants');
  const quotient = Math.floor(amountMinor / sorted.length);
  const remainder = amountMinor % sorted.length;
  return Object.fromEntries(sorted.map((login, index) => [login, quotient + (index < remainder ? 1 : 0)]));
}

export function allocateFull(amountMinor: number, payer: string, participant: string): Record<string, number> {
  const login = participant.trim();
  if (!login) throw new DomainValidationError('Select who owes the full amount.', 'participants');
  if (login.toLowerCase() === payer.trim().toLowerCase()) throw new DomainValidationError('The payer cannot owe the full amount.', 'participants');
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new DomainValidationError('Amount must be a positive integer.');
  return { [login]: amountMinor };
}
