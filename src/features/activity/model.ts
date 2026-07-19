import type {
  ActivityInboxV1,
  ActivityItem,
  ActivityKind,
  DiscoveredGroup,
  GroupCommitSlice,
  GroupKey,
  IsoInstant,
  PendingGroupInvitation,
  RepositoryCommitRef,
} from '@/domain/types';

import { destinationForActivity } from './catalog';
import { activityItemFromCommit, isRecognizedCommit } from './commit-classifier';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = 30 * DAY_MS;
const MAX_ITEMS = 100;
const MAX_BASELINE_ITEMS = 20;
const MAX_UNREACHABLE_ITEMS_PER_GROUP = 20;

export type GroupActivityResults = ReadonlyMap<GroupKey, GroupCommitSlice>;

export interface ReconcileActivityInput {
  current: ActivityInboxV1 | null;
  groups: readonly DiscoveredGroup[];
  commits: GroupActivityResults;
  invitations: readonly PendingGroupInvitation[] | null;
  observedAt: IsoInstant;
}

export function emptyActivityInbox(observedAt: IsoInstant): ActivityInboxV1 {
  return { version: 1, initializedAt: observedAt, items: [], checkpoints: [], localCommitReceipts: [], seenInvitations: [] };
}

export function reconcileActivity(input: ReconcileActivityInput): ActivityInboxV1 {
  const firstAccountBaseline = input.current === null;
  const next = cloneInbox(input.current ?? emptyActivityInbox(input.observedAt));
  const existingIds = new Set(next.items.map((item) => item.id));
  const localShas = new Set(next.localCommitReceipts.map((receipt) => `${receipt.repositoryId}:${receipt.commitSha.toLowerCase()}`));
  const traversedShas = new Set<string>();
  const baselineItems: ActivityItem[] = [];

  for (const group of input.groups) {
    let checkpoint = next.checkpoints.find((candidate) => candidate.repositoryId === group.repository.id);
    const slice = input.commits.get(group.key);
    const isNewGroup = !checkpoint && !firstAccountBaseline;
    if (!checkpoint) {
      checkpoint = {
        repositoryId: group.repository.id,
        groupKey: group.key,
        headCommitSha: null,
        initializedAt: input.observedAt,
        lastCheckedAt: input.observedAt,
      };
      next.checkpoints.push(checkpoint);
      if (isNewGroup) addItem(next.items, existingIds, groupAddedItem(group, input.observedAt, null));
    } else {
      checkpoint.groupKey = group.key;
    }

    for (const receipt of next.localCommitReceipts) {
      if (receipt.repositoryId === group.repository.id) receipt.groupKey = group.key;
    }

    for (const item of next.items) {
      if (item.repositoryId === group.repository.id && item.groupKey !== null) {
        existingIds.delete(item.id);
        item.groupKey = group.key;
        item.groupName = group.group.name;
        if (item.source === 'commit') item.id = `commit:${group.key}:${item.sourceId}`;
        if (item.source === 'summary') item.id = `summary:${group.key}:${item.sourceId}`;
        existingIds.add(item.id);
      }
    }

    if (!slice) continue;
    for (const commit of slice.commits) traversedShas.add(`${group.repository.id}:${commit.sha.toLowerCase()}`);
    const newestSha = slice.commits[0]?.sha.toLowerCase() ?? null;
    if (checkpoint.headCommitSha === null) {
      const cutoff = Date.parse(input.observedAt) - RETENTION_MS;
      for (const commit of slice.commits) {
        if (!isRecognizedCommit(commit)) continue;
        const item = activityItemFromCommit(group, commit, input.observedAt, input.observedAt);
        if (Date.parse(item.eventAt) < cutoff) continue;
        baselineItems.push(item);
      }
      checkpoint.headCommitSha = newestSha;
      checkpoint.lastCheckedAt = input.observedAt;
      continue;
    }

    const checkpointIndex = slice.commits.findIndex((commit) => commit.sha.toLowerCase() === checkpoint!.headCommitSha?.toLowerCase());
    const checkpointFound = slice.checkpointFound || checkpointIndex >= 0;
    const unseen = checkpointFound ? slice.commits.slice(0, Math.max(checkpointIndex, 0)) : slice.commits.slice(0, MAX_UNREACHABLE_ITEMS_PER_GROUP);
    for (const commit of unseen) {
      const key = `${group.repository.id}:${commit.sha.toLowerCase()}`;
      if (localShas.has(key)) continue;
      addItem(next.items, existingIds, activityItemFromCommit(group, commit, input.observedAt, null));
    }
    if (!checkpointFound && newestSha) addItem(next.items, existingIds, summaryItem(group, newestSha, input.observedAt));
    if (newestSha) checkpoint.headCommitSha = newestSha;
    checkpoint.lastCheckedAt = input.observedAt;
  }

  if (baselineItems.length) {
    baselineItems.sort(compareActivityItems);
    for (const item of baselineItems.slice(0, MAX_BASELINE_ITEMS)) addItem(next.items, existingIds, item);
  }

  if (input.invitations !== null) reconcileInvitations(next, input.invitations, input.observedAt, existingIds, firstAccountBaseline);

  const checkpointHeads = new Map(next.checkpoints.map((checkpoint) => [checkpoint.repositoryId, checkpoint.headCommitSha?.toLowerCase()]));
  next.localCommitReceipts = next.localCommitReceipts.filter((receipt) => {
    const expired = Date.parse(receipt.observedAt) < Date.parse(input.observedAt) - RETENTION_MS;
    const passed = traversedShas.has(`${receipt.repositoryId}:${receipt.commitSha.toLowerCase()}`)
      || checkpointHeads.get(receipt.repositoryId) === receipt.commitSha.toLowerCase();
    return !expired && !passed;
  });
  return pruneActivity(next, input.observedAt);
}

