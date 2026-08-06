import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, DomainValidationError, messageForError } from '@/domain/errors';
import { groupKey, type AcceptedInvitationPendingDiscovery, type ActivityInboxV1, type ActivityItem, type ActivityKind, type ConfirmedInvitationDecision, type CurrencyCode, type DiscoveredGroup, type GroupCommitSlice, type GroupFile, type GroupKey, type PendingGroupCreation, type PendingGroupInvitation, type RepositoryCommitRef, type RemoteGroupSnapshot, type SettlementLedgerState } from '@/domain/types';
import { githubGateway, snapshotStore, systemClock, systemLocalCalendar } from '@/infrastructure/runtime';
import { clearActivity as clearActivityItems, dismissActivity as dismissActivityItem, markActivityRead as markActivityItemsRead, reconcileActivity, recordLocalCommit, registerLocalGroup, removeGroupActivity } from '@/features/activity/model';
import type { GitHubGateway } from '@/infrastructure/github/contracts';
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
  activityState: ResourceState<ActivityItem[]>;
  activityWarning: string | null;
  hasUnreadActivity: boolean;
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
  recordLocalActivity(key: string, kind: ActivityKind, commit: RepositoryCommitRef | null, resourceId?: string): Promise<void>;
  markActivityRead(itemIds: readonly string[]): Promise<void>;
  dismissActivity(itemId: string): Promise<void>;
  clearActivity(): Promise<void>;
  removeGroup(key: string): Promise<void>;
};

