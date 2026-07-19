import { normalizeLogin, type ActivityItem, type DiscoveredGroup, type IsoInstant, type UnclassifiedGroupCommit } from '@/domain/types';

import { destinationForActivity } from './catalog';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const expenseSubject = new RegExp(`^(Add|Update|Delete) expense (${UUID})$`);
const settlementSubject = new RegExp(`^(Record|Confirm|Delete) settlement payment (${UUID})$`);
const SHA = /^[0-9a-f]{40,64}$/i;

export interface ClassifiedCommit {
  kind: ActivityItem['kind'];
  resourceId?: string;
  recognized: boolean;
}

export function classifyCommitSubject(subject: string): ClassifiedCommit {
  const expense = expenseSubject.exec(subject);
  if (expense) {
    const kinds = { Add: 'expense_added', Update: 'expense_updated', Delete: 'expense_deleted' } as const;
    return { kind: kinds[expense[1] as keyof typeof kinds], resourceId: expense[2]!.toLowerCase(), recognized: true };
  }
  const settlement = settlementSubject.exec(subject);
  if (settlement) {
    const kinds = { Record: 'settlement_recorded', Confirm: 'settlement_confirmed', Delete: 'settlement_deleted' } as const;
    return { kind: kinds[settlement[1] as keyof typeof kinds], resourceId: settlement[2]!.toLowerCase(), recognized: true };
  }
  if (subject === 'Update spending plan') return { kind: 'spending_plan_updated', recognized: true };
  if (subject === 'Remove spending plan') return { kind: 'spending_plan_removed', recognized: true };
  if (subject === 'Initialize BranchBalance group') return { kind: 'group_created', recognized: true };
  return { kind: 'group_updated', recognized: false };
}

export function activityItemFromCommit(
  group: DiscoveredGroup,
  commit: UnclassifiedGroupCommit,
  observedAt: IsoInstant,
  readAt: IsoInstant | null,
): ActivityItem {
  if (!SHA.test(commit.sha)) throw new Error('Invalid commit SHA.');
  const classified = classifyCommitSubject(commit.firstMessageLine);
  const actor = commit.authorLogin?.trim() ? normalizeLogin(commit.authorLogin) : null;
  const committed = commit.committedAt ? Date.parse(commit.committedAt) : Number.NaN;
  const observed = Date.parse(observedAt);
  const eventAt = Number.isFinite(committed) && committed <= observed + 5 * 60 * 1000 ? commit.committedAt! : observedAt;
  const sha = commit.sha.toLowerCase();
  return {
    id: `commit:${group.key}:${sha}`,
    source: 'commit',
    sourceId: sha,
    repositoryId: group.repository.id,
    groupKey: group.key,
    groupName: group.group.name,
    kind: classified.kind,
    destination: destinationForActivity(classified.kind, classified.resourceId),
    actorLogin: actor,
    eventAt,
    observedAt,
    readAt,
  };
}

export function isRecognizedCommit(commit: UnclassifiedGroupCommit): boolean {
  return classifyCommitSubject(commit.firstMessageLine).recognized;
}
