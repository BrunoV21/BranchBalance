import type { CategoryBucket, ExpenseCategory, PaymentMethod, PaymentMethodBucket } from './spending/catalog';

export type CurrencyCode = 'EUR' | 'USD' | 'GBP';
export type SplitType = 'equal' | 'full';
export type IsoInstant = string;
export type CalendarDate = string;
export type GroupKey = `${string}/${string}`;
export type KnownGroupType = 'trip' | 'fuel';
export type ReceiptProfileId = 'generic_v1' | 'fuel_v1';
export type MonthKey = `${number}-${string}`;

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

export interface LegacyTripPlan {
  budget_minor?: number;
  category_budgets_minor?: Partial<Record<ExpenseCategory, number>>;
  starts_on?: CalendarDate;
  ends_on?: CalendarDate;
  updated_by: string;
  updated_at: IsoInstant;
}

export interface TripPlanV2 {
  kind: 'trip';
  budget_minor?: number;
  category_budgets_minor?: Partial<Record<ExpenseCategory, number>>;
  starts_on: CalendarDate;
  ends_on: CalendarDate;
  updated_by: string;
  updated_at: IsoInstant;
}

export interface FuelMonthlyLimit {
  effective_month: MonthKey;
  limit_minor: number;
}

export interface FuelMonthlyPlanV2 {
  kind: 'fuel_monthly';
  monthly_limits: FuelMonthlyLimit[];
  budget_minor?: undefined;
  category_budgets_minor?: undefined;
  starts_on?: undefined;
  ends_on?: undefined;
  updated_by: string;
  updated_at: IsoInstant;
}

export type SpendingPlan = LegacyTripPlan | TripPlanV2 | FuelMonthlyPlanV2;
export type TypedSpendingPlan = TripPlanV2 | FuelMonthlyPlanV2;

export interface GroupV1 {
  schema_version: 1;
  name: string;
  currency: CurrencyCode;
  spending_plan?: LegacyTripPlan;
  created_by: string;
  created_at: IsoInstant;
}

export interface KnownGroupV2 {
  schema_version: 2;
  group_type: KnownGroupType;
  name: string;
  currency: CurrencyCode;
  spending_plan?: TypedSpendingPlan;
  created_by: string;
  created_at: IsoInstant;
}

export interface UnsupportedGroupV2 {
  schema_version: 2;
  group_type: string;
  name: string;
  currency: CurrencyCode;
  spending_plan?: undefined;
  created_by: string;
  created_at: IsoInstant;
}

export type Group = GroupV1 | KnownGroupV2 | UnsupportedGroupV2;

export interface GroupFile {
  group: Group;
  blobSha: string;
  path: 'group.json';
  sourceDocument: Record<string, unknown>;
  sourceVersion?: 1 | 2;
  effectiveType?: KnownGroupType | null;
}

export interface ExpenseLineItem {
  description: string;
  quantity?: string;
  unit_price_minor?: number;
  line_total_minor: number;
}

export type FuelType = 'petrol' | 'diesel' | 'lpg' | 'other';

export interface FuelExpenseDataV1 {
  schema_version: 1;
  type: 'fuel';
  volume_millilitres: number;
  /** Local wall-clock date/time printed on the receipt; no timezone is implied. */
  receipt_datetime?: string;
  unit_price_micros_per_litre?: number;
  gross_amount_minor?: number;
  discount_minor?: number;
  fuel_type?: FuelType;
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
  line_items?: ExpenseLineItem[];
  type_data?: FuelExpenseDataV1;
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
  sourceSchemaVersion?: 1 | 2;
  effectiveType?: KnownGroupType | null;
  totalSpentMinor?: number;
  currentMonth?: MonthKey;
  currentMonthSpentMinor?: number;
  currentMonthLimitMinor?: number | null;
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
  analytics: SpendingAnalytics;
}

export interface DailySpendingBucket {
  date: CalendarDate;
  amountMinor: number;
}

export interface SpendingPaceAnalytics {
  actualToDateMinor: number;
  evenPaceMinor: number;
  deltaMinor: number;
  direction: 'below' | 'on' | 'above';
  elapsedDays: number;
  totalDays: number;
  events: { date: CalendarDate; cumulativeMinor: number }[];
  referenceEvents: { date: CalendarDate; cumulativeMinor: number }[];
}

export type SpendingInsight =
  | { kind: 'pace'; actualToDateMinor: number; evenPaceMinor: number; deltaMinor: number; direction: SpendingPaceAnalytics['direction'] }
  | { kind: 'budget_overage'; overMinor: number }
  | { kind: 'category_overage'; category: ExpenseCategory; overMinor: number; spentMinor: number; limitMinor: number }
  | { kind: 'largest_category'; category: CategoryBucket; spentMinor: number; sharePercentage: number }
  | { kind: 'funding_gap'; gapMinor: number }
  | { kind: 'highest_day'; date: CalendarDate; amountMinor: number }
  | { kind: 'scope_split'; sharedMinor: number; justMeMinor: number };

