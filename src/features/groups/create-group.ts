import { AppFailure, DomainValidationError } from '@/domain/errors';
import { createRepositoryName } from '@/domain/slug';
import { groupKey, type CommittedMutation, type CurrencyCode, type DiscoveredGroup, type Group, type KnownGroupType, type RepositoryRef } from '@/domain/types';
import type { Clock } from '@/features/auth/contracts';
import type { GitHubGateway } from '@/infrastructure/github/contracts';
import type { SnapshotStore } from '@/infrastructure/storage/contracts';

export async function createGroupRepository(input: {
  gateway: GitHubGateway;
  store: SnapshotStore;
  accountId: number;
  login: string;
  name: string;
  currency: CurrencyCode;
  groupType?: KnownGroupType;
  canCreate: boolean;
  clock: Clock;
}): Promise<CommittedMutation<DiscoveredGroup>> {
  if (!input.canCreate) throw new DomainValidationError('Install BranchBalance with access to all repositories before creating a group.');
  const name = input.name.trim();
  if (!name) throw new DomainValidationError('Group name is required.', 'name');
  const groupType = input.groupType ?? 'trip';
  const group: Group = { schema_version: 2, group_type: groupType, name, currency: input.currency, created_by: input.login, created_at: input.clock.now().toISOString() };
  let repository: RepositoryRef;
  try { repository = await input.gateway.createPrivateRepository(createRepositoryName(name)); }
  catch (error) {
    if (error instanceof AppFailure && 'retryable' in error.detail && error.detail.retryable) {
      throw new AppFailure({ kind: 'github', status: 0, safeMessage: 'GitHub did not confirm whether the repository was created. Check your repositories before retrying with this name.', retryable: false });
    }
    throw error;
  }
  let initialized;
  try { initialized = await input.gateway.createGroupFile(repository, group); }
  catch {
    await input.store.writePendingGroup(input.accountId, { repository, group });
    throw new AppFailure({ kind: 'partial_group_creation', repository });
  }
  return { value: { key: groupKey(repository.owner, repository.name), repository, group, effectiveType: groupType, summary: null }, commit: initialized.commit };
}
