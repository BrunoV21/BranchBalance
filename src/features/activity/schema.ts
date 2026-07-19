import { z } from 'zod';

import { groupKey, normalizeLogin, type ActivityInboxV1 } from '@/domain/types';

import { activityDestinationKinds, activityKinds, activitySources } from './catalog';

const instant = z.string().datetime({ offset: true }).refine((value) => value.endsWith('Z'), 'Timestamp must be UTC.');
const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const sha = z.string().regex(/^[0-9a-f]{40,64}$/);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const normalizedLogin = z.string().trim().min(1).max(39).regex(/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/).refine((value) => normalizeLogin(value) === value, 'Login must be normalized.');
const normalizedGroupKey = z.string().trim().min(3).max(220).refine((value) => {
  const parts = value.split('/');
  return parts.length === 2 && Boolean(parts[0]) && Boolean(parts[1]) && groupKey(parts[0]!, parts[1]!) === value;
}, 'Group key must be normalized.');

const destinationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(activityDestinationKinds[0]) }).strict(),
  z.object({ kind: z.literal(activityDestinationKinds[1]) }).strict(),
  z.object({ kind: z.literal(activityDestinationKinds[2]), expenseId: uuid }).strict(),
  z.object({ kind: z.literal(activityDestinationKinds[3]) }).strict(),
  z.object({ kind: z.literal(activityDestinationKinds[4]) }).strict(),
]);

const itemSchema = z.object({
  id: z.string().min(1).max(400),
  source: z.enum(activitySources),
  sourceId: z.string().min(1).max(220),
  repositoryId: positiveId,
  groupKey: normalizedGroupKey.nullable(),
  groupName: z.string().trim().min(1).max(200),
  kind: z.enum(activityKinds),
  destination: destinationSchema,
  actorLogin: normalizedLogin.nullable(),
  eventAt: instant,
  observedAt: instant,
  readAt: instant.nullable(),
}).strict().superRefine((item, context) => {
  if (item.source === 'commit' || item.source === 'summary') {
    if (!sha.safeParse(item.sourceId).success || item.groupKey === null) context.addIssue({ code: 'custom', message: 'Commit activity requires a SHA and group key.' });
  }
  if ((item.source === 'invitation' || item.source === 'group') && !/^\d+$/.test(item.sourceId)) {
    context.addIssue({ code: 'custom', message: 'Invitation and group activity require a numeric source ID.' });
  }
  if (item.source === 'invitation' || item.source === 'group') {
    const numericSourceId = Number(item.sourceId);
    if (!Number.isSafeInteger(numericSourceId) || numericSourceId <= 0) context.addIssue({ code: 'custom', message: 'Activity source ID must be positive.' });
    if (item.source === 'group' && numericSourceId !== item.repositoryId) context.addIssue({ code: 'custom', message: 'Group activity must match its repository.' });
  }
  const expectedId = item.source === 'commit' ? `commit:${item.groupKey}:${item.sourceId}`
    : item.source === 'summary' ? `summary:${item.groupKey}:${item.sourceId}`
      : item.source === 'invitation' ? `invitation:${item.sourceId}`
        : `group:${item.sourceId}:added`;
  if (item.id !== expectedId) context.addIssue({ code: 'custom', message: 'Activity ID does not match its source.' });
  if (item.kind === 'group_invitation_received' && (item.source !== 'invitation' || item.groupKey !== null || item.destination.kind !== 'groups')) {
    context.addIssue({ code: 'custom', message: 'Invitation activity has an invalid target.' });
  }
  if (item.source === 'invitation' && item.kind !== 'group_invitation_received') context.addIssue({ code: 'custom', message: 'Invitation activity has an invalid kind.' });
  if (item.source === 'group' && (item.kind !== 'group_added' || item.groupKey === null)) context.addIssue({ code: 'custom', message: 'Group activity has an invalid kind.' });
  if (item.source === 'summary' && item.kind !== 'additional_activity') context.addIssue({ code: 'custom', message: 'Summary activity has an invalid kind.' });
  if (item.source === 'commit' && (item.kind === 'group_invitation_received' || item.kind === 'group_added' || item.kind === 'additional_activity')) context.addIssue({ code: 'custom', message: 'Commit activity has an invalid kind.' });
  const expectedDestination = item.kind === 'expense_added' || item.kind === 'expense_updated' ? 'expense'
    : item.kind === 'spending_plan_updated' || item.kind === 'spending_plan_removed' ? 'spending'
      : item.kind === 'settlement_recorded' || item.kind === 'settlement_confirmed' || item.kind === 'settlement_deleted' ? 'balances'
        : item.kind === 'group_invitation_received' ? 'groups'
          : 'overview';
  if (item.destination.kind !== expectedDestination) context.addIssue({ code: 'custom', message: 'Activity destination does not match its kind.' });
});

const checkpointSchema = z.object({
  repositoryId: positiveId,
  groupKey: normalizedGroupKey,
  headCommitSha: sha.nullable(),
  initializedAt: instant,
  lastCheckedAt: instant,
}).strict();

const localReceiptSchema = z.object({
  repositoryId: positiveId,
  groupKey: normalizedGroupKey,
  commitSha: sha,
  observedAt: instant,
}).strict();

const invitationReceiptSchema = z.object({
  invitationId: positiveId,
  lastObservedAt: instant,
  resolvedAt: instant.nullable(),
}).strict();

export const activityInboxSchema = z.object({
  version: z.literal(1),
  initializedAt: instant,
  items: z.array(itemSchema).max(100),
  checkpoints: z.array(checkpointSchema).max(500),
  localCommitReceipts: z.array(localReceiptSchema).max(500),
  seenInvitations: z.array(invitationReceiptSchema).max(500),
}).strict().superRefine((record, context) => {
  requireUnique(record.items.map((item) => item.id), 'activity item ID', context);
  requireUnique(record.checkpoints.map((item) => String(item.repositoryId)), 'checkpoint repository', context);
  requireUnique(record.checkpoints.map((item) => item.groupKey), 'checkpoint group key', context);
  requireUnique(record.localCommitReceipts.map((item) => `${item.groupKey}:${item.commitSha}`), 'local commit receipt', context);
  requireUnique(record.seenInvitations.map((item) => String(item.invitationId)), 'invitation receipt', context);
});

export function parseActivityInbox(input: unknown): ActivityInboxV1 {
  return activityInboxSchema.parse(input) as ActivityInboxV1;
}

function requireUnique(values: readonly string[], label: string, context: z.RefinementCtx) {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message: `Duplicate ${label}.` });
}
