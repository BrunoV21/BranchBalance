import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, DomainValidationError, messageForError } from '@/domain/errors';
import { normalizeLogin, type ExpenseFile, type GroupFile, type GroupKey, type RemoteGroupSnapshot, type SpendingPlan, type WritableExpense } from '@/domain/types';
import { hydrateCachedSnapshot, type ConfirmedExpenseMutation, withExpenses, withGroupFile } from '@/features/expenses/snapshot-reconciliation';
import { githubGateway, snapshotStore, systemClock, systemLocalCalendar } from '@/infrastructure/runtime';

import { useGroups } from './groups-provider';
import type { ResourceState } from './resource';
import { isTerminalAuthError, useSession } from './session-provider';

type GroupContextValue = {
  state: ResourceState<RemoteGroupSnapshot | null>;
  accessLost: boolean;
  refresh(): Promise<RemoteGroupSnapshot>;
  invite(login: string): Promise<void>;
  createExpense(expense: WritableExpense): Promise<void>;
  updateExpense(expense: WritableExpense, current: ExpenseFile): Promise<void>;
  deleteExpense(current: ExpenseFile): Promise<void>;
  updateSpendingPlan(plan: SpendingPlan, current?: GroupFile): Promise<void>;
  removeSpendingPlan(current?: GroupFile): Promise<void>;
  acceptSpendingPlanFile(file: GroupFile): Promise<void>;
};
const GroupContext = createContext<GroupContextValue | null>(null);

