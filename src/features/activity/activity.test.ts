import type { DiscoveredGroup, GroupCommitSlice, PendingGroupInvitation, UnclassifiedGroupCommit } from '@/domain/types';

import { classifyCommitSubject } from './commit-classifier';
import { clearActivity, emptyActivityInbox, markActivityRead, reconcileActivity, recordLocalCommit } from './model';
import { parseActivityInbox } from './schema';

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const LOCAL_SHA = '3'.repeat(40);
const UUID = '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234';
const NOW = '2026-07-19T12:00:00.000Z';

const group = (id = 1, name = 'Trip'): DiscoveredGroup => ({
  key: `owner/branch-balance-${name.toLowerCase()}`,
  repository: { id, owner: 'owner', name: `branch-balance-${name.toLowerCase()}`, defaultBranch: 'trunk', installationId: 10, private: true, canAdmin: true, canWrite: true },
  group: { schema_version: 1, name, currency: 'EUR', created_by: 'owner', created_at: '2026-07-01T00:00:00.000Z' },
  summary: null,
});

const commit = (sha: string, firstMessageLine: string, authorLogin = 'friend', committedAt = '2026-07-19T11:00:00.000Z'): UnclassifiedGroupCommit => ({
  sha, firstMessageLine, authorLogin, committedAt,
});

const slice = (commits: UnclassifiedGroupCommit[], checkpointFound = false): GroupCommitSlice => ({ commits, checkpointFound, hasMore: false, warnings: [] });

describe('activity commit classification', () => {
  it.each([
    [`Add expense ${UUID}`, 'expense_added', 'expense'],
    [`Update expense ${UUID}`, 'expense_updated', 'expense'],
    [`Delete expense ${UUID}`, 'expense_deleted', 'overview'],
    ['Update spending plan', 'spending_plan_updated', undefined],
    ['Remove spending plan', 'spending_plan_removed', undefined],
    [`Record settlement payment ${UUID}`, 'settlement_recorded', undefined],
    [`Confirm settlement payment ${UUID}`, 'settlement_confirmed', undefined],
    [`Delete settlement payment ${UUID}`, 'settlement_deleted', undefined],
    ['Initialize BranchBalance group', 'group_created', undefined],
  ])('maps %s safely', (subject, kind, destination) => {
    const result = classifyCommitSubject(subject);
    expect(result).toMatchObject({ kind, recognized: true });
    if (destination === 'expense') expect(result.resourceId).toBe(UUID);
  });

  it.each([
    `Add expense ${UUID} extra`,
    ` add expense ${UUID}`,
    `ADD EXPENSE ${UUID}`,
    'Update spending plan\nInjected notification text',
    'Dinner was €90',
  ])('maps untrusted subject %s to a generic update', (subject) => {
    expect(classifyCommitSubject(subject)).toEqual({ kind: 'group_updated', recognized: false });
  });
});

