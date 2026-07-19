import type { AccountProfile, CurrencyCode, DiscoveredGroup, ExpenseFile, Group, GroupFile, IsoInstant, PendingGroupCreation, RemoteGroupSnapshot, RepositoryRef, SettlementLedgerFile, SettlementLedgerState, SettlementPayment, SettlementValidationBasis, SpendingPlan, WritableExpense } from '@/domain/types';

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
  readGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<GroupFile>;
  createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<GroupFile>;
  refreshGroup(repository: RepositoryRef, currentLogin: string, signal?: AbortSignal): Promise<RemoteGroupSnapshot>;
  inviteMember(repository: RepositoryRef, login: string, signal?: AbortSignal): Promise<void>;
  createExpense(repository: RepositoryRef, expense: WritableExpense, signal?: AbortSignal): Promise<ExpenseFile>;
  readExpense(repository: RepositoryRef, id: string, signal?: AbortSignal): Promise<ExpenseFile | null>;
  updateExpense(repository: RepositoryRef, current: ExpenseFile, expense: WritableExpense, signal?: AbortSignal): Promise<ExpenseFile>;
  deleteExpense(repository: RepositoryRef, current: ExpenseFile, signal?: AbortSignal): Promise<void>;
  updateSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, signal?: AbortSignal): Promise<GroupFile>;
  readSettlementLedger(repository: RepositoryRef, currency: CurrencyCode, signal?: AbortSignal): Promise<SettlementLedgerState>;
  recordSettlementPayment(repository: RepositoryRef, current: SettlementLedgerState, intended: SettlementPayment, basis: SettlementValidationBasis, signal?: AbortSignal): Promise<SettlementLedgerFile>;
  confirmSettlementPayment(repository: RepositoryRef, current: SettlementLedgerFile, paymentId: string, recipient: string, confirmedAt: IsoInstant, signal?: AbortSignal): Promise<SettlementLedgerFile>;
  deleteSettlementPayment(repository: RepositoryRef, current: SettlementLedgerFile, paymentId: string, signal?: AbortSignal): Promise<SettlementLedgerState>;
  recoverPendingGroup?(pending: PendingGroupCreation, signal?: AbortSignal): Promise<void>;
}
