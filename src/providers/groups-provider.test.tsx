import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { calculateBalances, simplifySettlements } from '@/domain/balances';
import type { Expense, RemoteGroupSnapshot } from '@/domain/types';
import { snapshotStore } from '@/infrastructure/runtime';

import { GroupsProvider, useGroups } from './groups-provider';
import { useSession } from './session-provider';

jest.mock('@/infrastructure/runtime', () => ({
  githubGateway: { discoverGroups: jest.fn() },
  snapshotStore: {
    readGroups: jest.fn(), readPendingGroup: jest.fn(), writeGroup: jest.fn(), writeGroups: jest.fn(),
  },
  systemClock: { now: () => new Date('2026-07-17T12:00:00.000Z') },
}));
jest.mock('./session-provider', () => ({ useSession: jest.fn(), isTerminalAuthError: () => false }));

const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' };
const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const expense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
  currency: 'EUR', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 },
  expense_date: '2026-07-17', created_by: 'owner', created_at: '2026-07-17T10:00:00.000Z', updated_by: null, updated_at: null,
};

function snapshot(value: Expense = expense, blobSha = 'expense-sha'): RemoteGroupSnapshot {
  const balances = calculateBalances([value], members);
  return {
    key: 'owner/branch-balance-trip', repository, group, members, pendingMembers: [],
    expenses: [{ expense: value, blobSha, path: `expenses/${value.id}.json` }],
    balances, settlements: simplifySettlements(balances.members), warnings: [], syncedAt: '2026-07-17T12:00:00.000Z',
  };
}

describe('GroupsProvider snapshot summaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: null, avatarUrl: null }, error: null }, expire: jest.fn() } as never);
    jest.mocked(snapshotStore.readGroups).mockResolvedValue([{ key: 'owner/branch-balance-trip', repository, group, summary: null }]);
    jest.mocked(snapshotStore.readPendingGroup).mockResolvedValue(null);
    jest.mocked(snapshotStore.writeGroup).mockResolvedValue(undefined);
    jest.mocked(snapshotStore.writeGroups).mockResolvedValue(undefined);
  });

  it('updates the in-memory summary before persisting the confirmed snapshot', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));

    const confirmed = snapshot();
    await act(() => view.result.current.applyGroupSnapshot(confirmed));

    expect(view.result.current.state.data[0]?.summary).toEqual({
      currency: 'EUR', currentUserBalanceMinor: 500, memberCount: 2, expenseCount: 1, syncedAt: confirmed.syncedAt,
    });
    expect(snapshotStore.writeGroup).toHaveBeenCalledWith(7, confirmed.key, confirmed);
    expect(snapshotStore.writeGroups).toHaveBeenCalledWith(7, view.result.current.state.data);
  });

  it('protects mutations across group-provider remounts until remote state acknowledges them', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    const updated = { ...expense, description: 'Updated dinner', amount_minor: 2000, shares_minor: { owner: 1000, friend: 1000 } };
    const updatedFile = { expense: updated, blobSha: 'updated-sha', path: `expenses/${expense.id}.json` as const };

    view.result.current.recordConfirmedExpenseMutation('owner/branch-balance-trip', { kind: 'upsert', file: updatedFile });
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses[0]).toEqual(updatedFile);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot(updated, 'updated-sha')).expenses[0]).toEqual(updatedFile);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses[0]?.expense.description).toBe('Dinner');

    view.result.current.recordConfirmedExpenseMutation('owner/branch-balance-trip', { kind: 'delete', expenseId: expense.id });
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses).toEqual([]);
    expect(view.result.current.reconcileRemoteGroupSnapshot({ ...snapshot(), expenses: [] }).expenses).toEqual([]);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses).toHaveLength(1);
  });
});
