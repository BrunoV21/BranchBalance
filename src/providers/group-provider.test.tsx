import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { calculateBalances, simplifySettlements } from '@/domain/balances';
import type { Expense, RemoteGroupSnapshot } from '@/domain/types';
import { type ConfirmedExpenseMutation, reconcileConfirmedExpenseMutations } from '@/features/expenses/snapshot-reconciliation';
import { githubGateway, snapshotStore } from '@/infrastructure/runtime';

import { GroupProvider, useGroup } from './group-provider';
import { useGroups } from './groups-provider';
import { useSession } from './session-provider';

jest.mock('@/infrastructure/runtime', () => ({
  githubGateway: { refreshGroup: jest.fn(), createExpense: jest.fn(), readExpense: jest.fn(), updateExpense: jest.fn(), deleteExpense: jest.fn() },
  snapshotStore: { readGroup: jest.fn() },
  systemClock: { now: () => new Date('2026-07-17T12:00:00.000Z') },
}));
jest.mock('./groups-provider', () => ({ useGroups: jest.fn() }));
jest.mock('./session-provider', () => ({ useSession: jest.fn(), isTerminalAuthError: () => false }));

const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const originalExpense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Old dinner', amount_minor: 1000,
  currency: 'EUR', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 },
  expense_date: '2026-07-17', created_by: 'owner', created_at: '2026-07-17T10:00:00.000Z', updated_by: null, updated_at: null,
};
const updatedExpense: Expense = {
  ...originalExpense, description: 'Updated dinner', amount_minor: 2000, shares_minor: { owner: 1000, friend: 1000 },
  updated_by: 'owner', updated_at: '2026-07-17T12:00:00.000Z',
};
const newExpense: Expense = {
  ...originalExpense,
  id: '7a3d2c4b-1e5f-4a8b-9c6d-2f0e1a3b4c5d',
  description: 'Train tickets',
  amount_minor: 3000,
  shares_minor: { owner: 1500, friend: 1500 },
  created_at: '2026-07-17T12:00:00.000Z',
};

function snapshot(expense: Expense, blobSha: string): RemoteGroupSnapshot {
  return snapshotWithFiles([{ expense, blobSha, path: `expenses/${expense.id}.json` }]);
}

