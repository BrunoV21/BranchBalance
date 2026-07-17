import type { AccountProfile, DiscoveredGroup, Expense, ExpenseFile, Group, PendingGroupCreation, RemoteGroupSnapshot, RepositoryRef } from '@/domain/types';

export interface DiscoveryResult {
  groups: DiscoveredGroup[];
  warnings: { path: string; reason: string }[];
  installationCount: number;
  hasAllRepositoriesInstallation: boolean;
}

export interface GitHubGateway {
  getCurrentAccount(signal?: AbortSignal): Promise<AccountProfile>;
  discoverGroups(signal?: AbortSignal): Promise<DiscoveryResult>;
  createPrivateRepository(slug: string, signal?: AbortSignal): Promise<RepositoryRef>;
  readGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<Group>;
  createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<void>;
  refreshGroup(repository: RepositoryRef, currentLogin: string, signal?: AbortSignal): Promise<RemoteGroupSnapshot>;
  inviteMember(repository: RepositoryRef, login: string, signal?: AbortSignal): Promise<void>;
  createExpense(repository: RepositoryRef, expense: Expense, signal?: AbortSignal): Promise<ExpenseFile>;
  readExpense(repository: RepositoryRef, id: string, signal?: AbortSignal): Promise<ExpenseFile | null>;
  updateExpense(repository: RepositoryRef, expense: Expense, sha: string, signal?: AbortSignal): Promise<ExpenseFile>;
  deleteExpense(repository: RepositoryRef, expense: Expense, sha: string, signal?: AbortSignal): Promise<void>;
  recoverPendingGroup?(pending: PendingGroupCreation, signal?: AbortSignal): Promise<void>;
}
