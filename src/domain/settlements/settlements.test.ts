import { calculateBalances, simplifySettlements } from '@/domain/balances';
import type { Expense, Member, SettlementPayment } from '@/domain/types';

import { deriveSettlementReservations, sortSettlementPayments, validateSettlementDraft } from './model';
import { parseSettlementLedgerDocument } from './schema';

const members: Member[] = [
  { login: 'alice', name: null, avatarUrl: null, role: 'owner' },
  { login: 'bob', name: null, avatarUrl: null, role: 'member' },
];
const expense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1_000,
  currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'alice', split_type: 'equal', participants: ['alice', 'bob'],
  shares_minor: { alice: 500, bob: 500 }, expense_date: '2026-07-18', created_by: 'alice', created_at: '2026-07-18T12:00:00.000Z', updated_by: null, updated_at: null,
};
const pending: SettlementPayment = {
  id: '8f6cdb85-4677-44af-8d16-e6f70ea54b8a', from: 'bob', to: 'alice', amount_minor: 300, currency: 'EUR', paid_on: '2026-07-19',
  note: 'External transaction ID: TX-42', status: 'pending', recorded_by: 'bob', recorded_at: '2026-07-19T12:00:00.000Z', confirmed_by: null, confirmed_at: null,
};

describe('settlement ledger schema', () => {
  it('isolates invalid entries, preserves passthrough data, and excludes duplicate IDs', () => {
    const input = {
      schema_version: 1, future: { retained: true }, payments: [
        { ...pending, future_payment_field: true },
        { ...pending },
        { ...pending, id: '9f6cdb85-4677-44af-8d16-e6f70ea54b8a', currency: 'USD' },
        { ...pending, id: 'af6cdb85-4677-44af-8d16-e6f70ea54b8a' },
      ],
    };
    const parsed = parseSettlementLedgerDocument(input, 'EUR');
    expect(parsed.payments.map((payment) => payment.id)).toEqual(['af6cdb85-4677-44af-8d16-e6f70ea54b8a']);
    expect(parsed.warnings).toHaveLength(3);
    expect(parsed.sourceDocument).toBe(input);
  });

  it('validates confirmation audit rules while allowing historical future-looking dates on read', () => {
    const confirmed = { ...pending, paid_on: '2099-01-01', status: 'confirmed', confirmed_by: 'ALICE', confirmed_at: '2026-07-19T12:01:00.000Z' };
    expect(parseSettlementLedgerDocument({ schema_version: 1, payments: [confirmed] }, 'EUR').payments).toHaveLength(1);
    const invalid = { ...confirmed, confirmed_by: 'bob' };
    expect(parseSettlementLedgerDocument({ schema_version: 1, payments: [invalid] }, 'EUR').warnings[0]?.reason).toMatch(/recipient/i);
  });

  it('rejects malformed top-level documents', () => {
    expect(() => parseSettlementLedgerDocument({ schema_version: 1 }, 'EUR')).toThrow(/ledger/i);
  });
});

describe('settlement derivation', () => {
  it('keeps pending payments balance-neutral and reserves only their matching suggestion', () => {
    const balances = calculateBalances([expense], [pending], members);
    expect(balances.members.find((member) => member.login === 'bob')).toMatchObject({ netMinor: -500, settlementSentMinor: 0 });
    const suggestions = simplifySettlements(balances.members);
    expect(deriveSettlementReservations(suggestions, [pending])).toEqual([{ from: 'bob', to: 'alice', pendingMinor: 300, availableToRecordMinor: 200 }]);
  });

  it('applies only confirmed payments and keeps expense totals unchanged', () => {
    const confirmed = { ...pending, status: 'confirmed', confirmed_by: 'alice', confirmed_at: '2026-07-19T12:01:00.000Z' } as const;
    const balances = calculateBalances([expense], [confirmed], members);
    expect(balances.totalSpentMinor).toBe(1_000);
    expect(balances.members.find((member) => member.login === 'bob')).toMatchObject({ totalShareMinor: 500, settlementSentMinor: 300, netMinor: -200 });
    expect(balances.members.find((member) => member.login === 'alice')).toMatchObject({ totalPaidMinor: 1_000, settlementReceivedMinor: 300, netMinor: 200 });
  });

  it('validates unreserved availability, future dates, note trimming, and deterministic history', () => {
    const suggestions = [{ from: 'bob', to: 'alice', amountMinor: 500 }];
    const reservations = deriveSettlementReservations(suggestions, [pending]);
    expect(validateSettlementDraft({ from: 'BOB', to: 'Alice', amount: '2.00', paidOn: '2026-07-19', note: '  receipt  ' }, suggestions, reservations, 'EUR', '2026-07-19')).toMatchObject({ amountMinor: 200, note: 'receipt' });
    expect(() => validateSettlementDraft({ from: 'bob', to: 'alice', amount: '2.01', paidOn: '2026-07-19', note: '' }, suggestions, reservations, 'EUR', '2026-07-19')).toThrow(/unreserved/i);
    expect(() => validateSettlementDraft({ from: 'bob', to: 'alice', amount: '1.00', paidOn: '2026-07-20', note: '' }, suggestions, reservations, 'EUR', '2026-07-19')).toThrow(/future/i);
    expect(sortSettlementPayments([{ ...pending, id: 'bf6cdb85-4677-44af-8d16-e6f70ea54b8a', paid_on: '2026-07-18' }, pending]).map((payment) => payment.id)).toEqual([pending.id, 'bf6cdb85-4677-44af-8d16-e6f70ea54b8a']);
  });
});
