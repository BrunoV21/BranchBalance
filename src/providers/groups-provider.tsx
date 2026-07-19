import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, DomainValidationError, messageForError } from '@/domain/errors';
import { groupKey, type AcceptedInvitationPendingDiscovery, type ConfirmedInvitationDecision, type CurrencyCode, type DiscoveredGroup, type GroupFile, type PendingGroupCreation, type PendingGroupInvitation, type RemoteGroupSnapshot, type SettlementLedgerState } from '@/domain/types';
import { githubGateway, snapshotStore, systemClock, systemLocalCalendar } from '@/infrastructure/runtime';
import { type ConfirmedExpenseMutation, reconcileConfirmedExpenseMutations, withGroupFile } from '@/features/expenses/snapshot-reconciliation';
import { calculateGroupAggregates, type GroupAggregate } from '@/features/groups/summaries';
import { createGroupRepository } from '@/features/groups/create-group';
import { reconcileInvitationDecision } from '@/features/invitations/reconciliation';
import { withSettlementLedger } from '@/features/settlements/snapshot-reconciliation';

import { isTerminalAuthError, useSession } from './session-provider';
import type { ResourceState } from './resource';

type GroupsContextValue = {
  state: ResourceState<DiscoveredGroup[]>;
  groupWarningCount: number;
  aggregates: GroupAggregate[];
  hasInstallation: boolean;
  canCreateGroups: boolean;
  pendingCreation: PendingGroupCreation | null;
  invitationState: ResourceState<PendingGroupInvitation[]>;
  invitationWarningCount: number;
  invitationMutations: ReadonlyMap<number, 'accepting' | 'declining'>;
  acceptedPendingDiscovery: readonly AcceptedInvitationPendingDiscovery[];
  invitationNotice: string | null;
  refresh(): Promise<void>;
  acceptInvitation(invitationId: number): Promise<void>;
  declineInvitation(invitationId: number): Promise<void>;
  createGroup(name: string, currency: CurrencyCode): Promise<DiscoveredGroup>;
  retryPendingCreation(): Promise<DiscoveredGroup>;
  applyGroupSnapshot(snapshot: RemoteGroupSnapshot): Promise<void>;
  recordConfirmedExpenseMutation(key: string, mutation: ConfirmedExpenseMutation): void;
  recordConfirmedSpendingPlanMutation(key: string, file: GroupFile): void;
  recordConfirmedSettlementMutation(key: string, ledger: SettlementLedgerState): void;
  reconcileRemoteGroupSnapshot(snapshot: RemoteGroupSnapshot): RemoteGroupSnapshot;
  removeGroup(key: string): Promise<void>;
};

