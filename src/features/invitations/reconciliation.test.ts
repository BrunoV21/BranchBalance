import type { DiscoveredGroup, PendingGroupInvitation } from '@/domain/types';

import { reconcileInvitationDecision } from './reconciliation';

const invitation = {
  id: 10,
  repository: { id: 20, owner: 'maya', ownerType: 'User' as const, name: 'branch-balance-trip', fullName: 'maya/branch-balance-trip', private: true as const },
  invitee: 'bruno', inviter: 'maya', permission: 'write' as const, createdAt: '2026-07-19T12:00:00.000Z', provisionalName: 'Trip',
} satisfies PendingGroupInvitation;
const group = {
  key: 'maya/branch-balance-trip', repository: { id: 20, owner: 'maya', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 1, private: true, canAdmin: false, canWrite: true },
  group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'maya', created_at: '2026-07-19T10:00:00.000Z' }, summary: null,
} satisfies DiscoveredGroup;

describe('invitation decision reconciliation', () => {
  it('classifies an unchanged open invitation', () => {
    expect(reconcileInvitationDecision({ invitation, action: 'accept' }, [invitation], [])).toEqual({ kind: 'still_open' });
  });

  it('treats a reused invitation ID for another repository as unavailable', () => {
    const changed = { ...invitation, repository: { ...invitation.repository, id: 99 } };
    expect(reconcileInvitationDecision({ invitation, action: 'accept' }, [changed], [group])).toEqual({ kind: 'unavailable' });
  });

  it('confirms acceptance by numeric repository ID', () => {
    expect(reconcileInvitationDecision({ invitation, action: 'accept' }, [], [group])).toEqual({ kind: 'accepted', group });
  });

  it('keeps an acceptance unknown when group discovery failed', () => {
    expect(reconcileInvitationDecision({ invitation, action: 'accept' }, [], null)).toEqual({ kind: 'unknown' });
  });

  it('does not guess acceptance when the invitation and valid group are both absent', () => {
    expect(reconcileInvitationDecision({ invitation, action: 'accept' }, [], [])).toEqual({ kind: 'unavailable' });
  });

  it('resolves a decline from authoritative invitation absence', () => {
    expect(reconcileInvitationDecision({ invitation, action: 'decline' }, [], null)).toEqual({ kind: 'resolved_decline' });
  });
});
