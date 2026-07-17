import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, DomainValidationError, messageForError } from '@/domain/errors';
import { groupKey, type CurrencyCode, type DiscoveredGroup, type PendingGroupCreation, type RemoteGroupSnapshot } from '@/domain/types';
import { githubGateway, snapshotStore, systemClock } from '@/infrastructure/runtime';
import { type ConfirmedExpenseMutation, reconcileConfirmedExpenseMutations } from '@/features/expenses/snapshot-reconciliation';
import { calculateGroupAggregates, type GroupAggregate } from '@/features/groups/summaries';
import { createGroupRepository } from '@/features/groups/create-group';

import { isTerminalAuthError, useSession } from './session-provider';
import type { ResourceState } from './resource';

type GroupsContextValue = {
  state: ResourceState<DiscoveredGroup[]>;
  aggregates: GroupAggregate[];
  hasInstallation: boolean;
  canCreateGroups: boolean;
  pendingCreation: PendingGroupCreation | null;
  refresh(): Promise<DiscoveredGroup[]>;
  createGroup(name: string, currency: CurrencyCode): Promise<DiscoveredGroup>;
  retryPendingCreation(): Promise<DiscoveredGroup>;
  applyGroupSnapshot(snapshot: RemoteGroupSnapshot): Promise<void>;
  recordConfirmedExpenseMutation(key: string, mutation: ConfirmedExpenseMutation): void;
  reconcileRemoteGroupSnapshot(snapshot: RemoteGroupSnapshot): RemoteGroupSnapshot;
  removeGroup(key: string): Promise<void>;
};