export function recordLocalCommit(
  current: ActivityInboxV1 | null,
  group: DiscoveredGroup,
  kind: ActivityKind,
  commit: RepositoryCommitRef,
  observedAt: IsoInstant,
  resourceId?: string,
  actorLogin?: string,
): ActivityInboxV1 {
  const next = cloneInbox(current ?? emptyActivityInbox(observedAt));
  const sha = commit.sha.toLowerCase();
  const item: ActivityItem = {
    id: `commit:${group.key}:${sha}`,
    source: 'commit',
    sourceId: sha,
    repositoryId: group.repository.id,
    groupKey: group.key,
    groupName: group.group.name,
    kind,
    destination: destinationForActivity(kind, resourceId),
    actorLogin: actorLogin?.trim().toLowerCase() ?? null,
    eventAt: commit.committedAt ?? observedAt,
    observedAt,
    readAt: observedAt,
  };
  const index = next.items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) next.items[index] = { ...next.items[index]!, ...item, readAt: observedAt };
  else next.items.push(item);
  if (!next.localCommitReceipts.some((receipt) => receipt.groupKey === group.key && receipt.commitSha.toLowerCase() === sha)) {
    next.localCommitReceipts.push({ repositoryId: group.repository.id, groupKey: group.key, commitSha: sha, observedAt });
  }
  if (!next.checkpoints.some((checkpoint) => checkpoint.repositoryId === group.repository.id)) {
    next.checkpoints.push({ repositoryId: group.repository.id, groupKey: group.key, headCommitSha: null, initializedAt: observedAt, lastCheckedAt: observedAt });
  }
  return pruneActivity(next, observedAt);
}

export function registerLocalGroup(current: ActivityInboxV1 | null, group: DiscoveredGroup, observedAt: IsoInstant): ActivityInboxV1 {
  const next = cloneInbox(current ?? emptyActivityInbox(observedAt));
  if (!next.checkpoints.some((checkpoint) => checkpoint.repositoryId === group.repository.id)) {
    next.checkpoints.push({ repositoryId: group.repository.id, groupKey: group.key, headCommitSha: null, initializedAt: observedAt, lastCheckedAt: observedAt });
  }
  const item = groupAddedItem(group, observedAt, observedAt);
  const existingIndex = next.items.findIndex((candidate) => candidate.id === item.id);
  if (existingIndex >= 0) next.items[existingIndex] = { ...next.items[existingIndex]!, ...item };
  else next.items.push(item);
  return pruneActivity(next, observedAt);
}

export function markActivityRead(current: ActivityInboxV1, itemIds: readonly string[], readAt: IsoInstant): ActivityInboxV1 {
  const ids = new Set(itemIds);
  const next = cloneInbox(current);
  next.items = next.items.map((item) => ids.has(item.id) && item.readAt === null ? { ...item, readAt } : item);
  return next;
}

export function dismissActivity(current: ActivityInboxV1, itemId: string): ActivityInboxV1 {
  const next = cloneInbox(current);
  next.items = next.items.filter((item) => item.id !== itemId);
  return next;
}

export function clearActivity(current: ActivityInboxV1): ActivityInboxV1 {
  const next = cloneInbox(current);
  next.items = [];
  return next;
}

