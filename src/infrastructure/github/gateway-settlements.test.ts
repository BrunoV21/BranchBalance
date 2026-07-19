import { AppFailure } from '@/domain/errors';
import type { Expense, Member, SettlementLedgerFile, SettlementPayment } from '@/domain/types';

import { GitHubGatewayImpl, type GitHubRequestClient } from './gateway';

const encoded = (value: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const members: Member[] = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' },
];
const expense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1_000,
  currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 },
  expense_date: '2026-07-19', created_by: 'owner', created_at: '2026-07-19T10:00:00.000Z', updated_by: null, updated_at: null,
};
const payment: SettlementPayment = {
  id: '8f6cdb85-4677-44af-8d16-e6f70ea54b8a', from: 'friend', to: 'owner', amount_minor: 300, currency: 'EUR', paid_on: '2026-07-19',
  note: 'Receipt: shared-folder/42', status: 'pending', recorded_by: 'friend', recorded_at: '2026-07-19T12:00:00.000Z', confirmed_by: null, confirmed_at: null,
};

function clientWith(handler: (route: string, parameters: Record<string, unknown>) => unknown): GitHubRequestClient {
  return { request: async (route, parameters = {}) => handler(route, parameters) as never };
}

function ledgerFile(value: SettlementPayment = payment): SettlementLedgerFile {
  const sourceDocument = { schema_version: 1, payments: [{ ...value, future: { retained: true } }], future_top: true };
  return { payments: [value], blobSha: 'ledger-sha', path: 'settlements.json', sourceDocument, warnings: [] };
}

describe('GitHubGateway settlement ledger', () => {
  it('maps a missing ledger to a verified empty state', async () => {
    const gateway = new GitHubGatewayImpl(clientWith(() => { throw new AppFailure({ kind: 'not_found', resource: 'Settlement ledger' }); }), { now: () => new Date() });
    await expect(gateway.readSettlementLedger(repository, 'EUR')).resolves.toEqual({ kind: 'missing', payments: [] });
  });

  it('creates the first pending record without a SHA and without sensitive commit content', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'created-sha' } }, headers: {}, status: 201 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    const file = await gateway.recordSettlementPayment(repository, { kind: 'missing', payments: [] }, payment, { currency: 'EUR', expenses: [expense], members });
    expect(file).toMatchObject({ blobSha: 'created-sha', payments: [payment] });
    const parameters = request.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(parameters).not.toHaveProperty('sha');
    expect(parameters.message).toBe(`Record settlement payment ${payment.id}`);
    expect(parameters.message).not.toContain(payment.note);
    expect(JSON.parse(atob(parameters.content as string))).toMatchObject({ schema_version: 1, payments: [payment] });
  });

  it('rejects future writes and UUID collisions hidden in invalid source entries', async () => {
    const request = jest.fn();
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() }, { today: () => '2026-07-19' });
    await expect(gateway.recordSettlementPayment(repository, { kind: 'missing', payments: [] }, { ...payment, paid_on: '2026-07-20' }, { currency: 'EUR', expenses: [expense], members })).rejects.toThrow(/future/i);
    const collision = { kind: 'ready' as const, file: { payments: [], blobSha: 'sha', path: 'settlements.json' as const, sourceDocument: { schema_version: 1, payments: [{ ...payment, amount_minor: 'invalid' }] }, warnings: [] } };
    await expect(gateway.recordSettlementPayment(repository, collision, payment, { currency: 'EUR', expenses: [expense], members })).rejects.toMatchObject({ detail: { kind: 'settlement_record_conflict' } });
    expect(request).not.toHaveBeenCalled();
  });

  it('allows only the recipient to confirm and preserves immutable note and unknown fields', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'confirmed-sha' } }, headers: {}, status: 200 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    await expect(gateway.confirmSettlementPayment(repository, ledgerFile(), payment.id, 'friend', '2026-07-19T12:01:00.000Z')).rejects.toMatchObject({ detail: { kind: 'settlement_confirmation_unauthorized' } });
    const confirmed = await gateway.confirmSettlementPayment(repository, ledgerFile(), payment.id, 'OWNER', '2026-07-19T12:01:00.000Z');
    expect(confirmed.payments[0]).toMatchObject({ note: payment.note, status: 'confirmed', confirmed_by: 'OWNER' });
    expect(confirmed.sourceDocument).toMatchObject({ future_top: true, payments: [{ future: { retained: true }, note: payment.note }] });
  });

  it('retains an empty ledger and top-level passthrough data after deletion', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'empty-sha' } }, headers: {}, status: 200 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    const result = await gateway.deleteSettlementPayment(repository, ledgerFile(), payment.id);
    expect(result).toMatchObject({ kind: 'ready', file: { blobSha: 'empty-sha', payments: [], sourceDocument: { future_top: true, payments: [] } } });
  });

  it('does not treat a concurrently duplicated target ID as an already-absent delete', async () => {
    const duplicateSource = { schema_version: 1, payments: [payment, { ...payment }] };
    const gateway = new GitHubGatewayImpl(clientWith((route) => {
      if (route.startsWith('PUT ')) throw new AppFailure({ kind: 'github', status: 409, safeMessage: 'Conflict', retryable: false });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'duplicate-sha', content: encoded(duplicateSource) }, headers: {}, status: 200 };
      throw new Error(`Unexpected route ${route}`);
    }), { now: () => new Date() });
    await expect(gateway.deleteSettlementPayment(repository, ledgerFile(), payment.id)).rejects.toMatchObject({ detail: { kind: 'settlement_ledger_invalid' } });
  });
});