const initial: ResourceState<DiscoveredGroup[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
const GroupsContext = createContext<GroupsContextValue | null>(null);

export function GroupsProvider({ children }: PropsWithChildren) {
  const { session, expire } = useSession();
  const account = session.account;
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const [hasInstallation, setHasInstallation] = useState(false);
  const [canCreateGroups, setCanCreateGroups] = useState(false);
  const [pendingCreation, setPendingCreation] = useState<PendingGroupCreation | null>(null);
  const inFlight = useRef<Promise<DiscoveredGroup[]> | null>(null);
  const confirmedMutations = useRef(new Map<string, Map<string, ConfirmedExpenseMutation>>());

  const replaceState = useCallback((next: ResourceState<DiscoveredGroup[]>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patchState = useCallback((update: (current: ResourceState<DiscoveredGroup[]>) => ResourceState<DiscoveredGroup[]>) => {
    replaceState(update(stateRef.current));
  }, [replaceState]);

  useEffect(() => {
    if (!account) {
      queueMicrotask(() => { confirmedMutations.current.clear(); replaceState(initial); setPendingCreation(null); });
      return;
    }
    let active = true;
    void Promise.all([snapshotStore.readGroups(account.id), snapshotStore.readPendingGroup(account.id)]).then(([groups, pending]) => {
      if (!active) return;
      if (groups && !stateRef.current.data.length) replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null });
      setPendingCreation(pending);
    });
    return () => { active = false; };
  }, [account, replaceState]);

  const refresh = useCallback((): Promise<DiscoveredGroup[]> => {
    if (!account) return Promise.resolve([]);
    if (inFlight.current) return inFlight.current;
    patchState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true, error: null }));
    const operation = (async () => {
      try {
        const result = await githubGateway.discoverGroups();
        setHasInstallation(result.installationCount > 0);
        setCanCreateGroups(result.hasAllRepositoriesInstallation);
        const cachedByKey = new Map(stateRef.current.data.map((item) => [item.key, item]));
        const groups = result.groups.map((group) => ({ ...group, summary: cachedByKey.get(group.key)?.summary ?? null }));
        const now = systemClock.now().toISOString();
        replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: now, error: result.warnings.length ? `${result.warnings.length} candidate repositories were skipped.` : null });
        await snapshotStore.writeGroups(account.id, groups);
        return groups;
      } catch (error) {
        if (isTerminalAuthError(error)) await expire(error.detail.reason === 'missing' ? 'revoked' : error.detail.reason);
        const message = error instanceof AppFailure ? messageForError(error.detail) : 'Unable to refresh groups.';
        patchState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: message }));
        throw error;
      } finally { inFlight.current = null; }
    })();
    inFlight.current = operation;
    return operation;
  }, [account, expire, patchState, replaceState]);

  const applyGroupSnapshot = useCallback(async (snapshot: RemoteGroupSnapshot) => {
    if (!account) return;
    const currentBalance = snapshot.balances.members.find((member) => member.login.toLowerCase() === account.login.toLowerCase())?.netMinor ?? 0;
    const descriptor: DiscoveredGroup = {
      key: snapshot.key, repository: snapshot.repository, group: snapshot.group,
      summary: { currency: snapshot.group.currency, currentUserBalanceMinor: currentBalance, memberCount: snapshot.members.length, expenseCount: snapshot.expenses.length, syncedAt: snapshot.syncedAt },
    };
    const groups = [...stateRef.current.data.filter((group) => group.key !== snapshot.key), descriptor].sort((a, b) => a.group.name.localeCompare(b.group.name));
    patchState((value) => ({ ...value, data: groups, status: 'ready' }));
    await Promise.all([snapshotStore.writeGroup(account.id, snapshot.key, snapshot), snapshotStore.writeGroups(account.id, groups)]);
  }, [account, patchState]);

  const recordConfirmedExpenseMutation = useCallback((key: string, mutation: ConfirmedExpenseMutation) => {
    const expenseId = mutation.kind === 'upsert' ? mutation.file.expense.id : mutation.expenseId;
    const mutations = confirmedMutations.current.get(key) ?? new Map<string, ConfirmedExpenseMutation>();
    mutations.set(expenseId, mutation);
    confirmedMutations.current.set(key, mutations);
  }, []);

  const reconcileRemoteGroupSnapshot = useCallback((snapshot: RemoteGroupSnapshot) => {
    const mutations = confirmedMutations.current.get(snapshot.key);
    if (!mutations) return snapshot;
    const reconciled = reconcileConfirmedExpenseMutations(snapshot, mutations);
    if (!mutations.size) confirmedMutations.current.delete(snapshot.key);
    return reconciled;
  }, []);

  const createGroup = useCallback(async (name: string, currency: CurrencyCode) => {
    if (!account) throw new DomainValidationError('Sign in to create a group.');
    try {
      const descriptor = await createGroupRepository({ gateway: githubGateway, store: snapshotStore, accountId: account.id, login: account.login, name, currency, canCreate: canCreateGroups, clock: systemClock });
      const groups = [...stateRef.current.data, descriptor].sort((a, b) => a.group.name.localeCompare(b.group.name));
      patchState((value) => ({ ...value, data: groups, status: 'ready' }));
      await snapshotStore.writeGroups(account.id, groups);
      return descriptor;
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'partial_group_creation') setPendingCreation(await snapshotStore.readPendingGroup(account.id));
      if (error instanceof AppFailure && error.detail.kind === 'github' && error.detail.status === 0) await refresh().catch(() => undefined);
      throw error;
    }
  }, [account, canCreateGroups, patchState, refresh]);

  const retryPendingCreation = useCallback(async () => {
    if (!account || !pendingCreation) throw new DomainValidationError('There is no group setup to retry.');
    await githubGateway.createGroupFile(pendingCreation.repository, pendingCreation.group);
    const descriptor = { key: groupKey(pendingCreation.repository.owner, pendingCreation.repository.name), repository: pendingCreation.repository, group: pendingCreation.group, summary: null } satisfies DiscoveredGroup;
    const groups = [...stateRef.current.data.filter((item) => item.key !== descriptor.key), descriptor].sort((a, b) => a.group.name.localeCompare(b.group.name));
    await snapshotStore.writePendingGroup(account.id, null);
    await snapshotStore.writeGroups(account.id, groups);
    setPendingCreation(null);
    patchState((value) => ({ ...value, data: groups, status: 'ready' }));
    return descriptor;
  }, [account, patchState, pendingCreation]);

  const removeGroup = useCallback(async (key: string) => {
    if (!account) return;
    confirmedMutations.current.delete(key);
    const groups = stateRef.current.data.filter((group) => group.key !== key);
    patchState((value) => ({ ...value, data: groups }));
    await snapshotStore.writeGroups(account.id, groups);
    await snapshotStore.removeGroup(account.id, key as `${string}/${string}`);
  }, [account, patchState]);

  const aggregates = useMemo(() => calculateGroupAggregates(state.data), [state.data]);

  const value = useMemo<GroupsContextValue>(() => ({ state, aggregates, hasInstallation, canCreateGroups, pendingCreation, refresh, createGroup, retryPendingCreation, applyGroupSnapshot, recordConfirmedExpenseMutation, reconcileRemoteGroupSnapshot, removeGroup }), [aggregates, applyGroupSnapshot, canCreateGroups, createGroup, hasInstallation, pendingCreation, reconcileRemoteGroupSnapshot, recordConfirmedExpenseMutation, refresh, removeGroup, retryPendingCreation, state]);
  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const value = useContext(GroupsContext);
  if (!value) throw new Error('useGroups must be used inside GroupsProvider.');
  return value;
}