const initial: ResourceState<DiscoveredGroup[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
const initialInvitations: ResourceState<PendingGroupInvitation[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
type DashboardRefreshResult = {
  groups: DiscoveredGroup[] | null;
  invitations: PendingGroupInvitation[] | null;
};
type InvitationDecisionBarrier = ConfirmedInvitationDecision & { confirmedAfterGeneration: number };
const GroupsContext = createContext<GroupsContextValue | null>(null);

export function GroupsProvider({ children }: PropsWithChildren) {
  const { session, expire } = useSession();
  const account = session.account;
  const [state, setState] = useState(initial);
  const stateRef = useRef(state);
  const [groupWarningCount, setGroupWarningCount] = useState(0);
  const [invitationState, setInvitationState] = useState(initialInvitations);
  const invitationStateRef = useRef(invitationState);
  const [invitationWarningCount, setInvitationWarningCount] = useState(0);
  const [invitationMutations, setInvitationMutations] = useState<ReadonlyMap<number, 'accepting' | 'declining'>>(new Map());
  const [acceptedPendingDiscovery, setAcceptedPendingDiscovery] = useState<readonly AcceptedInvitationPendingDiscovery[]>([]);
  const acceptedPendingDiscoveryRef = useRef<readonly AcceptedInvitationPendingDiscovery[]>([]);
  const [invitationNotice, setInvitationNotice] = useState<string | null>(null);
  const [hasInstallation, setHasInstallation] = useState(false);
  const [canCreateGroups, setCanCreateGroups] = useState(false);
  const [pendingCreation, setPendingCreation] = useState<PendingGroupCreation | null>(null);
  const dashboardInFlight = useRef<Promise<DashboardRefreshResult> | null>(null);
  const dashboardGeneration = useRef(0);
  const appliedGroupGeneration = useRef(0);
  const appliedInvitationGeneration = useRef(0);
  const invitationMutationPromises = useRef(new Map<number, Promise<void>>());
  const confirmedInvitationDecisions = useRef(new Map<number, InvitationDecisionBarrier>());
  const activeAccountIdRef = useRef<number | null>(account?.id ?? null);
  const accountEpochRef = useRef(0);
  const confirmedMutations = useRef(new Map<string, Map<string, ConfirmedExpenseMutation>>());
  const confirmedSpendingPlans = useRef(new Map<string, GroupFile>());
  const confirmedSettlementLedgers = useRef(new Map<string, SettlementLedgerState>());

  const replaceState = useCallback((next: ResourceState<DiscoveredGroup[]>) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const patchState = useCallback((update: (current: ResourceState<DiscoveredGroup[]>) => ResourceState<DiscoveredGroup[]>) => {
    replaceState(update(stateRef.current));
  }, [replaceState]);

  const replaceInvitationState = useCallback((next: ResourceState<PendingGroupInvitation[]>) => {
    invitationStateRef.current = next;
    setInvitationState(next);
  }, []);

  const patchInvitationState = useCallback((update: (current: ResourceState<PendingGroupInvitation[]>) => ResourceState<PendingGroupInvitation[]>) => {
    replaceInvitationState(update(invitationStateRef.current));
  }, [replaceInvitationState]);

  const replaceAcceptedPendingDiscovery = useCallback((next: readonly AcceptedInvitationPendingDiscovery[]) => {
    acceptedPendingDiscoveryRef.current = next;
    setAcceptedPendingDiscovery(next);
  }, []);

  useEffect(() => {
    activeAccountIdRef.current = account?.id ?? null;
    accountEpochRef.current += 1;
    dashboardInFlight.current = null;
    dashboardGeneration.current = 0;
    appliedGroupGeneration.current = 0;
    appliedInvitationGeneration.current = 0;
    invitationMutationPromises.current.clear();
    confirmedInvitationDecisions.current.clear();
    confirmedMutations.current.clear();
    confirmedSpendingPlans.current.clear();
    confirmedSettlementLedgers.current.clear();
    queueMicrotask(() => {
      replaceState(initial);
      replaceInvitationState(initialInvitations);
      replaceAcceptedPendingDiscovery([]);
      setGroupWarningCount(0);
      setInvitationWarningCount(0);
      setInvitationMutations(new Map());
      setInvitationNotice(null);
      setHasInstallation(false);
      setCanCreateGroups(false);
      setPendingCreation(null);
    });
    if (!account) {
      return;
    }
    let active = true;
    void Promise.all([snapshotStore.readGroups(account.id), snapshotStore.readPendingGroup(account.id)]).then(([groups, pending]) => {
      if (!active || activeAccountIdRef.current !== account.id) return;
      if (groups && !stateRef.current.data.length) replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null });
      setPendingCreation(pending);
    });
    return () => { active = false; };
  }, [account, replaceAcceptedPendingDiscovery, replaceInvitationState, replaceState]);

  const startDashboardRefresh = useCallback((): Promise<DashboardRefreshResult> => {
    if (!account) return Promise.resolve({ groups: null, invitations: null });
    if (dashboardInFlight.current) return dashboardInFlight.current;
    const accountId = account.id;
    const accountEpoch = accountEpochRef.current;
    const generation = ++dashboardGeneration.current;
    patchState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true, error: null }));
    patchInvitationState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true }));
    setInvitationNotice(null);

    let operation!: Promise<DashboardRefreshResult>;
    operation = (async () => {
      try {
        const [groupResult, invitationResult] = await Promise.allSettled([
          githubGateway.discoverGroups(),
          githubGateway.listGroupInvitations(account.login),
        ]);
        if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };

        const terminalError = [groupResult, invitationResult].find((result) => result.status === 'rejected' && isTerminalAuthError(result.reason));
        if (terminalError?.status === 'rejected' && isTerminalAuthError(terminalError.reason)) {
          activeAccountIdRef.current = null;
          accountEpochRef.current += 1;
          replaceState(initial);
          replaceInvitationState(initialInvitations);
          replaceAcceptedPendingDiscovery([]);
          confirmedInvitationDecisions.current.clear();
          setInvitationMutations(new Map());
          await expire(terminalError.reason.detail.reason === 'missing' ? 'revoked' : terminalError.reason.detail.reason);
          return { groups: null, invitations: null };
        }

        let groups: DiscoveredGroup[] | null = null;
        if (groupResult.status === 'fulfilled' && generation >= appliedGroupGeneration.current) {
          appliedGroupGeneration.current = generation;
          setHasInstallation(groupResult.value.installationCount > 0);
          setCanCreateGroups(groupResult.value.hasAllRepositoriesInstallation);
          const cachedByKey = new Map(stateRef.current.data.map((item) => [item.key, item]));
          groups = groupResult.value.groups.map((group) => ({ ...group, summary: cachedByKey.get(group.key)?.summary ?? null }));
          const now = systemClock.now().toISOString();
          replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: now, error: null });
          setGroupWarningCount(groupResult.value.warnings.length);
          const repositoryIds = new Set(groups.map((group) => group.repository.id));
          replaceAcceptedPendingDiscovery(acceptedPendingDiscoveryRef.current.filter((item) => !repositoryIds.has(item.repositoryId)));
          try {
            await snapshotStore.writeGroups(accountId, groups);
          } catch {
            patchState((value) => ({ ...value, error: 'Groups loaded, but the offline cache could not be updated.' }));
          }
        } else if (groupResult.status === 'rejected') {
          const message = groupResult.reason instanceof AppFailure ? messageForError(groupResult.reason.detail) : 'Unable to refresh groups.';
          patchState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: message }));
        }

        let invitations: PendingGroupInvitation[] | null = null;
        if (invitationResult.status === 'fulfilled' && generation >= appliedInvitationGeneration.current) {
          appliedInvitationGeneration.current = generation;
          invitations = invitationResult.value.invitations;
          const { visible, hasDeclineConflict } = filterConfirmedInvitationDecisions(invitations, confirmedInvitationDecisions.current, generation);
          replaceInvitationState({
            data: visible,
            status: 'ready',
            isRefreshing: false,
            lastSuccessfulAt: systemClock.now().toISOString(),
            error: hasDeclineConflict ? 'GitHub still reports a declined invitation as open. Refresh before trying again.' : null,
          });
          setInvitationWarningCount(invitationResult.value.warnings.length);
        } else if (invitationResult.status === 'rejected') {
          const message = invitationResult.reason instanceof AppFailure ? messageForError(invitationResult.reason.detail) : 'Unable to refresh group invitations.';
          patchInvitationState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: message }));
        }
        return { groups, invitations };
      } finally {
        if (dashboardInFlight.current === operation) dashboardInFlight.current = null;
      }
    })();
    dashboardInFlight.current = operation;
    return operation;
  }, [account, expire, patchInvitationState, patchState, replaceAcceptedPendingDiscovery, replaceInvitationState, replaceState]);

  const startInvitationRefresh = useCallback((): Promise<DashboardRefreshResult> => {
    if (!account) return Promise.resolve({ groups: null, invitations: null });
    if (dashboardInFlight.current) return dashboardInFlight.current;
    const accountId = account.id;
    const accountEpoch = accountEpochRef.current;
    const generation = ++dashboardGeneration.current;
    patchInvitationState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true }));
    setInvitationNotice(null);

    let operation!: Promise<DashboardRefreshResult>;
    operation = (async () => {
      try {
        try {
          const result = await githubGateway.listGroupInvitations(account.login);
          if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };
          appliedInvitationGeneration.current = generation;
          const { visible, hasDeclineConflict } = filterConfirmedInvitationDecisions(result.invitations, confirmedInvitationDecisions.current, generation);
          replaceInvitationState({
            data: visible,
            status: 'ready',
            isRefreshing: false,
            lastSuccessfulAt: systemClock.now().toISOString(),
            error: hasDeclineConflict ? 'GitHub still reports a declined invitation as open. Refresh before trying again.' : null,
          });
          setInvitationWarningCount(result.warnings.length);
          return { groups: null, invitations: result.invitations };
        } catch (error) {
          if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };
          if (isTerminalAuthError(error)) {
            activeAccountIdRef.current = null;
            accountEpochRef.current += 1;
            replaceState(initial);
            replaceInvitationState(initialInvitations);
            replaceAcceptedPendingDiscovery([]);
            confirmedInvitationDecisions.current.clear();
            setInvitationMutations(new Map());
            await expire(error.detail.reason === 'missing' ? 'revoked' : error.detail.reason);
            return { groups: null, invitations: null };
          }
          const message = error instanceof AppFailure ? messageForError(error.detail) : 'Unable to refresh group invitations.';
          patchInvitationState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: message }));
          return { groups: null, invitations: null };
        }
      } finally {
        if (dashboardInFlight.current === operation) dashboardInFlight.current = null;
      }
    })();
    dashboardInFlight.current = operation;
    return operation;
  }, [account, expire, patchInvitationState, replaceAcceptedPendingDiscovery, replaceInvitationState, replaceState]);

  const refresh = useCallback(async (): Promise<void> => {
    await startDashboardRefresh();
  }, [startDashboardRefresh]);

  const refreshAfterInvitationDecision = useCallback(async (): Promise<DashboardRefreshResult> => {
    while (dashboardInFlight.current) await dashboardInFlight.current.catch(() => ({ groups: null, invitations: null }));
    return startDashboardRefresh();
  }, [startDashboardRefresh]);

  const refreshInvitationsAfterDecision = useCallback(async (): Promise<DashboardRefreshResult> => {
    while (dashboardInFlight.current) await dashboardInFlight.current.catch(() => ({ groups: null, invitations: null }));
    return startInvitationRefresh();
  }, [startInvitationRefresh]);

  const performInvitationDecision = useCallback((invitationId: number, action: 'accept' | 'decline'): Promise<void> => {
    const existingOperation = invitationMutationPromises.current.get(invitationId);
    if (existingOperation) return existingOperation;
    const invitation = invitationStateRef.current.data.find((candidate) => candidate.id === invitationId);
    if (!invitation || invitationStateRef.current.status !== 'ready' || invitationStateRef.current.error) {
      return Promise.reject(new DomainValidationError('Refresh this group invitation before making a decision.'));
    }
    const decisionAccountId = activeAccountIdRef.current;
    const decisionAccountEpoch = accountEpochRef.current;
    const decisionIsActive = () => activeAccountIdRef.current === decisionAccountId && accountEpochRef.current === decisionAccountEpoch;
    setInvitationMutations((current) => new Map(current).set(invitationId, action === 'accept' ? 'accepting' : 'declining'));

    let operation!: Promise<void>;
    operation = (async () => {
      try {
        try {
          if (action === 'accept') await githubGateway.acceptGroupInvitation(invitationId);
          else await githubGateway.declineGroupInvitation(invitationId);
        } catch (error) {
          if (!decisionIsActive()) return;
          if (isTerminalAuthError(error)) {
            activeAccountIdRef.current = null;
            accountEpochRef.current += 1;
            await expire(error.detail.reason === 'missing' ? 'revoked' : error.detail.reason);
            throw error;
          }
          if (!isAmbiguousInvitationDecisionError(error)) {
            setInvitationNotice(error instanceof AppFailure ? messageForError(error.detail) : 'GitHub could not update this group invitation.');
            throw error;
          }

          const reconciledRefresh = action === 'accept' ? await refreshAfterInvitationDecision() : await refreshInvitationsAfterDecision();
          if (!decisionIsActive()) return;
          if (reconciledRefresh.invitations === null) {
            publishUnknownInvitationDecision(invitation, action, patchInvitationState, setInvitationNotice);
          }
          const outcome = reconcileInvitationDecision(
            { invitation, action },
            reconciledRefresh.invitations ?? [],
            action === 'accept' ? reconciledRefresh.groups : stateRef.current.data,
          );
          if (outcome.kind === 'still_open') {
            setInvitationNotice(error instanceof AppFailure ? messageForError(error.detail) : 'GitHub did not complete that invitation decision. You can try again.');
            throw error;
          }
          if (outcome.kind === 'accepted') {
            patchInvitationState((value) => ({ ...value, data: value.data.filter((candidate) => candidate.id !== invitationId), error: null }));
            replaceAcceptedPendingDiscovery(acceptedPendingDiscoveryRef.current.filter((item) => item.repositoryId !== invitation.repository.id));
            setInvitationNotice(`${outcome.group.group.name} was accepted and added to your groups.`);
            return;
          }
          if (outcome.kind === 'resolved_decline') {
            patchInvitationState((value) => ({ ...value, data: value.data.filter((candidate) => candidate.id !== invitationId), error: null }));
            setInvitationNotice(`${invitation.provisionalName} was declined.`);
            return;
          }
          if (outcome.kind === 'unavailable') {
            patchInvitationState((value) => ({ ...value, data: value.data.filter((candidate) => candidate.id !== invitationId), error: null }));
            const unavailable = new AppFailure({ kind: 'invitation_unavailable', invitationId });
            setInvitationNotice(messageForError(unavailable.detail));
            throw unavailable;
          }
          publishUnknownInvitationDecision(invitation, action, patchInvitationState, setInvitationNotice);
        }

        if (!decisionIsActive()) return;

        confirmedInvitationDecisions.current.set(invitationId, {
          invitationId,
          repositoryId: invitation.repository.id,
          action,
          confirmedAt: systemClock.now().toISOString(),
          confirmedAfterGeneration: dashboardGeneration.current,
        });
        patchInvitationState((value) => ({ ...value, data: value.data.filter((candidate) => candidate.id !== invitationId), error: null }));
        setInvitationNotice(`${invitation.provisionalName} was ${action === 'accept' ? 'accepted on GitHub' : 'declined'}.`);

        const confirmedRefresh = action === 'accept' ? await refreshAfterInvitationDecision() : await refreshInvitationsAfterDecision();
        if (!decisionIsActive()) return;
        if (action === 'decline') {
          const remainsOpen = confirmedRefresh.invitations?.some((candidate) => candidate.id === invitationId);
          if (remainsOpen) {
            confirmedInvitationDecisions.current.delete(invitationId);
            patchInvitationState((value) => ({
              ...value,
              data: sortInvitations([...value.data.filter((candidate) => candidate.id !== invitationId), invitation]),
              status: 'ready',
              error: 'GitHub still reports this invitation as open. Refresh before trying again.',
            }));
            setInvitationNotice('GitHub confirmed the decline but still reports the invitation as open. Refresh to reconcile it.');
          } else {
            setInvitationNotice(`${invitation.provisionalName} was declined.`);
          }
          return;
        }

        const acceptedGroup = confirmedRefresh.groups?.find((group) => group.repository.id === invitation.repository.id)
          ?? stateRef.current.data.find((group) => group.repository.id === invitation.repository.id);
        if (acceptedGroup) {
          replaceAcceptedPendingDiscovery(acceptedPendingDiscoveryRef.current.filter((item) => item.repositoryId !== invitation.repository.id));
          setInvitationNotice(`${acceptedGroup.group.name} was accepted and added to your groups.`);
          return;
        }
        const pending: AcceptedInvitationPendingDiscovery = {
          invitationId,
          repositoryId: invitation.repository.id,
          repositoryFullName: invitation.repository.fullName,
          provisionalName: invitation.provisionalName,
          acceptedAt: systemClock.now().toISOString(),
          reason: confirmedRefresh.groups === null ? 'discovery_failed' : 'not_loadable',
        };
        replaceAcceptedPendingDiscovery([
          ...acceptedPendingDiscoveryRef.current.filter((item) => item.repositoryId !== invitation.repository.id),
          pending,
        ]);
        setInvitationNotice(`${invitation.provisionalName} was accepted, but the group is not loadable yet.`);
      } finally {
        if (invitationMutationPromises.current.get(invitationId) === operation) {
          invitationMutationPromises.current.delete(invitationId);
          setInvitationMutations((current) => {
            const next = new Map(current);
            next.delete(invitationId);
            return next;
          });
        }
      }
    })();
    invitationMutationPromises.current.set(invitationId, operation);
    return operation;
  }, [expire, patchInvitationState, refreshAfterInvitationDecision, refreshInvitationsAfterDecision, replaceAcceptedPendingDiscovery]);

  const acceptInvitation = useCallback((invitationId: number) => performInvitationDecision(invitationId, 'accept'), [performInvitationDecision]);
  const declineInvitation = useCallback((invitationId: number) => performInvitationDecision(invitationId, 'decline'), [performInvitationDecision]);

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

  const recordConfirmedSpendingPlanMutation = useCallback((key: string, file: GroupFile) => {
    confirmedSpendingPlans.current.set(key, file);
  }, []);

  const recordConfirmedSettlementMutation = useCallback((key: string, ledger: SettlementLedgerState) => {
    confirmedSettlementLedgers.current.set(key, ledger);
  }, []);

  const reconcileRemoteGroupSnapshot = useCallback((snapshot: RemoteGroupSnapshot) => {
    const mutations = confirmedMutations.current.get(snapshot.key);
    let reconciled = mutations && account ? reconcileConfirmedExpenseMutations(snapshot, mutations, account.login, systemLocalCalendar.today()) : snapshot;
    if (mutations && !mutations.size) confirmedMutations.current.delete(snapshot.key);
    const confirmedPlan = confirmedSpendingPlans.current.get(snapshot.key);
    if (confirmedPlan && account) {
      if (snapshot.groupFile?.blobSha === confirmedPlan.blobSha) confirmedSpendingPlans.current.delete(snapshot.key);
      else reconciled = withGroupFile(reconciled, confirmedPlan, account.login, systemLocalCalendar.today(), reconciled.syncedAt);
    }
    const confirmedLedger = confirmedSettlementLedgers.current.get(snapshot.key);
    if (confirmedLedger && account) {
      const remoteSha = snapshot.settlementLedger?.kind === 'ready' ? snapshot.settlementLedger.file.blobSha : null;
      const confirmedSha = confirmedLedger.kind === 'ready' ? confirmedLedger.file.blobSha : null;
      if (remoteSha === confirmedSha && snapshot.settlementLedger?.kind === confirmedLedger.kind) confirmedSettlementLedgers.current.delete(snapshot.key);
      else reconciled = withSettlementLedger(reconciled, confirmedLedger, reconciled.syncedAt);
    }
    return reconciled;
  }, [account]);

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
    confirmedSpendingPlans.current.delete(key);
    confirmedSettlementLedgers.current.delete(key);
    const groups = stateRef.current.data.filter((group) => group.key !== key);
    patchState((value) => ({ ...value, data: groups }));
    await Promise.all([
      snapshotStore.removeGroup(account.id, key as `${string}/${string}`),
      snapshotStore.writeGroups(account.id, groups),
    ]);
  }, [account, patchState]);

  const aggregates = useMemo(() => calculateGroupAggregates(state.data), [state.data]);

  const value = useMemo<GroupsContextValue>(() => ({
    state,
    groupWarningCount,
    aggregates,
    hasInstallation,
    canCreateGroups,
    pendingCreation,
    invitationState,
    invitationWarningCount,
    invitationMutations,
    acceptedPendingDiscovery,
    invitationNotice,
    refresh,
    acceptInvitation,
    declineInvitation,
    createGroup,
    retryPendingCreation,
    applyGroupSnapshot,
    recordConfirmedExpenseMutation,
    recordConfirmedSpendingPlanMutation,
    recordConfirmedSettlementMutation,
    reconcileRemoteGroupSnapshot,
    removeGroup,
  }), [acceptedPendingDiscovery, acceptInvitation, aggregates, applyGroupSnapshot, canCreateGroups, createGroup, declineInvitation, groupWarningCount, hasInstallation, invitationMutations, invitationNotice, invitationState, invitationWarningCount, pendingCreation, reconcileRemoteGroupSnapshot, recordConfirmedExpenseMutation, recordConfirmedSettlementMutation, recordConfirmedSpendingPlanMutation, refresh, removeGroup, retryPendingCreation, state]);
  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
}