export interface SpendingAnalytics {
  today: CalendarDate;
  daily: {
    buckets: DailySpendingBucket[];
    period: null | { startsOn: CalendarDate; endsOn: CalendarDate; totalDays: number };
    preTripMinor: number;
    afterTripMinor: number;
    futureDatedMinor: number;
    distinctExpenseDateCount: number;
  };
  pace: SpendingPaceAnalytics | null;
  categoryMix: { category: CategoryBucket; spentMinor: number; sharePercentage: number }[];
  scopeMix: { sharedMinor: number; justMeMinor: number };
  insights: SpendingInsight[];
}

export interface Rational {
  numerator: number;
  denominator: number;
}

export interface FuelMonthSummary {
  month: MonthKey;
  paidMinor: number;
  applicableLimitMinor: number | null;
  remainingMinor: number | null;
  status: 'no_limit' | 'under' | 'at' | 'over';
  expenseCount: number;
  representedVolumeMl: number;
  expensesWithVolume: number;
  weightedPaidPrice: Rational | null;
  explicitDiscountMinor: number;
  expensesWithExplicitDiscount: number;
  futureDatedMinor: number;
}

export interface FuelStationSummary {
  key: string;
  label: string;
  paidMinor: number;
  representedVolumeMl: number;
  expenseCount: number;
}

export interface FuelCoverage {
  expenseCount: number;
  withValidFuelData: number;
  withVolume: number;
  withPrintedPrice: number;
  withGross: number;
  withExplicitDiscount: number;
}

export interface FuelAnalytics {
  selectedMonth: FuelMonthSummary;
  monthlySeries: FuelMonthSummary[];
  stationRows: FuelStationSummary[];
  coverage: FuelCoverage;
  warnings: DataWarning[];
}

export type TypedGroupAnalytics =
  | { type: 'trip'; spending: SpendingSummary }
  | { type: 'fuel'; common: SpendingSummary; fuel: FuelAnalytics };

export interface ExpenseFundingAnalytics {
  scaleMaxMinor: number;
  rows: {
    login: string;
    paidMinor: number;
    shareMinor: number;
    gapMinor: number;
    currentMember: boolean;
  }[];
}

export interface DiscoveredGroup {
  key: GroupKey;
  repository: RepositoryRef;
  group: Group;
  summary: GroupSummary | null;
  effectiveType?: KnownGroupType | null;
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
  effectiveType?: KnownGroupType | null;
  analytics?: TypedGroupAnalytics | null;
  cacheVersion?: 2;
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

export type ActivityKind =
  | 'expense_added'
  | 'expense_updated'
  | 'expense_deleted'
  | 'spending_plan_updated'
  | 'spending_plan_removed'
  | 'settlement_recorded'
  | 'settlement_confirmed'
  | 'settlement_deleted'
  | 'group_created'
  | 'group_updated'
  | 'group_invitation_received'
  | 'group_added'
  | 'additional_activity';

export type ActivityDestination =
  | { kind: 'groups' }
  | { kind: 'overview' }
  | { kind: 'expense'; expenseId: string }
  | { kind: 'spending' }
  | { kind: 'balances' };

export interface ActivityItem {
  id: string;
  source: 'commit' | 'invitation' | 'group' | 'summary';
  sourceId: string;
  repositoryId: number;
  groupKey: GroupKey | null;
  groupName: string;
  kind: ActivityKind;
  destination: ActivityDestination;
  actorLogin: string | null;
  eventAt: IsoInstant;
  observedAt: IsoInstant;
  readAt: IsoInstant | null;
}

export interface ActivityCheckpoint {
  repositoryId: number;
  groupKey: GroupKey;
  headCommitSha: string | null;
  initializedAt: IsoInstant;
  lastCheckedAt: IsoInstant;
}

export interface LocalCommitReceipt {
  repositoryId: number;
  groupKey: GroupKey;
  commitSha: string;
  observedAt: IsoInstant;
}

export interface SeenInvitationReceipt {
  invitationId: number;
  lastObservedAt: IsoInstant;
  resolvedAt: IsoInstant | null;
}

export interface ActivityInboxV1 {
  version: 1;
  initializedAt: IsoInstant;
  items: ActivityItem[];
  checkpoints: ActivityCheckpoint[];
  localCommitReceipts: LocalCommitReceipt[];
  seenInvitations: SeenInvitationReceipt[];
}

export interface UnclassifiedGroupCommit {
  sha: string;
  firstMessageLine: string;
  authorLogin: string | null;
  committedAt: IsoInstant | null;
}

export interface GroupCommitSlice {
  commits: UnclassifiedGroupCommit[];
  checkpointFound: boolean;
  hasMore: boolean;
  warnings: DataWarning[];
}

export interface RepositoryCommitRef {
  sha: string;
  committedAt: IsoInstant | null;
}

export interface CommittedMutation<T> {
  value: T;
  commit: RepositoryCommitRef | null;
}

export function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

export function groupKey(owner: string, repo: string): GroupKey {
  return `${normalizeLogin(owner)}/${repo.trim().toLowerCase()}`;
}
