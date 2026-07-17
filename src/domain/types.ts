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
  created_by: string;
  created_at: IsoInstant;
}

export interface Expense {
  schema_version: 1;
  id: string;
  description: string;
  amount_minor: number;
  currency: CurrencyCode;
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

export interface ExpenseFile {
  expense: Expense;
  blobSha: string;
  path: `expenses/${string}.json`;
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

export interface MemberBalance {
  login: string;
  totalPaidMinor: number;
  totalShareMinor: number;
  netMinor: number;
  currentMember: boolean;
}

export interface BalanceResult {
  totalSpentMinor: number;
  members: MemberBalance[];
  zeroSum: boolean;
}

export interface Settlement {
  from: string;
  to: string;
  amountMinor: number;
}

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
  members: Member[];
  pendingMembers: PendingMember[] | null;
  expenses: ExpenseFile[];
  balances: BalanceResult;
  settlements: Settlement[];
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
