import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { calculateBalances, simplifySettlements } from '@/domain/balances';
import { AppFailure } from '@/domain/errors';
import { deriveSpendingSummary } from '@/domain/spending';
import type { DiscoveredGroup, Expense, PendingGroupInvitation, RemoteGroupSnapshot } from '@/domain/types';
import { githubGateway, snapshotStore } from '@/infrastructure/runtime';

import { GroupsProvider, useGroups } from './groups-provider';
import { useSession } from './session-provider';

jest.mock('@/infrastructure/runtime', () => ({
  githubGateway: {
    discoverGroups: jest.fn(), listGroupInvitations: jest.fn(), acceptGroupInvitation: jest.fn(), declineGroupInvitation: jest.fn(),
  },
  snapshotStore: {
    readGroups: jest.fn(), readPendingGroup: jest.fn(), writeGroup: jest.fn(), writeGroups: jest.fn(), removeGroup: jest.fn(),
  },
  systemClock: { now: () => new Date('2026-07-17T12:00:00.000Z') },
  systemLocalCalendar: { today: () => '2026-07-17' },
}));
jest.mock('./session-provider', () => ({ useSession: jest.fn(), isTerminalAuthError: () => false }));

const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' };
const descriptor = { key: 'owner/branch-balance-trip', repository, group, summary: null } satisfies DiscoveredGroup;
const receivedInvitation = {
  id: 50,
  repository: { id: 2, owner: 'friend', ownerType: 'User' as const, name: 'branch-balance-weekend', fullName: 'friend/branch-balance-weekend', private: true as const },
  invitee: 'owner', inviter: 'friend', permission: 'write' as const, createdAt: '2026-07-17T11:00:00.000Z', provisionalName: 'Weekend',
} satisfies PendingGroupInvitation;
const acceptedRepository = { id: 2, owner: 'friend', name: 'branch-balance-weekend', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: false, canWrite: true };
const acceptedGroup = { schema_version: 1 as const, name: 'Weekend', currency: 'EUR' as const, created_by: 'friend', created_at: '2026-07-17T10:00:00.000Z' };
const acceptedDescriptor = { key: 'friend/branch-balance-weekend', repository: acceptedRepository, group: acceptedGroup, summary: null } satisfies DiscoveredGroup;
const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const expense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
  currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 },
  expense_date: '2026-07-17', created_by: 'owner', created_at: '2026-07-17T10:00:00.000Z', updated_by: null, updated_at: null,
};

