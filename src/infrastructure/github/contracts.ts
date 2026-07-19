import type { AccountProfile, CommittedMutation, CurrencyCode, DiscoveredGroup, ExpenseFile, Group, GroupCommitSlice, GroupFile, InvitationDiscoveryResult, IsoInstant, PendingGroupCreation, RemoteGroupSnapshot, RepositoryRef, SettlementLedgerFile, SettlementLedgerState, SettlementPayment, SettlementValidationBasis, SpendingPlan, WritableExpense } from '@/domain/types';

export interface DiscoveryResult {
  groups: DiscoveredGroup[];
  warnings: { path: string; reason: string }[];
  installationCount: number;
  hasAllRepositoriesInstallation: boolean;
}

export interface GitHubGateway {
  getCurrentAccount(signal?: AbortSignal): Promise<AccountProfile>;
  discoverGroups(signal?: AbortSignal): Promise<DiscoveryResult>;
  listGroupActivityCommits(repository: RepositoryRef, stopAtSha: string | null, signal?: AbortSignal): Promise<GroupCommitSlice>;
  listGroupInvitations(currentLogin: string, signal?: AbortSignal): Promise<InvitationDiscoveryResult>;
  acceptGroupInvitation(invitationId: number, signal?: AbortSignal): Promise<void>;
  declineGroupInvitation(invitationId: number, signal?: AbortSignal): Promise<void>;
  createPrivateRepository(slug: string, signal?: AbortSignal): Promise<RepositoryRef>;
  readGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<GroupFile>;
  createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<CommittedMutation<GroupFile>>;
  refreshGroup(repository: RepositoryRef, currentLogin: string, signal?: AbortSignal): Promise<RemoteGroupSnapshot>;
  inviteMember(repository: RepositoryRef, login: string, signal?: AbortSignal): Promise<void>;
  createExpense(repository: RepositoryRef, expense: WritableExpense, signal?: AbortSignal): Promise<CommittedMutation<ExpenseFile>>;
  readExpense(repository: RepositoryRef, id: string, signal?: AbortSignal): Promise<ExpenseFile | null>;
  updateExpense(repository: RepositoryRef, current: ExpenseFile, expense: WritableExpense, signal?: AbortSignal): Promise<CommittedMutation<ExpenseFile>>;
  deleteExpense(repository: RepositoryRef, current: ExpenseFile, signal?: AbortSignal): Promise<CommittedMutation<null>>;
  updateSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, signal?: AbortSignal): Promise<CommittedMutation<GroupFile>>;
  readSettlementLedger(repository: RepositoryRef, currency: CurrencyCode, signal?: AbortSignal): Promise<SettlementLedgerState>;
  recordSettlementPayment(repository: RepositoryRef, current: SettlementLedgerState, intended: SettlementPayment, basis: SettlementValidationBasis, signal?: AbortSignal): Promise<CommittedMutation<SettlementLedgerFile>>;
  confirmSettlementPayment(repository: RepositoryRef, current: SettlementLedgerFile, paymentId: string, recipient: string, confirmedAt: IsoInstant, signal?: AbortSignal): Promise<CommittedMutation<SettlementLedgerFile>>;
  deleteSettlementPayment(repository: RepositoryRef, current: SettlementLedgerFile, paymentId: string, signal?: AbortSignal): Promise<CommittedMutation<SettlementLedgerState>>;
  recoverPendingGroup?(pending: PendingGroupCreation, signal?: AbortSignal): Promise<void>;
}