const initial: ResourceState<DiscoveredGroup[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
const initialInvitations: ResourceState<PendingGroupInvitation[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
const initialActivity: ResourceState<ActivityItem[]> = { data: [], status: 'idle', isRefreshing: false, lastSuccessfulAt: null, error: null };
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
  const [activityState, setActivityState] = useState(initialActivity);
  const activityStateRef = useRef(activityState);
  const activityRecordRef = useRef<ActivityInboxV1 | null>(null);
  const activityHydrationRef = useRef<Promise<void>>(Promise.resolve());
  const activityRevisionRef = useRef(0);
  const activityWriteTailRef = useRef<Promise<void>>(Promise.resolve());
  const [activityWarning, setActivityWarning] = useState<string | null>(null);
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

  const replaceActivityState = useCallback((next: ResourceState<ActivityItem[]>) => {
    activityStateRef.current = next;
    setActivityState(next);
  }, []);

  const patchActivityState = useCallback((update: (current: ResourceState<ActivityItem[]>) => ResourceState<ActivityItem[]>) => {
    replaceActivityState(update(activityStateRef.current));
  }, [replaceActivityState]);

  const persistActivityUpdate = useCallback((
    transform: (current: ActivityInboxV1 | null) => ActivityInboxV1,
    options: { lastSuccessfulAt?: string | null; warning?: string | null } = {},
  ): Promise<void> => {
    if (!account) return Promise.resolve();
    const accountId = account.id;
    const accountEpoch = accountEpochRef.current;
    const operation = activityWriteTailRef.current.catch(() => undefined).then(async () => {
      await activityHydrationRef.current.catch(() => undefined);
      if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return;
      const next = transform(activityRecordRef.current);
      activityRevisionRef.current += 1;
      try {
        await snapshotStore.writeActivity(accountId, next);
      } catch (error) {
        if (activeAccountIdRef.current === accountId && accountEpochRef.current === accountEpoch) {
          patchActivityState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: 'Activity was found, but it could not be saved on this device.' }));
        }
        throw error;
      }
      if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return;
      activityRecordRef.current = next;
      replaceActivityState({
        data: next.items,
        status: 'ready',
        isRefreshing: false,
        lastSuccessfulAt: options.lastSuccessfulAt === undefined ? activityStateRef.current.lastSuccessfulAt : options.lastSuccessfulAt,
        error: null,
      });
      if (options.warning !== undefined) setActivityWarning(options.warning);
    });
    activityWriteTailRef.current = operation.catch(() => undefined);
    return operation;
  }, [account, patchActivityState, replaceActivityState]);

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
    activityRecordRef.current = null;
    activityRevisionRef.current = 0;
    activityHydrationRef.current = Promise.resolve();
    activityWriteTailRef.current = Promise.resolve();
    queueMicrotask(() => {
      replaceState(initial);
      replaceInvitationState(initialInvitations);
      replaceAcceptedPendingDiscovery([]);
      setGroupWarningCount(0);
      setInvitationWarningCount(0);
      setInvitationMutations(new Map());
      setInvitationNotice(null);
      replaceActivityState(initialActivity);
      setActivityWarning(null);
      setHasInstallation(false);
      setCanCreateGroups(false);
      setPendingCreation(null);
    });
    if (!account) {
      return;
    }
    let active = true;
    const activityRevision = activityRevisionRef.current;
    const hydration = Promise.all([snapshotStore.readGroups(account.id), snapshotStore.readPendingGroup(account.id), snapshotStore.readActivity(account.id)]).then(([groups, pending, activity]) => {
      if (!active || activeAccountIdRef.current !== account.id) return;
      if (groups && !stateRef.current.data.length) replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null });
      setPendingCreation(pending);
      if (activityRevisionRef.current === activityRevision) {
        activityRecordRef.current = activity;
        replaceActivityState({ data: activity?.items ?? [], status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null });
      }
    }).catch(() => {
      if (!active || activeAccountIdRef.current !== account.id) return;
      replaceActivityState({ data: [], status: 'error', isRefreshing: false, lastSuccessfulAt: null, error: 'Saved activity could not be loaded on this device.' });
    });
    activityHydrationRef.current = hydration.then(() => undefined);
    return () => { active = false; };
  }, [account, replaceAcceptedPendingDiscovery, replaceActivityState, replaceInvitationState, replaceState]);

  const startDashboardRefresh = useCallback((): Promise<DashboardRefreshResult> => {
    if (!account) return Promise.resolve({ groups: null, invitations: null });
    if (dashboardInFlight.current) return dashboardInFlight.current;
    const accountId = account.id;
    const accountEpoch = accountEpochRef.current;
    const generation = ++dashboardGeneration.current;
    patchState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true, error: null }));
    patchInvitationState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true }));
    patchActivityState((value) => ({ ...value, status: value.data.length ? 'ready' : 'loading', isRefreshing: true, error: null }));
    setInvitationNotice(null);

    let operation!: Promise<DashboardRefreshResult>;
    operation = (async () => {
      try {
        await activityHydrationRef.current.catch(() => undefined);
        const [groupResult, invitationResult] = await Promise.allSettled([
          githubGateway.discoverGroups(),
          githubGateway.listGroupInvitations(account.login),
        ]);
        if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };

        const activityGroups = groupResult.status === 'fulfilled'
          ? groupResult.value.groups.map((group) => ({ ...group, summary: stateRef.current.data.find((item) => item.key === group.key)?.summary ?? null }))
          : [];
        const primaryTerminalError = [groupResult, invitationResult]
          .find((result) => result.status === 'rejected' && isTerminalAuthError(result.reason));
        const activityResult = groupResult.status === 'fulfilled' && !primaryTerminalError
          ? await loadGroupActivityCommits(githubGateway, activityGroups, activityRecordRef.current)
          : { commits: new Map<GroupKey, GroupCommitSlice>(), failures: [] as unknown[] };
        if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };

        const terminalError = primaryTerminalError ?? activityResult.failures
          .map((reason) => ({ status: 'rejected' as const, reason }))
          .find((result) => isTerminalAuthError(result.reason));
        if (terminalError?.status === 'rejected' && isTerminalAuthError(terminalError.reason)) {
          activeAccountIdRef.current = null;
          accountEpochRef.current += 1;
          replaceState(initial);
          replaceInvitationState(initialInvitations);
          replaceActivityState(initialActivity);
          replaceAcceptedPendingDiscovery([]);
          confirmedInvitationDecisions.current.clear();
          setInvitationMutations(new Map());
          await expire(terminalError.reason.detail.reason === 'missing' ? 'revoked' : terminalError.reason.detail.reason);
          return { groups: null, invitations: null };
        }

        const canReconcileActivity = groupResult.status === 'fulfilled' || (activityRecordRef.current !== null && invitationResult.status === 'fulfilled');
        const activityNow = systemClock.now().toISOString();
        const activityPreview = canReconcileActivity ? reconcileActivity({
          current: activityRecordRef.current,
          groups: groupResult.status === 'fulfilled' ? activityGroups : [],
          commits: activityResult.commits,
          invitations: invitationResult.status === 'fulfilled' ? invitationResult.value.invitations : null,
          observedAt: activityNow,
        }) : null;
        const staleSummaryGroupKeys = activityPreview ? activityGroupKeysWithStaleSummaries(activityPreview, activityGroups) : new Set<GroupKey>();
        const summaryResult = groupResult.status === 'fulfilled' && staleSummaryGroupKeys.size
          ? await refreshActivityGroupSnapshots(githubGateway, activityGroups, staleSummaryGroupKeys, account.login)
          : { snapshots: [] as RemoteGroupSnapshot[], failures: [] as unknown[] };
        if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };

        const summaryTerminalError = summaryResult.failures.find(isTerminalAuthError);
        if (summaryTerminalError && isTerminalAuthError(summaryTerminalError)) {
          activeAccountIdRef.current = null;
          accountEpochRef.current += 1;
          replaceState(initial);
          replaceInvitationState(initialInvitations);
          replaceActivityState(initialActivity);
          replaceAcceptedPendingDiscovery([]);
          confirmedInvitationDecisions.current.clear();
          setInvitationMutations(new Map());
          await expire(summaryTerminalError.detail.reason === 'missing' ? 'revoked' : summaryTerminalError.detail.reason);
          return { groups: null, invitations: null };
        }

        const refreshedSnapshots = summaryResult.snapshots.map(reconcileRemoteGroupSnapshot);
        const refreshedDescriptors = new Map(refreshedSnapshots.map((snapshot) => [snapshot.key, descriptorFromSnapshot(snapshot, account.login)]));
        const summaryGroups = activityGroups.map((group) => refreshedDescriptors.get(group.key) ?? group);
        let snapshotCacheFailed = false;
        await Promise.all(refreshedSnapshots.map((snapshot) => snapshotStore.writeGroup(accountId, snapshot.key, snapshot).catch(() => {
          snapshotCacheFailed = true;
        })));

        let groups: DiscoveredGroup[] | null = null;
        if (groupResult.status === 'fulfilled' && generation >= appliedGroupGeneration.current) {
          appliedGroupGeneration.current = generation;
          setHasInstallation(groupResult.value.installationCount > 0);
          setCanCreateGroups(groupResult.value.hasAllRepositoriesInstallation);
          groups = summaryGroups;
          const now = systemClock.now().toISOString();
          replaceState({ data: groups, status: 'ready', isRefreshing: false, lastSuccessfulAt: now, error: dashboardSummaryWarning(summaryResult.failures) });
          setGroupWarningCount(groupResult.value.warnings.length);
          const repositoryIds = new Set(groups.map((group) => group.repository.id));
          replaceAcceptedPendingDiscovery(acceptedPendingDiscoveryRef.current.filter((item) => !repositoryIds.has(item.repositoryId)));
          try {
            await snapshotStore.writeGroups(accountId, groups);
          } catch {
            patchState((value) => ({ ...value, error: 'Groups loaded, but the offline cache could not be updated.' }));
          }
          if (snapshotCacheFailed) patchState((value) => ({ ...value, error: 'Groups loaded, but refreshed group details could not be saved for offline use.' }));
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

        if (canReconcileActivity) {
          const warning = activityWarningMessage(activityResult.failures);
          try {
            await persistActivityUpdate((current) => reconcileActivity({
              current,
              groups: groupResult.status === 'fulfilled' ? summaryGroups : [],
              commits: activityResult.commits,
              invitations: invitationResult.status === 'fulfilled' ? invitationResult.value.invitations : null,
              observedAt: activityNow,
            }), { lastSuccessfulAt: activityNow, warning });
          } catch {
            // The accepted groups and invitations remain usable when local activity persistence fails.
          }
        } else {
          patchActivityState((value) => ({ ...value, status: value.data.length ? 'ready' : 'error', isRefreshing: false, error: 'Unable to refresh activity until groups can be loaded.' }));
        }
        return { groups, invitations };
      } finally {
        if (dashboardInFlight.current === operation) dashboardInFlight.current = null;
      }
    })();
    dashboardInFlight.current = operation;
    return operation;
  }, [account, expire, patchActivityState, patchInvitationState, patchState, persistActivityUpdate, reconcileRemoteGroupSnapshot, replaceAcceptedPendingDiscovery, replaceActivityState, replaceInvitationState, replaceState]);

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
          await activityHydrationRef.current.catch(() => undefined);
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
          if (activityRecordRef.current) {
            const activityNow = systemClock.now().toISOString();
            await persistActivityUpdate((current) => reconcileActivity({ current, groups: [], commits: new Map(), invitations: result.invitations, observedAt: activityNow }), { lastSuccessfulAt: activityNow }).catch(() => undefined);
          }
          return { groups: null, invitations: result.invitations };
        } catch (error) {
          if (activeAccountIdRef.current !== accountId || accountEpochRef.current !== accountEpoch) return { groups: null, invitations: null };
          if (isTerminalAuthError(error)) {
            activeAccountIdRef.current = null;
            accountEpochRef.current += 1;
            replaceState(initial);
            replaceInvitationState(initialInvitations);
            replaceActivityState(initialActivity);
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
  }, [account, expire, patchInvitationState, persistActivityUpdate, replaceAcceptedPendingDiscovery, replaceActivityState, replaceInvitationState, replaceState]);

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
            await persistActivityUpdate((current) => registerLocalGroup(current, outcome.group, systemClock.now().toISOString())).catch(() => undefined);
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
          await persistActivityUpdate((current) => registerLocalGroup(current, acceptedGroup, systemClock.now().toISOString())).catch(() => undefined);
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
  }, [expire, patchInvitationState, persistActivityUpdate, refreshAfterInvitationDecision, refreshInvitationsAfterDecision, replaceAcceptedPendingDiscovery]);

  const acceptInvitation = useCallback((invitationId: number) => performInvitationDecision(invitationId, 'accept'), [performInvitationDecision]);
  const declineInvitation = useCallback((invitationId: number) => performInvitationDecision(invitationId, 'decline'), [performInvitationDecision]);

  const applyGroupSnapshot = useCallback(async (snapshot: RemoteGroupSnapshot) => {
    if (!account) return;
    const descriptor = descriptorFromSnapshot(snapshot, account.login);
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

  const createGroup = useCallback(async (name: string, currency: CurrencyCode) => {
    if (!account) throw new DomainValidationError('Sign in to create a group.');
    try {
      const created = await createGroupRepository({ gateway: githubGateway, store: snapshotStore, accountId: account.id, login: account.login, name, currency, canCreate: canCreateGroups, clock: systemClock });
      const descriptor = created.value;
      const groups = [...stateRef.current.data, descriptor].sort((a, b) => a.group.name.localeCompare(b.group.name));
      patchState((value) => ({ ...value, data: groups, status: 'ready' }));
      await snapshotStore.writeGroups(account.id, groups);
      await persistActivityUpdate((current) => {
        const observedAt = systemClock.now().toISOString();
        const registered = registerLocalGroup(current, descriptor, observedAt);
        return created.commit ? recordLocalCommit(registered, descriptor, 'group_created', created.commit, observedAt, undefined, account.login) : registered;
      }).catch(() => undefined);
      return descriptor;
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'partial_group_creation') setPendingCreation(await snapshotStore.readPendingGroup(account.id));
      if (error instanceof AppFailure && error.detail.kind === 'github' && error.detail.status === 0) await refresh().catch(() => undefined);
      throw error;
    }
  }, [account, canCreateGroups, patchState, persistActivityUpdate, refresh]);

  const retryPendingCreation = useCallback(async () => {
    if (!account || !pendingCreation) throw new DomainValidationError('There is no group setup to retry.');
    const initialized = await githubGateway.createGroupFile(pendingCreation.repository, pendingCreation.group);
    const descriptor = { key: groupKey(pendingCreation.repository.owner, pendingCreation.repository.name), repository: pendingCreation.repository, group: pendingCreation.group, summary: null } satisfies DiscoveredGroup;
    const groups = [...stateRef.current.data.filter((item) => item.key !== descriptor.key), descriptor].sort((a, b) => a.group.name.localeCompare(b.group.name));
    await snapshotStore.writePendingGroup(account.id, null);
    await snapshotStore.writeGroups(account.id, groups);
    setPendingCreation(null);
    patchState((value) => ({ ...value, data: groups, status: 'ready' }));
    await persistActivityUpdate((current) => {
      const observedAt = systemClock.now().toISOString();
      const registered = registerLocalGroup(current, descriptor, observedAt);
      return initialized.commit ? recordLocalCommit(registered, descriptor, 'group_created', initialized.commit, observedAt, undefined, account.login) : registered;
    }).catch(() => undefined);
    return descriptor;
  }, [account, patchState, pendingCreation, persistActivityUpdate]);

  const recordLocalActivity = useCallback(async (key: string, kind: ActivityKind, commit: RepositoryCommitRef | null, resourceId?: string) => {
    if (!account || !commit) return;
    const group = stateRef.current.data.find((candidate) => candidate.key === key);
    if (!group) return;
    await persistActivityUpdate((current) => recordLocalCommit(current, group, kind, commit, systemClock.now().toISOString(), resourceId, account.login)).catch(() => undefined);
  }, [account, persistActivityUpdate]);

  const markActivityRead = useCallback(async (itemIds: readonly string[]) => {
    if (!itemIds.length || !activityRecordRef.current) return;
    const renderedIds = new Set(itemIds);
    await persistActivityUpdate((current) => current
      ? markActivityItemsRead(current, [...renderedIds].filter((id) => current.items.some((item) => item.id === id)), systemClock.now().toISOString())
      : reconcileActivity({ current, groups: [], commits: new Map(), invitations: null, observedAt: systemClock.now().toISOString() }));
  }, [persistActivityUpdate]);

  const dismissActivity = useCallback(async (itemId: string) => {
    if (!activityRecordRef.current?.items.some((item) => item.id === itemId)) return;
    await persistActivityUpdate((current) => current ? dismissActivityItem(current, itemId) : reconcileActivity({ current, groups: [], commits: new Map(), invitations: null, observedAt: systemClock.now().toISOString() }));
  }, [persistActivityUpdate]);

  const clearActivity = useCallback(async () => {
    if (!activityRecordRef.current?.items.length) return;
    await persistActivityUpdate((current) => current ? clearActivityItems(current) : reconcileActivity({ current, groups: [], commits: new Map(), invitations: null, observedAt: systemClock.now().toISOString() }));
  }, [persistActivityUpdate]);

  const removeGroup = useCallback(async (key: string) => {
    if (!account) return;
    confirmedMutations.current.delete(key);
    confirmedSpendingPlans.current.delete(key);
    confirmedSettlementLedgers.current.delete(key);
    const removed = stateRef.current.data.find((group) => group.key === key);
    const groups = stateRef.current.data.filter((group) => group.key !== key);
    try {
      await Promise.all([
        snapshotStore.removeGroup(account.id, key as `${string}/${string}`),
        snapshotStore.writeGroups(account.id, groups),
        removed ? persistActivityUpdate((current) => current ? removeGroupActivity(current, removed.repository.id) : reconcileActivity({ current, groups: [], commits: new Map(), invitations: null, observedAt: systemClock.now().toISOString() })) : Promise.resolve(),
      ]);
    } finally {
      patchState((value) => ({ ...value, data: groups }));
    }
  }, [account, patchState, persistActivityUpdate]);

  const aggregates = useMemo(() => calculateGroupAggregates(state.data), [state.data]);
  const hasUnreadActivity = activityState.data.some((item) => item.readAt === null);

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
    activityState,
    activityWarning,
    hasUnreadActivity,
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
    recordLocalActivity,
    markActivityRead,
    dismissActivity,
    clearActivity,
    removeGroup,
  }), [acceptedPendingDiscovery, acceptInvitation, activityState, activityWarning, aggregates, applyGroupSnapshot, canCreateGroups, clearActivity, createGroup, declineInvitation, dismissActivity, groupWarningCount, hasInstallation, hasUnreadActivity, invitationMutations, invitationNotice, invitationState, invitationWarningCount, markActivityRead, pendingCreation, reconcileRemoteGroupSnapshot, recordConfirmedExpenseMutation, recordConfirmedSettlementMutation, recordConfirmedSpendingPlanMutation, recordLocalActivity, refresh, removeGroup, retryPendingCreation, state]);
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