describe('activity reconciliation', () => {
  it('creates a read first-run baseline without an unread dot', () => {
    const currentGroup = group();
    const commits = Array.from({ length: 24 }, (_, index) => commit(
      (index + 10).toString(16).padStart(40, '0'),
      `Add expense ${index.toString(16).padStart(8, '0')}-2b1d-4a3a-9c3e-9d2f9a0b1234`,
      'friend',
      `2026-07-${String(19 - Math.floor(index / 4)).padStart(2, '0')}T11:00:00.000Z`,
    ));
    const result = reconcileActivity({ current: null, groups: [currentGroup], commits: new Map([[currentGroup.key, slice(commits)]]), invitations: [], observedAt: NOW });

    expect(result.items).toHaveLength(20);
    expect(result.items.every((item) => item.readAt === NOW)).toBe(true);
    expect(result.checkpoints[0]?.headCommitSha).toBe(commits[0]?.sha);
  });

  it('creates one unread remote item even when the actor matches the signed-in account', () => {
    const currentGroup = group();
    const baseline = reconcileActivity({ current: null, groups: [currentGroup], commits: new Map([[currentGroup.key, slice([commit(OLD_SHA, 'Initialize BranchBalance group', 'owner')])]]), invitations: [], observedAt: NOW });
    const later = reconcileActivity({
      current: baseline,
      groups: [currentGroup],
      commits: new Map([[currentGroup.key, slice([commit(NEW_SHA, `Update expense ${UUID}`, 'owner'), commit(OLD_SHA, 'Initialize BranchBalance group', 'owner')], true)]]),
      invitations: [],
      observedAt: '2026-07-19T13:00:00.000Z',
    });

    expect(later.items.find((item) => item.sourceId === NEW_SHA)).toMatchObject({ kind: 'expense_updated', actorLogin: 'owner', readAt: null });
  });

  it('suppresses a locally observed commit after clear until its checkpoint passes', () => {
    const currentGroup = group();
    const baseline = reconcileActivity({ current: null, groups: [currentGroup], commits: new Map([[currentGroup.key, slice([commit(OLD_SHA, 'Initialize BranchBalance group')])]]), invitations: [], observedAt: NOW });
    const local = recordLocalCommit(baseline, currentGroup, 'expense_added', { sha: LOCAL_SHA, committedAt: NOW }, NOW, UUID, 'owner');
    const cleared = clearActivity(local);
    const refreshed = reconcileActivity({
      current: cleared,
      groups: [currentGroup],
      commits: new Map([[currentGroup.key, slice([commit(LOCAL_SHA, `Add expense ${UUID}`, 'owner'), commit(OLD_SHA, 'Initialize BranchBalance group')], true)]]),
      invitations: [],
      observedAt: '2026-07-19T13:00:00.000Z',
    });

    expect(refreshed.items).toEqual([]);
    expect(refreshed.checkpoints[0]?.headCommitSha).toBe(LOCAL_SHA);
    expect(refreshed.localCommitReceipts).toEqual([]);
  });

  it('uses one neutral summary when the checkpoint is unreachable', () => {
    const currentGroup = group();
    const current = emptyActivityInbox(NOW);
    current.checkpoints.push({ repositoryId: 1, groupKey: currentGroup.key, headCommitSha: OLD_SHA, initializedAt: NOW, lastCheckedAt: NOW });
    const result = reconcileActivity({ current, groups: [currentGroup], commits: new Map([[currentGroup.key, slice([commit(NEW_SHA, 'External edit')])]]), invitations: [], observedAt: '2026-07-19T13:00:00.000Z' });

    expect(result.items.map((item) => item.kind)).toEqual(['additional_activity', 'group_updated']);
    expect(result.checkpoints[0]?.headCommitSha).toBe(NEW_SHA);
  });

  it('baselines existing invitations and reports a later eligible invitation once', () => {
    const existing = invitation(40, 'Existing');
    const next = invitation(41, 'Lisbon weekend');
    const baseline = reconcileActivity({ current: null, groups: [], commits: new Map(), invitations: [existing], observedAt: NOW });
    const observed = reconcileActivity({ current: baseline, groups: [], commits: new Map(), invitations: [existing, next], observedAt: '2026-07-19T13:00:00.000Z' });
    const repeated = reconcileActivity({ current: observed, groups: [], commits: new Map(), invitations: [existing, next], observedAt: '2026-07-19T14:00:00.000Z' });

    expect(observed.items).toHaveLength(1);
    expect(observed.items[0]).toMatchObject({ id: 'invitation:41', kind: 'group_invitation_received', readAt: null });
    expect(repeated.items).toHaveLength(1);
  });

  it('marks only rendered IDs read and validates the complete local record', () => {
    const current = emptyActivityInbox(NOW);
    current.items.push({
      id: 'group:1:added', source: 'group', sourceId: '1', repositoryId: 1, groupKey: group().key, groupName: 'Trip', kind: 'group_added',
      destination: { kind: 'overview' }, actorLogin: null, eventAt: NOW, observedAt: NOW, readAt: null,
    });
    const read = markActivityRead(current, ['group:1:added'], '2026-07-19T12:01:00.000Z');

    expect(parseActivityInbox(read)).toEqual(read);
    expect(read.items[0]?.readAt).toBe('2026-07-19T12:01:00.000Z');
    expect(() => parseActivityInbox({ ...read, items: [...read.items, read.items[0]] })).toThrow();
  });
});

function invitation(id: number, provisionalName: string): PendingGroupInvitation {
  return {
    id,
    repository: { id: 100 + id, owner: 'owner', ownerType: 'User', name: `branch-balance-${id}`, fullName: `owner/branch-balance-${id}`, private: true },
    invitee: 'friend', inviter: 'owner', permission: 'write', createdAt: '2026-07-19T10:00:00.000Z', provisionalName,
  };
}
