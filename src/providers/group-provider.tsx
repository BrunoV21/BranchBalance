import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, DomainValidationError, messageForError } from '@/domain/errors';
import { normalizeLogin, type Expense, type ExpenseFile, type GroupKey, type RemoteGroupSnapshot } from '@/domain/types';
import { type ConfirmedExpenseMutation, withExpenses } from '@/features/expenses/snapshot-reconciliation';
import { githubGateway, snapshotStore, systemClock } from '@/infrastructure/runtime';

import { useGroups } from './groups-provider';
import type { ResourceState } from './resource';
import { isTerminalAuthError, useSession } from './session-provider';

type GroupContextValue = {
  state: ResourceState<RemoteGroupSnapshot | null>;
  refresh(): Promise<RemoteGroupSnapshot>;
  invite(login: string): Promise<void>;
  createExpense(expense: Expense): Promise<void>;
  updateExpense(expense: Expense, sha: string): Promise<void>;
  deleteExpense(expense: Expense, sha: string): Promise<void>;
};
const GroupContext = createContext<GroupContextValue | null>(null);

export function GroupProvider({ owner, repo, children }: PropsWithChildren<{ owner: string; repo: string }>) {
  const { session, expire } = useSession();
  const { state: groupsState, applyGroupSnapshot, recordConfirmedExpenseMutation, reconcileRemoteGroupSnapshot, removeGroup } = useGroups();
  const account = session.account;
  const key = `${owner.toLowerCase()}/${repo.toLowerCase()}` as GroupKey;
  const descriptor = groupsState.data.find((group) => group.key === key);
  const descriptorRef = useRef(descriptor);
  const [state, setState] = useState<ResourceState<RemoteGroupSnapshot | null>>({ data: null, status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null });
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
    void snapshotStore.readGroup(account.id, key).then((snapshot) => {
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
        replaceState({ data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null });
        await applyGroupSnapshot(snapshot);
        return snapshot;
      } catch (error) {
        if (isTerminalAuthError(error)) await expire(error.detail.reason === 'missing' ? 'revoked' : error.detail.reason);
        if (error instanceof AppFailure && (error.detail.kind === 'not_found' || error.detail.kind === 'permission')) await removeGroup(key);
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
    const snapshot = withExpenses(current, files, systemClock.now().toISOString());
    const nextState = { data: snapshot, status: 'ready' as const, isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null };
    snapshotRevision.current += 1;
    replaceState(nextState);
    try { await applyGroupSnapshot(snapshot); }
    catch {
      patchState((value) => ({ ...value, error: 'Expense saved, but the offline cache could not be updated.' }));
    }
  }, [applyGroupSnapshot, key, patchState, recordConfirmedExpenseMutation, replaceState]);

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

  const createExpense = useCallback(async (expense: Expense) => {
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

  const updateExpense = useCallback(async (expense: Expense, sha: string) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before editing an expense.');
    const file = await githubGateway.updateExpense(current.repository, expense, sha);
    await commitExpenseMutation({ kind: 'upsert', file });
  }, [commitExpenseMutation]);

  const deleteExpense = useCallback(async (expense: Expense, sha: string) => {
    const current = stateRef.current.data;
    if (!current) throw new DomainValidationError('Refresh the group before deleting an expense.');
    await githubGateway.deleteExpense(current.repository, expense, sha);
    await commitExpenseMutation({ kind: 'delete', expenseId: expense.id });
  }, [commitExpenseMutation]);

  const value = useMemo(() => ({ state, refresh, invite, createExpense, updateExpense, deleteExpense }), [createExpense, deleteExpense, invite, refresh, state, updateExpense]);
  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useGroup() {
  const value = useContext(GroupContext);
  if (!value) throw new Error('useGroup must be used inside GroupProvider.');
  return value;
}