function snapshot(value: Expense = expense, blobSha = 'expense-sha'): RemoteGroupSnapshot {
  const balances = calculateBalances([value], members);
  return {
    key: 'owner/branch-balance-trip', repository, group, groupFile: { group, blobSha: 'group-sha', path: 'group.json', sourceDocument: { ...group } }, members, pendingMembers: [],
    expenses: [{ expense: value, blobSha, path: `expenses/${value.id}.json`, sourceDocument: { ...value } }],
    balances, settlements: simplifySettlements(balances.members), spending: deriveSpendingSummary([value], undefined, 'owner', '2026-07-17'), warnings: [], syncedAt: '2026-07-17T12:00:00.000Z',
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
    jest.mocked(snapshotStore.removeGroup).mockResolvedValue(undefined);
    jest.mocked(githubGateway.discoverGroups).mockResolvedValue({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
    jest.mocked(githubGateway.listGroupInvitations).mockResolvedValue({ invitations: [], warnings: [] });
    jest.mocked(githubGateway.acceptGroupInvitation).mockResolvedValue(undefined);
    jest.mocked(githubGateway.declineGroupInvitation).mockResolvedValue(undefined);
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
    const updatedFile = { expense: updated, blobSha: 'updated-sha', path: `expenses/${expense.id}.json` as const, sourceDocument: { ...updated } };

    view.result.current.recordConfirmedExpenseMutation('owner/branch-balance-trip', { kind: 'upsert', file: updatedFile });
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses[0]).toEqual(updatedFile);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot(updated, 'updated-sha')).expenses[0]).toEqual(updatedFile);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses[0]?.expense.description).toBe('Dinner');

    view.result.current.recordConfirmedExpenseMutation('owner/branch-balance-trip', { kind: 'delete', expenseId: expense.id });
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses).toEqual([]);
    expect(view.result.current.reconcileRemoteGroupSnapshot({ ...snapshot(), expenses: [] }).expenses).toEqual([]);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).expenses).toHaveLength(1);
  });

  it('protects a confirmed spending plan until a refresh acknowledges its group SHA', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    const plan = { budget_minor: 5000, updated_by: 'owner', updated_at: '2026-07-17T12:00:00.000Z' } as const;
    const nextGroup = { ...group, spending_plan: plan };
    const confirmed = { group: nextGroup, blobSha: 'plan-sha', path: 'group.json' as const, sourceDocument: { ...nextGroup } };

    view.result.current.recordConfirmedSpendingPlanMutation('owner/branch-balance-trip', confirmed);
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).group.spending_plan).toEqual(plan);
    const acknowledged = { ...snapshot(), group: nextGroup, groupFile: confirmed, spending: deriveSpendingSummary([expense], plan, 'owner', '2026-07-17') };
    expect(view.result.current.reconcileRemoteGroupSnapshot(acknowledged).groupFile?.blobSha).toBe('plan-sha');
    expect(view.result.current.reconcileRemoteGroupSnapshot(snapshot()).group.spending_plan).toBeUndefined();
  });

  it('removes both the private snapshot and group descriptor after access loss', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));

    await act(() => view.result.current.removeGroup('owner/branch-balance-trip'));

    expect(view.result.current.state.data).toEqual([]);
    expect(snapshotStore.removeGroup).toHaveBeenCalledWith(7, 'owner/branch-balance-trip');
    expect(snapshotStore.writeGroups).toHaveBeenLastCalledWith(7, []);
  });

  it('publishes invitation success independently when accepted-group discovery fails', async () => {
    jest.mocked(githubGateway.discoverGroups).mockRejectedValueOnce(new AppFailure({ kind: 'network', retryable: true }));
    jest.mocked(githubGateway.listGroupInvitations).mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] });
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));

    await act(() => view.result.current.refresh());

    expect(view.result.current.state.data).toEqual([descriptor]);
    expect(view.result.current.state.error).toContain('Unable to reach GitHub');
    expect(view.result.current.invitationState.data).toEqual([receivedInvitation]);
    expect(view.result.current.invitationState.error).toBeNull();
  });

  it('coalesces concurrent dashboard refreshes across both resource branches', async () => {
    const groupDeferred = deferred<{ groups: DiscoveredGroup[]; warnings: []; installationCount: number; hasAllRepositoriesInstallation: boolean }>();
    const invitationDeferred = deferred<{ invitations: PendingGroupInvitation[]; warnings: [] }>();
    jest.mocked(githubGateway.discoverGroups).mockReturnValueOnce(groupDeferred.promise);
    jest.mocked(githubGateway.listGroupInvitations).mockReturnValueOnce(invitationDeferred.promise);
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = view.result.current.refresh();
      second = view.result.current.refresh();
      await Promise.resolve();
    });
    expect(githubGateway.discoverGroups).toHaveBeenCalledTimes(1);
    expect(githubGateway.listGroupInvitations).toHaveBeenCalledTimes(1);
    await act(async () => {
      groupDeferred.resolve({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
      invitationDeferred.resolve({ invitations: [], warnings: [] });
      await Promise.all([first, second]);
    });
  });

  it('accepts once, removes the invitation, and inserts the discovered group', async () => {
    jest.mocked(githubGateway.discoverGroups)
      .mockResolvedValueOnce({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true })
      .mockResolvedValueOnce({ groups: [descriptor, acceptedDescriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
    jest.mocked(githubGateway.listGroupInvitations)
      .mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] })
      .mockResolvedValueOnce({ invitations: [], warnings: [] });
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    await act(() => view.result.current.refresh());

    await act(() => view.result.current.acceptInvitation(receivedInvitation.id));

    expect(githubGateway.acceptGroupInvitation).toHaveBeenCalledTimes(1);
    expect(view.result.current.invitationState.data).toEqual([]);
    expect(view.result.current.state.data.map((item) => item.repository.id)).toEqual([1, 2]);
    expect(view.result.current.acceptedPendingDiscovery).toEqual([]);
    expect(view.result.current.invitationNotice).toContain('added to your groups');
  });

  it('keeps a confirmed acceptance out of invitations when the group is not loadable yet', async () => {
    jest.mocked(githubGateway.discoverGroups)
      .mockResolvedValueOnce({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true })
      .mockResolvedValueOnce({ groups: [descriptor], warnings: [{ path: 'friend/branch-balance-weekend/group.json', reason: 'Missing' }], installationCount: 1, hasAllRepositoriesInstallation: true });
    jest.mocked(githubGateway.listGroupInvitations)
      .mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] })
      .mockResolvedValueOnce({ invitations: [], warnings: [] });
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    await act(() => view.result.current.refresh());

    await act(() => view.result.current.acceptInvitation(receivedInvitation.id));

    expect(view.result.current.invitationState.data).toEqual([]);
    expect(view.result.current.acceptedPendingDiscovery).toEqual([expect.objectContaining({ repositoryId: 2, reason: 'not_loadable' })]);
    expect(view.result.current.invitationNotice).toContain('not loadable yet');
  });

  it('declines once and confirms the invitation is absent without rediscovering groups', async () => {
    jest.mocked(githubGateway.discoverGroups).mockResolvedValueOnce({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
    jest.mocked(githubGateway.listGroupInvitations)
      .mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] })
      .mockResolvedValueOnce({ invitations: [], warnings: [] });
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    await act(() => view.result.current.refresh());

    await act(() => view.result.current.declineInvitation(receivedInvitation.id));

    expect(githubGateway.declineGroupInvitation).toHaveBeenCalledTimes(1);
    expect(githubGateway.discoverGroups).toHaveBeenCalledTimes(1);
    expect(githubGateway.listGroupInvitations).toHaveBeenCalledTimes(2);
    expect(view.result.current.invitationState.data).toEqual([]);
    expect(view.result.current.invitationNotice).toContain('declined');
  });

  it('recovers an ambiguous acceptance from fresh group discovery without resending PATCH', async () => {
    jest.mocked(githubGateway.discoverGroups)
      .mockResolvedValueOnce({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true })
      .mockResolvedValueOnce({ groups: [descriptor, acceptedDescriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
    jest.mocked(githubGateway.listGroupInvitations)
      .mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] })
      .mockResolvedValueOnce({ invitations: [], warnings: [] });
    jest.mocked(githubGateway.acceptGroupInvitation).mockRejectedValueOnce(new AppFailure({ kind: 'network', retryable: true }));
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    await act(() => view.result.current.refresh());

    await act(() => view.result.current.acceptInvitation(receivedInvitation.id));

    expect(githubGateway.acceptGroupInvitation).toHaveBeenCalledTimes(1);
    expect(view.result.current.state.data.map((item) => item.repository.id)).toContain(2);
    expect(view.result.current.invitationState.data).toEqual([]);
    expect(view.result.current.invitationNotice).toContain('added to your groups');
  });

  it('prevents a pre-accept refresh from resurrecting a confirmed invitation and joins duplicate taps', async () => {
    const oldGroups = deferred<{ groups: DiscoveredGroup[]; warnings: []; installationCount: number; hasAllRepositoriesInstallation: boolean }>();
    const oldInvitations = deferred<{ invitations: PendingGroupInvitation[]; warnings: [] }>();
    const forcedGroups = deferred<{ groups: DiscoveredGroup[]; warnings: []; installationCount: number; hasAllRepositoriesInstallation: boolean }>();
    const forcedInvitations = deferred<{ invitations: PendingGroupInvitation[]; warnings: [] }>();
    jest.mocked(githubGateway.discoverGroups)
      .mockResolvedValueOnce({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true })
      .mockReturnValueOnce(oldGroups.promise)
      .mockReturnValueOnce(forcedGroups.promise);
    jest.mocked(githubGateway.listGroupInvitations)
      .mockResolvedValueOnce({ invitations: [receivedInvitation], warnings: [] })
      .mockReturnValueOnce(oldInvitations.promise)
      .mockReturnValueOnce(forcedInvitations.promise);
    const wrapper = ({ children }: PropsWithChildren) => <GroupsProvider>{children}</GroupsProvider>;
    const view = await renderHook(() => useGroups(), { wrapper });
    await waitFor(() => expect(view.result.current.state.data).toHaveLength(1));
    await act(() => view.result.current.refresh());

    let olderRefresh!: Promise<void>;
    let firstAccept!: Promise<void>;
    let secondAccept!: Promise<void>;
    await act(async () => {
      olderRefresh = view.result.current.refresh();
      firstAccept = view.result.current.acceptInvitation(receivedInvitation.id);
      secondAccept = view.result.current.acceptInvitation(receivedInvitation.id);
      await Promise.resolve();
    });
    expect(firstAccept).toBe(secondAccept);
    expect(githubGateway.acceptGroupInvitation).toHaveBeenCalledTimes(1);

    await act(async () => {
      oldGroups.resolve({ groups: [descriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
      oldInvitations.resolve({ invitations: [receivedInvitation], warnings: [] });
      await Promise.resolve();
    });
    await waitFor(() => expect(githubGateway.listGroupInvitations).toHaveBeenCalledTimes(3));
    expect(view.result.current.invitationState.data).toEqual([]);

    await act(async () => {
      forcedGroups.resolve({ groups: [descriptor, acceptedDescriptor], warnings: [], installationCount: 1, hasAllRepositoriesInstallation: true });
      forcedInvitations.resolve({ invitations: [], warnings: [] });
      await Promise.all([olderRefresh, firstAccept, secondAccept]);
    });
    expect(view.result.current.state.data.map((item) => item.repository.id)).toContain(2);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}