async function loadGroupActivityCommits(
  gateway: Pick<GitHubGateway, 'listGroupActivityCommits'>,
  groups: readonly DiscoveredGroup[],
  current: ActivityInboxV1 | null,
): Promise<{ commits: Map<GroupKey, GroupCommitSlice>; failures: unknown[] }> {
  const commits = new Map<GroupKey, GroupCommitSlice>();
  const failures: unknown[] = [];
  let nextIndex = 0;
  let rateLimited = false;

  async function worker() {
    while (!rateLimited && nextIndex < groups.length) {
      const group = groups[nextIndex++]!;
      const checkpoint = current?.checkpoints.find((candidate) => candidate.repositoryId === group.repository.id)?.headCommitSha ?? null;
      try {
        commits.set(group.key, await gateway.listGroupActivityCommits(group.repository, checkpoint));
      } catch (error) {
        failures.push(error);
        if (error instanceof AppFailure && error.detail.kind === 'rate_limit') rateLimited = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(3, groups.length) }, worker));
  return { commits, failures };
}

function activityGroupKeysWithStaleSummaries(inbox: ActivityInboxV1, groups: readonly DiscoveredGroup[]): Set<GroupKey> {
  const summaryTimes = new Map(groups.map((group) => [group.key, group.summary ? Date.parse(group.summary.syncedAt) : Number.NEGATIVE_INFINITY]));
  return new Set(inbox.items.flatMap((item) => {
    if (item.groupKey === null) return [];
    const summaryTime = summaryTimes.get(item.groupKey);
    return summaryTime !== undefined && Date.parse(item.observedAt) > summaryTime ? [item.groupKey] : [];
  }));
}