export function GroupProvider({ owner, repo, children }: PropsWithChildren<{ owner: string; repo: string }>) {
  const { session, expire } = useSession();
  const { state: groupsState, applyGroupSnapshot, recordConfirmedExpenseMutation, recordConfirmedSpendingPlanMutation, reconcileRemoteGroupSnapshot, removeGroup } = useGroups();
  const account = session.account;
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}` as GroupKey;
  const descriptor = groupsState.data.find((group) => group.key === key);
  const descriptorRef = useRef(descriptor);
  const [state, setState] = useState<ResourceState<RemoteGroupSnapshot | null>>({ data: null, status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null });
  const [accessLost, setAccessLost] = useState(false);
  const stateRef = useRef(state);
  const inFlight = useRef<Promise<RemoteGroupSnapshot> | null>(null);
  const snapshotRevision = useRef(0);
  useEffect(() => { descriptorRef.current = descriptor; }, [descriptor]);

  const replaceState = useCallback((next: ResourceState<RemoteGroupSnapshot | null>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patchState = useCallback((update: (current: ResourceState<RemoteGroupSnapshot | null>) => ResourceState<RemoteGroupSnapshot | null>) => {
    replaceState(update(stateRef.current));
  }, [replaceState]);

  useEffect(() => {
    if (!account) return;
    let active = true;
    const startedAtRevision = snapshotRevision.current;
    void snapshotStore.readGroup(account.id, key).then(async (cached) => {
      let snapshot: RemoteGroupSnapshot | null = null;
      try { snapshot = cached ? hydrateCachedSnapshot(cached, account.login, systemLocalCalendar.today()) : null; }
      catch { await snapshotStore.removeGroup(account.id, key); }
      if (!active || !snapshot || snapshotRevision.current !== startedAtRevision || stateRef.current.data) return;
      snapshotRevision.current += 1;
      replaceState({ data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null });
    });
    return () => { active = false; };
  }, [account, key, replaceState]);

  const refresh = useCallback((): Promise<RemoteGroupSnapshot> => {
    if (inFlight.current) return inFlight.current;
    const currentDescriptor = descriptorRef.current;
    if (!currentDescriptor || !account) return Promise.reject(new DomainValidationError('This group is not available.'));
    patchState((value) => ({ ...value, status: value.data ? 'ready' : 'loading', isRefreshing: true, error: null }));
    const operation = (async () => {
      try {
        const snapshot = reconcileRemoteGroupSnapshot(await githubGateway.refreshGroup(currentDescriptor.repository, account.login));
        snapshotRevision.current += 1;
        setAccessLost(false);
        replaceState({ data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null });
        await applyGroupSnapshot(snapshot);
        return snapshot;
      } catch (error) {
        if (isTerminalAuthError(error)) await expire(error.detail.reason === 'missing' ? 'revoked' : error.detail.reason);
        if (error instanceof AppFailure && (error.detail.kind === 'not_found' || error.detail.kind === 'permission')) {
          snapshotRevision.current += 1;
          setAccessLost(true);
          replaceState({ data: null, status: 'error', isRefreshing: false, lastSuccessfulAt: null, error: 'This group is no longer available through the current GitHub App access.' });
          await removeGroup(key);
          throw error;
        }
        const message = error instanceof AppFailure ? messageForError(error.detail) : error instanceof Error ? error.message : 'Unable to refresh this group.';
        patchState((value) => ({ ...value, status: value.data ? 'ready' : 'error', isRefreshing: false, error: message }));
        throw error;
      } finally { inFlight.current = null; }
    })();
    inFlight.current = operation;
    return operation;
  }, [account, applyGroupSnapshot, expire, key, patchState, reconcileRemoteGroupSnapshot, removeGroup, replaceState]);

  const commitExpenseMutation = useCallback(async (mutation: ConfirmedExpenseMutation) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before changing expenses.');
    const expenseId = mutation.kind === 'upsert' ? mutation.file.expense.id : mutation.expenseId;
    recordConfirmedExpenseMutation(key, mutation);
    const files = mutation.kind === 'upsert'
      ? [...current.expenses.filter((item) => item.expense.id !== expenseId), mutation.file]
      : current.expenses.filter((item) => item.expense.id !== expenseId);
    const snapshot = withExpenses(current, files, account!.login, systemLocalCalendar.today(), systemClock.now().toISOString());
    const nextState = { data: snapshot, status: 'ready' as const, isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null };
    snapshotRevision.current += 1;
    replaceState(nextState);
    try { await applyGroupSnapshot(snapshot); }
    catch {
      patchState((value) => ({ ...value, error: 'Expense saved, but the offline cache could not be updated.' }));
    }
  }, [account, applyGroupSnapshot, key, patchState, recordConfirmedExpenseMutation, replaceState]);

  const invite = useCallback(async (login: string) => {
    const normalized = normalizeLogin(login);
    let snapshot = await refresh();
    if (normalized === snapshot.repository.owner.toLowerCase()) throw new DomainValidationError('The repository owner is already a member.', 'login');
    if (snapshot.members.some((member) => member.login.toLowerCase() === normalized)) throw new DomainValidationError('This GitHub user is already a member.', 'login');
    if (snapshot.pendingMembers?.some((member) => member.login.toLowerCase() === normalized)) throw new DomainValidationError('This GitHub user already has a pending invitation.', 'login');
    if (!snapshot.repository.canAdmin) throw new DomainValidationError('Only the repository owner can invite members.');
    await githubGateway.inviteMember(snapshot.repository, normalized);
    snapshot = await refresh();
    patchState((value) => ({ ...value, data: snapshot }));
  }, [patchState, refresh]);

  const createExpense = useCallback(async (expense: WritableExpense) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before adding an expense.');
    let file: ExpenseFile;
    try { file = await githubGateway.createExpense(current.repository, expense); }
    catch (error) {
      if (!(error instanceof AppFailure) || !('retryable' in error.detail && error.detail.retryable)) throw error;
      const remote = await githubGateway.readExpense(current.repository, expense.id);
      if (!remote) throw error;
      if (JSON.stringify(remote.expense) !== JSON.stringify(expense)) throw new AppFailure({ kind: 'expense_conflict', latest: remote, operation: 'edit' });
      file = remote;
    }
    await commitExpenseMutation({ kind: 'upsert', file });
  }, [commitExpenseMutation]);

  const updateExpense = useCallback(async (expense: WritableExpense, target: ExpenseFile) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before editing an expense.');
    const file = await githubGateway.updateExpense(current.repository, target, expense);
    await commitExpenseMutation({ kind: 'upsert', file });
  }, [commitExpenseMutation]);

  const deleteExpense = useCallback(async (target: ExpenseFile) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before deleting an expense.');
    await githubGateway.deleteExpense(current.repository, target);
    await commitExpenseMutation({ kind: 'delete', expenseId: target.expense.id });
  }, [commitExpenseMutation]);

  const commitSpendingPlanMutation = useCallback(async (groupFile: GroupFile) => {
    const current = stateRef.current.data;
    if (!current || !account) throw new DomainValidationError('Refresh the group before changing its spending plan.');
    recordConfirmedSpendingPlanMutation(key, groupFile);
    const snapshot = withGroupFile(current, groupFile, account.login, systemLocalCalendar.today(), systemClock.now().toISOString());
    snapshotRevision.current += 1;
    replaceState({ data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null });
    try { await applyGroupSnapshot(snapshot); }
    catch { patchState((value) => ({ ...value, error: 'Spending plan saved, but the offline cache could not be updated.' })); }
  }, [account, applyGroupSnapshot, key, patchState, recordConfirmedSpendingPlanMutation, replaceState]);

  const updateSpendingPlan = useCallback(async (plan: SpendingPlan, target?: GroupFile) => {
    const current = stateRef.current.data;
    const groupFile = target ?? current?.groupFile;
    if (!current || !groupFile) throw new DomainValidationError('Refresh the group before changing its spending plan.');
    if (!current.repository.canWrite) throw new DomainValidationError('Your GitHub account cannot update this spending plan.');
    await commitSpendingPlanMutation(await githubGateway.updateSpendingPlan(current.repository, groupFile, plan));
  }, [commitSpendingPlanMutation]);

  const removeSpendingPlan = useCallback(async (target?: GroupFile) => {
    const current = stateRef.current.data;
    const groupFile = target ?? current?.groupFile;
    if (!current || !groupFile) throw new DomainValidationError('Refresh the group before changing its spending plan.');
    if (!current.repository.canWrite) throw new DomainValidationError('Your GitHub account cannot update this spending plan.');
    await commitSpendingPlanMutation(await githubGateway.updateSpendingPlan(current.repository, groupFile, null));
  }, [commitSpendingPlanMutation]);

  const acceptSpendingPlanFile = useCallback(async (groupFile: GroupFile) => {
    const current = stateRef.current.data;
    if (!current || !account) throw new DomainValidationError('Refresh the group before reviewing its spending plan.');
    const snapshot = withGroupFile(current, groupFile, account.login, systemLocalCalendar.today(), systemClock.now().toISOString());
    snapshotRevision.current += 1;
    replaceState({ data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null });
    await applyGroupSnapshot(snapshot);
  }, [account, applyGroupSnapshot, replaceState]);

  const value = useMemo(() => ({ state, accessLost, refresh, invite, createExpense, updateExpense, deleteExpense, updateSpendingPlan, removeSpendingPlan, acceptSpendingPlanFile }), [acceptSpendingPlanFile, accessLost, createExpense, deleteExpense, invite, refresh, removeSpendingPlan, state, updateExpense, updateSpendingPlan]);
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup() {
  const value = useContext(GroupContext);
  if (!value) throw new Error('useGroup must be used inside GroupProvider.');
  return value;
}