export function useGroups() {
  const value = useContext(GroupsContext);
  if (!value) throw new Error('useGroups must be used inside GroupsProvider.');
  return value;
}

function isAmbiguousInvitationDecisionError(error: unknown): boolean {
  if (!(error instanceof AppFailure)) return false;
  if (error.detail.kind === 'network' || error.detail.kind === 'timeout' || error.detail.kind === 'invitation_unavailable') return true;
  return error.detail.kind === 'github' && (error.detail.status === 409 || error.detail.status >= 500);
}

function publishUnknownInvitationDecision(
  invitation: PendingGroupInvitation,
  action: 'accept' | 'decline',
  patchInvitationState: (update: (current: ResourceState<PendingGroupInvitation[]>) => ResourceState<PendingGroupInvitation[]>) => void,
  setInvitationNotice: (value: string | null) => void,
): never {
  const failure = new AppFailure({ kind: 'invitation_decision_unknown', invitationId: invitation.id, action });
  const message = messageForError(failure.detail);
  patchInvitationState((value) => ({
    ...value,
    data: sortInvitations([...value.data.filter((candidate) => candidate.id !== invitation.id), invitation]),
    status: 'ready',
    isRefreshing: false,
    error: message,
  }));
  setInvitationNotice(message);
  throw failure;
}

function sortInvitations(invitations: PendingGroupInvitation[]): PendingGroupInvitation[] {
  return invitations.sort((left, right) => {
    const byDate = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    const byRepository = left.repository.fullName.localeCompare(right.repository.fullName, undefined, { sensitivity: 'base' });
    return byDate || byRepository || left.id - right.id;
  });
}

function filterConfirmedInvitationDecisions(
  invitations: PendingGroupInvitation[],
  barriers: Map<number, InvitationDecisionBarrier>,
  generation: number,
): { visible: PendingGroupInvitation[]; hasDeclineConflict: boolean } {
  const openIds = new Set(invitations.map((invitation) => invitation.id));
  for (const invitationId of barriers.keys()) {
    if (!openIds.has(invitationId)) barriers.delete(invitationId);
  }
  let hasDeclineConflict = false;
  const visible = invitations.filter((invitation) => {
    const barrier = barriers.get(invitation.id);
    if (!barrier) return true;
    if (barrier.action === 'decline' && generation > barrier.confirmedAfterGeneration) {
      barriers.delete(invitation.id);
      hasDeclineConflict = true;
      return true;
    }
    return false;
  });
  return { visible, hasDeclineConflict };
}