export function removeGroupActivity(current: ActivityInboxV1, repositoryId: number): ActivityInboxV1 {
  const next = cloneInbox(current);
  next.items = next.items.filter((item) => item.repositoryId !== repositoryId);
  next.checkpoints = next.checkpoints.filter((checkpoint) => checkpoint.repositoryId !== repositoryId);
  next.localCommitReceipts = next.localCommitReceipts.filter((receipt) => receipt.repositoryId !== repositoryId);
  return next;
}

export function pruneActivity(current: ActivityInboxV1, observedAt: IsoInstant): ActivityInboxV1 {
  const next = cloneInbox(current);
  const cutoff = Date.parse(observedAt) - RETENTION_MS;
  next.items = next.items.filter((item) => Date.parse(item.eventAt) >= cutoff).sort(compareActivityItems).slice(0, MAX_ITEMS);
  next.seenInvitations = next.seenInvitations.filter((receipt) => receipt.resolvedAt === null || Date.parse(receipt.resolvedAt) >= cutoff);
  next.localCommitReceipts = next.localCommitReceipts.filter((receipt) => Date.parse(receipt.observedAt) >= cutoff);
  return next;
}

export function compareActivityItems(left: ActivityItem, right: ActivityItem): number {
  return Date.parse(right.eventAt) - Date.parse(left.eventAt)
    || Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || left.groupName.localeCompare(right.groupName, undefined, { sensitivity: 'base' })
    || left.id.localeCompare(right.id);
}

function reconcileInvitations(
  next: ActivityInboxV1,
  invitations: readonly PendingGroupInvitation[],
  observedAt: IsoInstant,
  existingIds: Set<string>,
  firstAccountBaseline: boolean,
) {
  const openIds = new Set(invitations.map((invitation) => invitation.id));
  for (const invitation of invitations) {
    let receipt = next.seenInvitations.find((candidate) => candidate.invitationId === invitation.id);
    if (!receipt) {
      receipt = { invitationId: invitation.id, lastObservedAt: observedAt, resolvedAt: null };
      next.seenInvitations.push(receipt);
      if (!firstAccountBaseline) addItem(next.items, existingIds, invitationItem(invitation, observedAt));
    } else {
      receipt.lastObservedAt = observedAt;
      receipt.resolvedAt = null;
    }
  }
  for (const receipt of next.seenInvitations) {
    if (!openIds.has(receipt.invitationId) && receipt.resolvedAt === null) receipt.resolvedAt = observedAt;
  }
}

function invitationItem(invitation: PendingGroupInvitation, observedAt: IsoInstant): ActivityItem {
  return {
    id: `invitation:${invitation.id}`,
    source: 'invitation',
    sourceId: String(invitation.id),
    repositoryId: invitation.repository.id,
    groupKey: null,
    groupName: invitation.provisionalName,
    kind: 'group_invitation_received',
    destination: { kind: 'groups' },
    actorLogin: invitation.inviter.trim().toLowerCase(),
    eventAt: invitation.createdAt,
    observedAt,
    readAt: null,
  };
}

function groupAddedItem(group: DiscoveredGroup, observedAt: IsoInstant, readAt: IsoInstant | null): ActivityItem {
  return {
    id: `group:${group.repository.id}:added`,
    source: 'group',
    sourceId: String(group.repository.id),
    repositoryId: group.repository.id,
    groupKey: group.key,
    groupName: group.group.name,
    kind: 'group_added',
    destination: { kind: 'overview' },
    actorLogin: null,
    eventAt: observedAt,
    observedAt,
    readAt,
  };
}

function summaryItem(group: DiscoveredGroup, newestSha: string, observedAt: IsoInstant): ActivityItem {
  return {
    id: `summary:${group.key}:${newestSha.toLowerCase()}`,
    source: 'summary',
    sourceId: newestSha.toLowerCase(),
    repositoryId: group.repository.id,
    groupKey: group.key,
    groupName: group.group.name,
    kind: 'additional_activity',
    destination: { kind: 'overview' },
    actorLogin: null,
    eventAt: observedAt,
    observedAt,
    readAt: null,
  };
}

function addItem(items: ActivityItem[], ids: Set<string>, item: ActivityItem) {
  if (ids.has(item.id)) return;
  ids.add(item.id);
  items.push(item);
}

function cloneInbox(current: ActivityInboxV1): ActivityInboxV1 {
  return {
    ...current,
    items: current.items.map((item) => ({ ...item, destination: { ...item.destination } })),
    checkpoints: current.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    localCommitReceipts: current.localCommitReceipts.map((receipt) => ({ ...receipt })),
    seenInvitations: current.seenInvitations.map((receipt) => ({ ...receipt })),
  };
}
