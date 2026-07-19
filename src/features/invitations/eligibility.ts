import { normalizeLogin, type DataWarning, type GroupInvitationPermission, type InvitationDiscoveryResult, type PendingGroupInvitation } from '@/domain/types';

const GROUP_REPOSITORY_PREFIX = 'branch-balance-';
const permissionRank = { read: 0, triage: 1, write: 2, maintain: 3, admin: 4 } as const;

export function discoverEligibleGroupInvitations(rows: readonly unknown[], currentLogin: string): InvitationDiscoveryResult {
  const warnings: DataWarning[] = [];
  const byId = new Map<number, PendingGroupInvitation>();
  const conflictedIds = new Set<number>();

  rows.forEach((row, index) => {
    const path = `repository-invitation[${index}]`;
    const invitation = parseInvitation(row, currentLogin);
    if (!invitation) {
      warnings.push({ path, reason: 'Skipped a malformed or ineligible group invitation.' });
      return;
    }
    if (conflictedIds.has(invitation.id)) return;
    const existing = byId.get(invitation.id);
    if (!existing) {
      byId.set(invitation.id, invitation);
      return;
    }
    if (sameInvitation(existing, invitation)) return;
    byId.delete(invitation.id);
    conflictedIds.add(invitation.id);
    warnings.push({ path: `repository-invitation[id=${invitation.id}]`, reason: 'Skipped conflicting records for one invitation.' });
  });

  const invitations = [...byId.values()].sort((left, right) => {
    const byDate = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    if (byDate) return byDate;
    const byRepository = left.repository.fullName.localeCompare(right.repository.fullName, undefined, { sensitivity: 'base' });
    return byRepository || left.id - right.id;
  });
  return { invitations, warnings };
}

export function provisionalGroupName(repositoryName: string): string {
  const suffix = repositoryName.startsWith(GROUP_REPOSITORY_PREFIX) ? repositoryName.slice(GROUP_REPOSITORY_PREFIX.length) : repositoryName;
  const words = suffix.replace(/-+/g, ' ').trim();
  if (!words) return repositoryName;
  return words.replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function parseInvitation(input: unknown, currentLogin: string): PendingGroupInvitation | null {
  if (!isRecord(input) || !isPositiveSafeInteger(input.id) || !isRecord(input.repository) || !isRecord(input.invitee) || !isRecord(input.inviter)) return null;
  const repository = input.repository;
  if (!isPositiveSafeInteger(repository.id) || !isNonEmpty(repository.name) || !isNonEmpty(repository.full_name) || repository.private !== true || !isRecord(repository.owner)) return null;
  if (!isNonEmpty(repository.owner.login) || repository.owner.type !== 'User' || !repository.name.startsWith(GROUP_REPOSITORY_PREFIX)) return null;
  if (`${repository.owner.login}/${repository.name}`.toLowerCase() !== repository.full_name.toLowerCase()) return null;
  if (!isNonEmpty(input.invitee.login) || normalizeLogin(input.invitee.login) !== normalizeLogin(currentLogin)) return null;
  if (!isNonEmpty(input.inviter.login) || !isNonEmpty(input.permissions) || !isEligiblePermission(input.permissions)) return null;
  if (!isNonEmpty(input.created_at) || !isValidInstant(input.created_at)) return null;
  return {
    id: input.id,
    repository: {
      id: repository.id,
      owner: repository.owner.login.trim(),
      ownerType: 'User',
      name: repository.name.trim(),
      fullName: repository.full_name.trim(),
      private: true,
    },
    invitee: normalizeLogin(input.invitee.login),
    inviter: normalizeLogin(input.inviter.login),
    permission: input.permissions,
    createdAt: new Date(input.created_at).toISOString(),
    provisionalName: provisionalGroupName(repository.name.trim()),
  };
}

function isEligiblePermission(value: string): value is GroupInvitationPermission {
  return value in permissionRank && permissionRank[value as keyof typeof permissionRank] >= permissionRank.write;
}

function sameInvitation(left: PendingGroupInvitation, right: PendingGroupInvitation): boolean {
  return left.repository.id === right.repository.id
    && left.repository.fullName.toLowerCase() === right.repository.fullName.toLowerCase()
    && left.invitee === right.invitee
    && left.inviter === right.inviter
    && left.permission === right.permission
    && left.createdAt === right.createdAt;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isPositiveSafeInteger(input: unknown): input is number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input > 0;
}

function isNonEmpty(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0;
}

function isValidInstant(input: string): boolean {
  return Number.isFinite(Date.parse(input));
}
