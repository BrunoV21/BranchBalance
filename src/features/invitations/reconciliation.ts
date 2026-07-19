import type { DiscoveredGroup, PendingGroupInvitation } from '@/domain/types';

export type InvitationDecisionReconciliation =
  | { kind: 'still_open' }
  | { kind: 'accepted'; group: DiscoveredGroup }
  | { kind: 'resolved_decline' }
  | { kind: 'unknown' }
  | { kind: 'unavailable' };

export function reconcileInvitationDecision(
  intended: { invitation: PendingGroupInvitation; action: 'accept' | 'decline' },
  openInvitations: readonly PendingGroupInvitation[],
  discoveredGroups: readonly DiscoveredGroup[] | null,
): InvitationDecisionReconciliation {
  const sameId = openInvitations.find((candidate) => candidate.id === intended.invitation.id);
  if (sameId) return sameId.repository.id === intended.invitation.repository.id ? { kind: 'still_open' } : { kind: 'unavailable' };
  if (intended.action === 'decline') return { kind: 'resolved_decline' };
  if (discoveredGroups === null) return { kind: 'unknown' };
  const group = discoveredGroups.find((candidate) => candidate.repository.id === intended.invitation.repository.id);
  return group ? { kind: 'accepted', group } : { kind: 'unavailable' };
}