async function refreshActivityGroupSnapshots(
  gateway: Pick<GitHubGateway, 'refreshGroup'>,
  groups: readonly DiscoveredGroup[],
  staleSummaryGroupKeys: ReadonlySet<GroupKey>,
  currentLogin: string,
): Promise<{ snapshots: RemoteGroupSnapshot[]; failures: unknown[] }> {
  const targets = groups.filter((group) => staleSummaryGroupKeys.has(group.key));
  const snapshots: RemoteGroupSnapshot[] = [];
  const failures: unknown[] = [];
  let nextIndex = 0;
  let rateLimited = false;

  async function worker() {
    while (!rateLimited && nextIndex < targets.length) {
      const group = targets[nextIndex++]!;
      try {
        snapshots.push(await gateway.refreshGroup(group.repository, currentLogin));
      } catch (error) {
        failures.push(error);
        if (error instanceof AppFailure && error.detail.kind === 'rate_limit') rateLimited = true;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, targets.length) }, worker));
  return { snapshots, failures };
}

function descriptorFromSnapshot(snapshot: RemoteGroupSnapshot, currentLogin: string): DiscoveredGroup {
  const currentBalance = snapshot.balances.members.find((member) => member.login.toLowerCase() === currentLogin.toLowerCase())?.netMinor ?? 0;
  return {
    key: snapshot.key,
    repository: snapshot.repository,
    group: snapshot.group,
    summary: {
      currency: snapshot.group.currency,
      currentUserBalanceMinor: currentBalance,
      memberCount: snapshot.members.length,
      expenseCount: snapshot.expenses.length,
      syncedAt: snapshot.syncedAt,
    },
  };
}

function dashboardSummaryWarning(failures: readonly unknown[]): string | null {
  if (!failures.length) return null;
  return failures.length === 1
    ? 'New activity was found, but one group summary could not be updated. Pull to retry.'
    : `New activity was found, but ${failures.length} group summaries could not be updated. Pull to retry.`;
}

function activityWarningMessage(failures: readonly unknown[]): string | null {
  if (!failures.length) return null;
  const rateLimit = failures.find((error): error is AppFailure => error instanceof AppFailure && error.detail.kind === 'rate_limit');
  if (rateLimit && rateLimit.detail.kind === 'rate_limit') return messageForError(rateLimit.detail);
  return failures.length === 1
    ? 'Activity for one group could not be checked. Existing activity was kept.'
    : `Activity for ${failures.length} groups could not be checked. Existing activity was kept.`;
}
