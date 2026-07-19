import type { CategoryBucket, ExpenseCategory, PaymentMethod, PaymentMethodBucket } from './spending/catalog';

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
export type SplitType = 'equal' | 'full';
export type IsoInstant = string;
export type CalendarDate = string;
export type GroupKey = `${string}/${string}`;

export interface AccountProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface RepositoryRef {
  id: number;
  owner: string;
  name: string;
  defaultBranch: string;
  installationId: number | null;
  private: true;
  canAdmin: boolean;
  canWrite: boolean;
}

export interface Group {
  schema_version: 1;
  name: string;
  currency: CurrencyCode;
  spending_plan?: SpendingPlan;
  created_by: string;
  created_at: IsoInstant;
}

export interface SpendingPlan {
  budget_minor?: number;
  category_budgets_minor?: Partial<Record<ExpenseCategory, number>>;
  starts_on?: CalendarDate;
  ends_on?: CalendarDate;
  updated_by: string;
  updated_at: IsoInstant;
}

export interface GroupFile {
  group: Group;
  blobSha: string;
  path: 'group.json';
  sourceDocument: Record<string, unknown>;
}

export interface Expense {
  schema_version: 1;
  id: string;
  description: string;
  amount_minor: number;
  currency: CurrencyCode;
  category: ExpenseCategory | null;
  payment_method: PaymentMethod | null;
  paid_by: string;
  split_type: SplitType;
  participants: string[];
  shares_minor: Record<string, number>;
  expense_date: CalendarDate;
  created_by: string;
  created_at: IsoInstant;
  updated_by: string | null;
  updated_at: IsoInstant | null;
}

export type WritableExpense = Omit<Expense, 'category' | 'payment_method'> & {
  category: ExpenseCategory;
  payment_method: PaymentMethod;
};

export interface ExpenseFile {
  expense: Expense;
  blobSha: string;
  path: `expenses/${string}.json`;
  sourceDocument: Record<string, unknown>;
}

export interface Member {
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: 'owner' | 'member';
}

export interface PendingMember {
  login: string;
  avatarUrl: string | null;
}

export type GroupInvitationPermission = 'write' | 'maintain' | 'admin';

export interface PendingGroupInvitation {
  id: number;
  repository: {
    id: number;
    owner: string;
    ownerType: 'User';
    name: string;
    fullName: string;
    private: true;
  };
  invitee: string;
  inviter: string;
  permission: GroupInvitationPermission;
  createdAt: IsoInstant;
  provisionalName: string;
}

export interface InvitationDiscoveryResult {
  invitations: PendingGroupInvitation[];
  warnings: DataWarning[];
}

export interface AcceptedInvitationPendingDiscovery {
  invitationId: number;
  repositoryId: number;
  repositoryFullName: string;
  provisionalName: string;
  acceptedAt: IsoInstant;
  reason: 'not_loadable' | 'discovery_failed';
}

export interface ConfirmedInvitationDecision {
  invitationId: number;
  repositoryId: number;
  action: 'accept' | 'decline';
  confirmedAt: IsoInstant;
}

export interface MemberBalance {
  login: string;
  totalPaidMinor: number;
  totalShareMinor: number;
  settlementSentMinor: number;
  settlementReceivedMinor: number;
  netMinor: number;
  currentMember: boolean;
}

export interface BalanceResult {
  totalSpentMinor: number;
  members: MemberBalance[];
  zeroSum: boolean;
}

export interface SuggestedSettlement {
  from: string;
  to: string;
  amountMinor: number;
}

export interface SettlementPayment {
  id: string;
  from: string;
  to: string;
  amount_minor: number;
  currency: CurrencyCode;
  paid_on: CalendarDate;
  note?: string;
  status: 'pending' | 'confirmed';
  recorded_by: string;
  recorded_at: IsoInstant;
  confirmed_by: string | null;
  confirmed_at: IsoInstant | null;
}

export interface SettlementReservation {
  from: string;
  to: string;
  pendingMinor: number;
  availableToRecordMinor: number;
}

export interface SettlementLedgerFile {
  payments: SettlementPayment[];
  blobSha: string;
  path: 'settlements.json';
  sourceDocument: Record<string, unknown>;
  warnings: DataWarning[];
}

export type SettlementLedgerState =
  | { kind: 'unverified' }
  | { kind: 'missing'; payments: [] }
  | { kind: 'ready'; file: SettlementLedgerFile }
  | { kind: 'invalid'; warning: DataWarning };

export interface SettlementValidationBasis {
  currency: CurrencyCode;
  expenses: Expense[];
  members: Member[];
}

/** @deprecated Recorded transfers use SettlementPayment; calculated advice uses SuggestedSettlement. */
export type Settlement = SuggestedSettlement;

export interface DataWarning {
  path: string;
  reason: string;
}

export interface GroupSummary {
  currency: CurrencyCode;
  currentUserBalanceMinor: number;
  memberCount: number;
  expenseCount: number;
  syncedAt: IsoInstant;
}

export interface SpendingSummary {
  totalSpentMinor: number;
  currentUserPaidMinor: number;
  currentUserShareMinor: number;
  categorySpentMinor: Record<CategoryBucket, number>;
  paymentMethodSpentMinor: Record<PaymentMethodBucket, number>;
  budget: null | {
    budgetMinor: number;
    remainingMinor: number;
    status: 'under' | 'at' | 'over';
    percentageUsed: number;
    categoryLimits: Partial<Record<ExpenseCategory, {
      limitMinor: number;
      spentMinor: number;
      remainingMinor: number;
      status: 'under' | 'at' | 'over';
      percentageUsed: number;
    }>>;
  };
  trip: null | {
    phase: 'before' | 'during' | 'after';
    totalDays: number;
    currentDay: number | null;
    availableDays: number;
    dailyAvailableMinor: number | null;
  };
}

export interface DiscoveredGroup {
  key: GroupKey;
  repository: RepositoryRef;
  group: Group;
  summary: GroupSummary | null;
}

export interface RemoteGroupSnapshot {
  key: GroupKey;
  repository: RepositoryRef;
  group: Group;
  groupFile: GroupFile | null;
  members: Member[];
  pendingMembers: PendingMember[] | null;
  expenses: ExpenseFile[];
  balances: BalanceResult;
  settlements: SuggestedSettlement[];
  settlementLedger?: SettlementLedgerState;
  payments?: SettlementPayment[];
  reservations?: SettlementReservation[];
  spending: SpendingSummary | null;
  warnings: DataWarning[];
  syncedAt: IsoInstant;
}

export interface StoredCredentialV1 {
  version: 1;
  accessToken: string;
  accessTokenExpiresAt: IsoInstant;
  refreshToken: string;
  refreshTokenExpiresAt: IsoInstant;
}

export interface PendingGroupCreation {
  repository: RepositoryRef;
  group: Group;
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function groupKey(owner: string, repo: string): GroupKey {
  return `${normalizeLogin(owner)}/${repo.trim().toLowerCase()}`;
}