function snapshotWithFiles(expenses: RemoteGroupSnapshot['expenses']): RemoteGroupSnapshot {
  const balances = calculateBalances(expenses.map((file) => file.expense), members);
  return {
    key: 'owner/branch-balance-trip', repository,
    group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' },
    members, pendingMembers: [], expenses,
    balances, settlements: simplifySettlements(balances.members), warnings: [], syncedAt: '2026-07-17T11:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('GroupProvider expense mutations', () => {
  const originalSnapshot = snapshot(originalExpense, 'old-sha');
  const applyGroupSnapshot = jest.fn().mockResolvedValue(undefined);
  const removeGroup = jest.fn().mockResolvedValue(undefined);
  const confirmedMutations = new Map<string, ConfirmedExpenseMutation>();
  const recordConfirmedExpenseMutation = jest.fn((_key: string, mutation: ConfirmedExpenseMutation) => {
    confirmedMutations.set(mutation.kind === 'upsert' ? mutation.file.expense.id : mutation.expenseId, mutation);
  });
  const reconcileRemoteGroupSnapshot = jest.fn((remote: RemoteGroupSnapshot) => reconcileConfirmedExpenseMutations(remote, confirmedMutations));

  beforeEach(() => {
    jest.clearAllMocks();
    confirmedMutations.clear();
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: null, avatarUrl: null }, error: null }, expire: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({
      state: { data: [{ key: originalSnapshot.key, repository, group: originalSnapshot.group, summary: null }] },
      applyGroupSnapshot, recordConfirmedExpenseMutation, reconcileRemoteGroupSnapshot, removeGroup,
    } as never);
    jest.mocked(snapshotStore.readGroup).mockResolvedValue(originalSnapshot);
    jest.mocked(githubGateway.createExpense).mockResolvedValue({ expense: newExpense, blobSha: 'created-sha', path: `expenses/${newExpense.id}.json` });
    jest.mocked(githubGateway.updateExpense).mockResolvedValue({ expense: updatedExpense, blobSha: 'new-sha', path: `expenses/${updatedExpense.id}.json` });
    jest.mocked(githubGateway.refreshGroup).mockResolvedValue(originalSnapshot);
  });

  it('does not let a focus refresh replace a confirmed edit with a stale remote snapshot', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data?.expenses[0]?.expense.description).toBe('Old dinner'));

    await act(() => view.result.current.updateExpense(updatedExpense, 'old-sha'));
    expect(view.result.current.state.data?.expenses[0]?.expense.description).toBe('Updated dinner');

    await act(() => view.result.current.refresh());
    expect(githubGateway.refreshGroup).toHaveBeenCalledTimes(1);
    expect(view.result.current.state.data?.expenses[0]?.expense.description).toBe('Updated dinner');

    jest.mocked(githubGateway.refreshGroup).mockResolvedValue(snapshot(updatedExpense, 'new-sha'));
    await act(() => view.result.current.refresh());
    expect(githubGateway.refreshGroup).toHaveBeenCalledTimes(2);
    expect(view.result.current.state.data?.expenses[0]?.expense.description).toBe('Updated dinner');
  });

  it('adds a confirmed expense and recalculates every derived value before resolving', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).not.toBeNull());

    await act(() => view.result.current.createExpense(newExpense));

    const next = view.result.current.state.data!;
    expect(next.expenses.map((file) => file.expense.description)).toEqual(['Train tickets', 'Old dinner']);
    expect(next.balances.totalSpentMinor).toBe(4000);
    expect(next.balances.members.find((member) => member.login === 'owner')?.netMinor).toBe(2000);
    expect(next.settlements).toEqual([{ from: 'friend', to: 'owner', amountMinor: 2000 }]);
    expect(applyGroupSnapshot).toHaveBeenLastCalledWith(next);
  });

  it('keeps a remotely confirmed expense visible when cache persistence fails', async () => {
    applyGroupSnapshot.mockRejectedValueOnce(new Error('Storage unavailable'));
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).not.toBeNull());

    await act(() => view.result.current.createExpense(newExpense));

    await waitFor(() => expect(view.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true));
    expect(view.result.current.state.error).toBe('Expense saved, but the offline cache could not be updated.');
  });

  it('keeps a confirmed create when an older in-flight refresh finishes afterward', async () => {
    const pendingRefresh = deferred<RemoteGroupSnapshot>();
    jest.mocked(githubGateway.refreshGroup).mockReturnValueOnce(pendingRefresh.promise);
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).not.toBeNull());

    let refreshPromise!: Promise<RemoteGroupSnapshot>;
    await act(async () => { refreshPromise = view.result.current.refresh(); await Promise.resolve(); });
    expect(view.result.current.state.isRefreshing).toBe(true);
    await act(() => view.result.current.createExpense(newExpense));
    expect(view.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true);
    await act(async () => { pendingRefresh.resolve(originalSnapshot); await refreshPromise; });

    expect(view.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true);
    expect(view.result.current.state.data?.balances.totalSpentMinor).toBe(4000);
  });

  it('ignores stale cache hydration after a newer refresh and confirmed create', async () => {
    const pendingCache = deferred<RemoteGroupSnapshot | null>();
    jest.mocked(snapshotStore.readGroup).mockReturnValueOnce(pendingCache.promise);
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook(() => useGroup(), { wrapper });

    await act(() => view.result.current.refresh());
    await act(() => view.result.current.createExpense(newExpense));
    await act(async () => { pendingCache.resolve(originalSnapshot); await pendingCache.promise; });

    expect(view.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true);
    expect(view.result.current.state.data?.balances.totalSpentMinor).toBe(4000);
  });

  it('keeps a confirmed create after leaving and re-entering the group', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const firstVisit = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(firstVisit.result.current.state.data).not.toBeNull());
    await act(() => firstVisit.result.current.createExpense(newExpense));
    const confirmedSnapshot = firstVisit.result.current.state.data!;
    await firstVisit.unmount();

    jest.mocked(snapshotStore.readGroup).mockResolvedValue(confirmedSnapshot);
    jest.mocked(githubGateway.refreshGroup).mockResolvedValue(originalSnapshot);
    const secondVisit = await renderHook(() => useGroup(), { wrapper });
    await waitFor(() => expect(secondVisit.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true));
    await act(() => secondVisit.result.current.refresh());

    expect(secondVisit.result.current.state.data?.expenses.some((file) => file.expense.id === newExpense.id)).toBe(true);
    expect(secondVisit.result.current.state.data?.balances.totalSpentMinor).toBe(4000);
  });

  it('keeps the refresh callback stable when a refresh replaces the group descriptor object', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupProvider owner="owner" repo="branch-balance-trip">{children}</GroupProvider>;
    const view = await renderHook<ReturnType<typeof useGroup>, { descriptorVersion: number }>(() => useGroup(), { wrapper, initialProps: { descriptorVersion: 1 } });
    await waitFor(() => expect(view.result.current.state.data).not.toBeNull());
    const initialRefresh = view.result.current.refresh;

    jest.mocked(useGroups).mockReturnValue({
      state: { data: [{ key: originalSnapshot.key, repository: { ...repository }, group: { ...originalSnapshot.group }, summary: null }] },
      applyGroupSnapshot, recordConfirmedExpenseMutation, reconcileRemoteGroupSnapshot, removeGroup,
    } as never);
    await view.rerender({ descriptorVersion: 2 });

    expect(view.result.current.refresh).toBe(initialRefresh);
  });
});
