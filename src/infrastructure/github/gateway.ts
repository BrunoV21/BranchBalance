import { calculateBalances, simplifySettlements, sortExpenses } from '@/domain/balances';
import { decodeUtf8Base64, encodeUtf8Base64, serializeJson } from '@/domain/codec';
import { AppFailure, DomainValidationError } from '@/domain/errors';
import { parseExpenseDocument, parseGroupDocument, parseSpendingPlan } from '@/domain/schemas';
import { deriveFuelAnalytics } from '@/domain/analytics';
import { effectiveGroupType } from '@/domain/groups';
import { deriveSettlementReservations, parseSettlementLedgerDocument, parseSettlementPayment, settlementCreationMatches, sortSettlementPayments } from '@/domain/settlements';
import { deriveSpendingSummary, systemLocalCalendar, type LocalCalendar } from '@/domain/spending';
import { groupKey, normalizeLogin, type AccountProfile, type CommittedMutation, type CurrencyCode, type DataWarning, type DiscoveredGroup, type ExpenseFile, type Group, type GroupCommitSlice, type GroupFile, type InvitationDiscoveryResult, type IsoInstant, type KnownGroupType, type Member, type PendingMember, type RemoteGroupSnapshot, type RepositoryCommitRef, type RepositoryRef, type SettlementLedgerFile, type SettlementLedgerState, type SettlementPayment, type SettlementReservation, type SettlementValidationBasis, type SpendingPlan, type UnclassifiedGroupCommit, type WritableExpense } from '@/domain/types';
import type { Clock } from '@/features/auth/contracts';
import { discoverEligibleGroupInvitations } from '@/features/invitations/eligibility';

import type { DiscoveryResult, GitHubGateway } from './contracts';

export interface GitHubResponse<T> { data: T; headers: Record<string, string | undefined>; status: number }
export interface GitHubRequestClient {
  request<T = unknown>(route: string, parameters?: Record<string, unknown>): Promise<GitHubResponse<T>>;
}

type GitHubRepository = {
  id: number; name: string; private: boolean; default_branch: string;
  owner: { login: string }; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean };
};

type ContentFile = { type: 'file'; sha: string; content: string; encoding?: string };
type TreeItem = { type: 'blob' | 'tree'; path: string; sha: string };
type ContentMutationData = { content?: { sha?: string }; commit?: { sha?: string; committer?: { date?: string | null } | null } };

export class GitHubGatewayImpl implements GitHubGateway {
  private readonly profileCache = new Map<string, { name: string | null; avatarUrl: string | null; expiresAt: number }>();
  constructor(private readonly client: GitHubRequestClient, private readonly clock: Clock, private readonly calendar: LocalCalendar = systemLocalCalendar) {}

  async getCurrentAccount(signal?: AbortSignal): Promise<AccountProfile> {
    const response = await this.client.request<{ id: number; login: string; name: string | null; avatar_url: string | null }>('GET /user', { request: { signal } });
    return { id: response.data.id, login: response.data.login, name: response.data.name, avatarUrl: response.data.avatar_url };
  }

  async discoverGroups(signal?: AbortSignal): Promise<DiscoveryResult> {
    const installations = await this.paginate<{ id: number; repository_selection?: string }>('GET /user/installations', 'installations', {}, signal);
    const repositories = new Map<number, { repository: GitHubRepository; installationId: number }>();
    for (const installation of installations) {
      const page = await this.paginate<GitHubRepository>('GET /user/installations/{installation_id}/repositories', 'repositories', { installation_id: installation.id }, signal);
      for (const repository of page) repositories.set(repository.id, { repository, installationId: installation.id });
    }
    const groups: DiscoveredGroup[] = [];
    const warnings: DataWarning[] = [];
    for (const { repository, installationId } of repositories.values()) {
      if (!repository.private || !repository.name.startsWith('branch-balance-')) continue;
      const ref = this.mapRepository(repository, installationId);
      try {
        const groupFile = await this.readGroup(ref, signal);
        groups.push({ key: groupKey(ref.owner, ref.name), repository: ref, group: groupFile.group, effectiveType: groupFile.effectiveType ?? effectiveGroupType(groupFile.group), summary: null });
      } catch (error) {
        warnings.push({ path: `${ref.owner}/${ref.name}/group.json`, reason: error instanceof Error ? error.message : 'Invalid group file.' });
      }
    }
    groups.sort((a, b) => a.group.name.localeCompare(b.group.name));
    return { groups, warnings, installationCount: installations.length, hasAllRepositoriesInstallation: installations.some((installation) => installation.repository_selection === 'all') };
  }

  async listGroupInvitations(currentLogin: string, signal?: AbortSignal): Promise<InvitationDiscoveryResult> {
    try {
      const rows = await this.paginate<unknown>('GET /user/repository_invitations', null, {}, signal);
      return discoverEligibleGroupInvitations(rows, currentLogin);
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'permission') throw new AppFailure({ kind: 'invitation_permission', operation: 'list' });
      throw error;
    }
  }

  async listGroupActivityCommits(repository: RepositoryRef, stopAtSha: string | null, signal?: AbortSignal): Promise<GroupCommitSlice> {
    const normalizedStop = stopAtSha?.toLowerCase() ?? null;
    if (normalizedStop !== null && !isCommitSha(normalizedStop)) throw new DomainValidationError('Invalid activity checkpoint.');
    const commits: UnclassifiedGroupCommit[] = [];
    let checkpointFound = false;
    let hasMore = false;
    try {
      for (let page = 1; page <= 2; page += 1) {
        const response = await this.client.request<unknown[]>('GET /repos/{owner}/{repo}/commits', {
          owner: repository.owner,
          repo: repository.name,
          sha: repository.defaultBranch,
          page,
          per_page: 50,
          request: { signal },
        });
        if (!Array.isArray(response.data)) throw new DomainValidationError('GitHub returned invalid commit history.');
        for (const row of response.data) {
          const parsed = parseActivityCommit(row);
          commits.push(parsed);
          if (normalizedStop && parsed.sha === normalizedStop) {
            checkpointFound = true;
            break;
          }
        }
        if (checkpointFound || response.data.length < 50) {
          hasMore = false;
          break;
        }
        hasMore = response.data.length === 50;
      }
      return { commits, checkpointFound, hasMore, warnings: [] };
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'github' && error.detail.status === 409 && /empty/i.test(error.detail.safeMessage)) {
        return { commits: [], checkpointFound: normalizedStop === null, hasMore: false, warnings: [] };
      }
      throw error;
    }
  }

  async acceptGroupInvitation(invitationId: number, signal?: AbortSignal): Promise<void> {
    await this.decideGroupInvitation(invitationId, 'accept', signal);
  }

  async declineGroupInvitation(invitationId: number, signal?: AbortSignal): Promise<void> {
    await this.decideGroupInvitation(invitationId, 'decline', signal);
  }

  private async decideGroupInvitation(invitationId: number, action: 'accept' | 'decline', signal?: AbortSignal): Promise<void> {
    if (!Number.isSafeInteger(invitationId) || invitationId <= 0) throw new DomainValidationError('A valid group invitation is required.');
    const route = action === 'accept'
      ? 'PATCH /user/repository_invitations/{invitation_id}'
      : 'DELETE /user/repository_invitations/{invitation_id}';
    try {
      const response = await this.client.request(route, { invitation_id: invitationId, request: { signal } });
      if (response.status !== 204) throw new AppFailure({ kind: 'github', status: 502, safeMessage: 'GitHub did not confirm the invitation decision.', retryable: true });
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'permission') throw new AppFailure({ kind: 'invitation_permission', operation: action });
      if (error instanceof AppFailure && (error.detail.kind === 'not_found' || (error.detail.kind === 'github' && error.detail.status === 409))) {
        throw new AppFailure({ kind: 'invitation_unavailable', invitationId });
      }
      throw error;
    }
  }

  async createPrivateRepository(slug: string, signal?: AbortSignal): Promise<RepositoryRef> {
    try {
      const response = await this.client.request<GitHubRepository>('POST /user/repos', {
        name: slug, private: true, auto_init: false, request: { signal },
      });
      return this.mapRepository(response.data, null);
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'github' && error.detail.status === 422) throw new AppFailure({ kind: 'repository_name_taken', repository: slug });
      throw error;
    }
  }

  async readGroup(repository: RepositoryRef, signal?: AbortSignal): Promise<GroupFile> {
    return (await this.readGroupResult(repository, signal)).file;
  }

  private async readGroupResult(repository: RepositoryRef, signal?: AbortSignal): Promise<{ file: GroupFile; spendingPlanWarning: string | null }> {
    const file = await this.readContent(repository, 'group.json', signal);
    const parsed = parseGroupDocument(JSON.parse(decodeUtf8Base64(file.content)));
    return { file: { group: parsed.group, blobSha: file.sha, path: 'group.json', sourceDocument: parsed.sourceDocument, sourceVersion: parsed.sourceVersion, effectiveType: parsed.effectiveType }, spendingPlanWarning: parsed.spendingPlanWarning };
  }

  async createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<CommittedMutation<GroupFile>> {
    const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: repository.owner, repo: repository.name, path: 'group.json', branch: repository.defaultBranch,
      message: 'Initialize BranchBalance group', content: encodeUtf8Base64(serializeJson(group)), request: { signal },
    });
    const sha = response.data.content?.sha;
    const value = sha ? { group, blobSha: sha, path: 'group.json' as const, sourceDocument: { ...group }, sourceVersion: group.schema_version, effectiveType: effectiveGroupType(group) } : await this.readGroup(repository, signal);
    return { value, commit: repositoryCommitFromMutation(response.data) };
  }

  async refreshGroup(repository: RepositoryRef, currentLogin: string, signal?: AbortSignal): Promise<RemoteGroupSnapshot> {
    const metadata = await this.client.request<GitHubRepository>('GET /repos/{owner}/{repo}', { owner: repository.owner, repo: repository.name, request: { signal } });
    const ref = this.mapRepository(metadata.data, repository.installationId);
    const groupResult = await this.readGroupResult(ref, signal);
    const effectiveType = groupResult.file.effectiveType ?? effectiveGroupType(groupResult.file.group);
    if (!effectiveType) {
      return {
        key: groupKey(ref.owner, ref.name), repository: ref, group: groupResult.file.group, groupFile: groupResult.file,
        effectiveType: null, members: [], pendingMembers: null, expenses: [],
        balances: { totalSpentMinor: 0, members: [], zeroSum: true }, settlements: [], settlementLedger: { kind: 'unverified' }, payments: [], reservations: [],
        spending: null, analytics: null, warnings: [{ path: 'group.json#group_type', reason: 'This group type requires a newer BranchBalance version.' }],
        syncedAt: this.clock.now().toISOString(), cacheVersion: 2,
      };
    }
    const [collaboratorData, pendingMembers, tree, settlementLedger] = await Promise.all([
      this.paginate<{ login: string; avatar_url: string | null; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }>('GET /repos/{owner}/{repo}/collaborators', null, { owner: ref.owner, repo: ref.name, affiliation: 'direct' }, signal),
      this.readPending(ref, signal),
      this.readExpenseTree(ref, signal),
      this.readSettlementLedger(ref, groupResult.file.group.currency, signal),
    ]);
    const groupFile = groupResult.file;
    const group = groupFile.group;
    let members: Member[] = collaboratorData.filter((member) => member.login.toLowerCase() === ref.owner.toLowerCase() || member.permissions?.admin || member.permissions?.maintain || member.permissions?.push)
      .map((member) => ({ login: member.login, name: null, avatarUrl: member.avatar_url, role: member.login.toLowerCase() === ref.owner.toLowerCase() ? 'owner' : 'member' }));
    if (!members.some((member) => member.login.toLowerCase() === ref.owner.toLowerCase())) members.unshift({ login: ref.owner, name: null, avatarUrl: null, role: 'owner' });
    members = await mapConcurrent(members, 4, async (member) => {
      const key = member.login.toLowerCase();
      const cached = this.profileCache.get(key);
      if (cached && cached.expiresAt > this.clock.now().getTime()) return { ...member, name: cached.name, avatarUrl: cached.avatarUrl ?? member.avatarUrl };
      try {
        const profile = await this.client.request<{ name: string | null; avatar_url: string | null }>('GET /users/{username}', { username: member.login, request: { signal } });
        const value = { name: profile.data.name, avatarUrl: profile.data.avatar_url, expiresAt: this.clock.now().getTime() + 7 * 24 * 60 * 60 * 1000 };
        this.profileCache.set(key, value);
        return { ...member, name: value.name, avatarUrl: value.avatarUrl ?? member.avatarUrl };
      } catch { return member; }
    });
    const warnings: DataWarning[] = groupResult.spendingPlanWarning ? [{ path: 'group.json#spending_plan', reason: groupResult.spendingPlanWarning }] : [];
    const files = await mapConcurrent(tree, 4, async (item): Promise<ExpenseFile | null> => {
      try {
        const response = await this.client.request<{ encoding: string; content: string }>('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
          owner: ref.owner, repo: ref.name, file_sha: item.sha, request: { signal },
        });
        const parsed = parseExpenseDocument(JSON.parse(decodeUtf8Base64(response.data.content)), item.path, group.currency, effectiveType);
        for (const reason of parsed.enrichmentWarnings) warnings.push({ path: `${item.path}#${effectiveType === 'fuel' ? 'type_data' : 'line_items'}`, reason });
        return { expense: parsed.expense, blobSha: item.sha, path: item.path as `expenses/${string}.json`, sourceDocument: parsed.sourceDocument };
      } catch (error) {
        warnings.push({ path: item.path, reason: error instanceof Error ? error.message : 'Invalid expense file.' });
        return null;
      }
    });
    const expenses = sortExpenses(files.filter((file): file is ExpenseFile => file !== null));
    const payments = settlementLedger.kind === 'ready' ? sortSettlementPayments(settlementLedger.file.payments) : [];
    if (settlementLedger.kind === 'ready') warnings.push(...settlementLedger.file.warnings);
    if (settlementLedger.kind === 'invalid') warnings.push(settlementLedger.warning);
    const balances = calculateBalances(expenses.map((file) => file.expense), payments, members);
    if (!balances.zeroSum) warnings.push({ path: 'expenses/', reason: 'Balances do not sum to zero.' });
    const settlements = balances.zeroSum && settlementLedger.kind !== 'invalid' ? simplifySettlements(balances.members) : [];
    let reservations: SettlementReservation[] = [];
    try { reservations = settlementLedger.kind === 'invalid' ? [] : deriveSettlementReservations(settlements, payments); }
    catch (error) { warnings.push({ path: 'settlements.json', reason: error instanceof Error ? error.message : 'Unable to derive pending reservations.' }); }
    let spending = null;
    try { spending = deriveSpendingSummary(expenses.map((file) => file.expense), effectiveType === 'trip' ? group.spending_plan : undefined, currentLogin, this.calendar.today()); }
    catch (error) { warnings.push({ path: 'expenses/', reason: error instanceof Error ? error.message : 'Unable to derive spending totals.' }); }
    let analytics: RemoteGroupSnapshot['analytics'] = null;
    if (spending) {
      try {
        analytics = effectiveType === 'trip'
          ? { type: 'trip' as const, spending }
          : { type: 'fuel' as const, common: spending, fuel: deriveFuelAnalytics(expenses.map((file) => file.expense), group.spending_plan, this.calendar.today(), undefined, warnings.filter((warning) => warning.path.includes('#type_data'))) };
      } catch (error) {
        warnings.push({ path: 'expenses/#analytics', reason: error instanceof Error ? error.message : 'Unable to derive type-specific analytics.' });
      }
    }
    return {
      key: groupKey(ref.owner, ref.name), repository: ref, group, groupFile, members, pendingMembers, expenses,
      effectiveType, balances, settlements, settlementLedger, payments, reservations, spending, analytics, warnings, syncedAt: this.clock.now().toISOString(), cacheVersion: 2,
    };
  }

  async inviteMember(repository: RepositoryRef, login: string, signal?: AbortSignal) {
    try {
      await this.client.request('PUT /repos/{owner}/{repo}/collaborators/{username}', {
        owner: repository.owner, repo: repository.name, username: normalizeLogin(login), permission: 'push', request: { signal },
      });
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'not_found') throw new DomainValidationError('That GitHub username could not be found.', 'login');
      if (error instanceof AppFailure && error.detail.kind === 'permission') throw new AppFailure({ kind: 'permission', operation: 'invite collaborators to this repository' });
      if (error instanceof AppFailure && error.detail.kind === 'github' && error.detail.status === 422) throw new DomainValidationError('GitHub could not create this invitation. Check the username and pending invitations.', 'login');
      throw error;
    }
  }

  async createExpense(repository: RepositoryRef, expense: WritableExpense, signal?: AbortSignal, effectiveType: KnownGroupType = 'trip'): Promise<CommittedMutation<ExpenseFile>> {
    const path = `expenses/${expense.id}.json` as const;
    validateWritableExpense(expense, path, effectiveType);
    const subject = `Add expense ${expense.id}`;
    try {
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path, branch: repository.defaultBranch,
        message: subject, content: encodeUtf8Base64(serializeJson(expense)), request: { signal },
      });
      const sha = response.data.content?.sha;
      const value = sha ? { expense, blobSha: sha, path, sourceDocument: { ...expense } } : await this.requireExpense(repository, expense.id, signal);
      return { value, commit: repositoryCommitFromMutation(response.data) };
    } catch (error) {
      if (!isRetryable(error)) throw error;
      const value = await this.readExpense(repository, expense.id, signal);
      if (!value || JSON.stringify(value.expense) !== JSON.stringify(expense)) throw error;
      return { value, commit: await this.resolveConfirmedCommit(repository, path, subject, expense.created_by, signal) };
    }
  }

  async readExpense(repository: RepositoryRef, id: string, signal?: AbortSignal): Promise<ExpenseFile | null> {
    const path = `expenses/${id}.json` as const;
    try {
      const file = await this.readContent(repository, path, signal);
      const groupFile = await this.readGroup(repository, signal);
      const type = groupFile.effectiveType ?? effectiveGroupType(groupFile.group);
      if (!type) throw new AppFailure({ kind: 'unsupported_group_type', groupType: groupFile.group.schema_version === 2 ? groupFile.group.group_type : 'unknown' });
      const parsed = parseExpenseDocument(JSON.parse(decodeUtf8Base64(file.content)), path, groupFile.group.currency, type);
      return { expense: parsed.expense, blobSha: file.sha, path, sourceDocument: parsed.sourceDocument };
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'not_found') return null;
      throw error;
    }
  }

  async updateExpense(repository: RepositoryRef, current: ExpenseFile, expense: WritableExpense, signal?: AbortSignal, effectiveType: KnownGroupType = 'trip'): Promise<CommittedMutation<ExpenseFile>> {
    const path = `expenses/${expense.id}.json` as const;
    validateWritableExpense(expense, path, effectiveType);
    const sourceDocument = mergeExpenseSource(current.sourceDocument, expense, effectiveType);
    const subject = `Update expense ${expense.id}`;
    try {
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path, branch: repository.defaultBranch, sha: current.blobSha,
        message: subject, content: encodeUtf8Base64(serializeJson(sourceDocument)), request: { signal },
      });
      return { value: { expense, blobSha: response.data.content?.sha ?? current.blobSha, path, sourceDocument }, commit: repositoryCommitFromMutation(response.data) };
    } catch (error) {
      if (isConflict(error)) throw new AppFailure({ kind: 'expense_conflict', latest: await this.readExpense(repository, expense.id, signal), operation: 'edit' });
      if (isRetryable(error)) {
        const value = await this.readExpense(repository, expense.id, signal);
        if (value && JSON.stringify(value.expense) === JSON.stringify(expense)) {
          return { value, commit: await this.resolveConfirmedCommit(repository, path, subject, expense.updated_by ?? expense.created_by, signal) };
        }
      }
      throw error;
    }
  }

  async deleteExpense(repository: RepositoryRef, current: ExpenseFile, signal?: AbortSignal): Promise<CommittedMutation<null>> {
    const expense = current.expense;
    const subject = `Delete expense ${expense.id}`;
    try {
      const response = await this.client.request<ContentMutationData>('DELETE /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: `expenses/${expense.id}.json`, branch: repository.defaultBranch, sha: current.blobSha,
        message: subject, request: { signal },
      });
      return { value: null, commit: repositoryCommitFromMutation(response.data) };
    } catch (error) {
      if (isConflict(error)) throw new AppFailure({ kind: 'expense_conflict', latest: await this.readExpense(repository, expense.id, signal), operation: 'delete' });
      if ((isRetryable(error) || (error instanceof AppFailure && error.detail.kind === 'not_found')) && await this.readExpense(repository, expense.id, signal) === null) {
        const commit = isRetryable(error)
          ? await this.resolveConfirmedCommit(repository, `expenses/${expense.id}.json`, subject, expense.updated_by ?? expense.created_by, signal)
          : null;
        return { value: null, commit };
      }
      throw error;
    }
  }

  async readSettlementLedger(repository: RepositoryRef, currency: CurrencyCode, signal?: AbortSignal): Promise<SettlementLedgerState> {
    let content: ContentFile;
    try { content = await this.readContent(repository, 'settlements.json', signal); }
    catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'not_found') return { kind: 'missing', payments: [] };
      throw error;
    }
    try {
      const parsed = parseSettlementLedgerDocument(JSON.parse(decodeUtf8Base64(content.content)), currency);
      return { kind: 'ready', file: { ...parsed, blobSha: content.sha, path: 'settlements.json' } };
    } catch (error) {
      return {
        kind: 'invalid',
        warning: { path: 'settlements.json', reason: error instanceof DomainValidationError ? error.message : 'Settlement ledger is not valid JSON.' },
      };
    }
  }

  async recordSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerState,
    intended: SettlementPayment,
    basis: SettlementValidationBasis,
    signal?: AbortSignal,
  ): Promise<CommittedMutation<SettlementLedgerFile>> {
    return this.writeSettlementPayment(repository, current, intended, basis, signal, true);
  }

  private async writeSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerState,
    intended: SettlementPayment,
    basis: SettlementValidationBasis,
    signal: AbortSignal | undefined,
    allowSafeRetry: boolean,
  ): Promise<CommittedMutation<SettlementLedgerFile>> {
    if (current.kind === 'unverified' || current.kind === 'invalid') throw new AppFailure({ kind: 'settlement_ledger_invalid' });
    if (intended.status !== 'pending' || intended.confirmed_by !== null || intended.confirmed_at !== null) {
      throw new DomainValidationError('New settlement payments must be pending.');
    }
    parseSettlementPayment(intended, intended.currency);
    if (intended.currency !== basis.currency) throw new DomainValidationError('Payment currency does not match its group.');
    if (intended.paid_on > this.calendar.today()) throw new DomainValidationError('Payment date cannot be in the future.');
    const currentPayments = current.kind === 'ready' ? current.file.payments : [];
    const existing = currentPayments.find((payment) => payment.id === intended.id);
    if (existing) {
      if (settlementCreationMatches(existing, intended) && current.kind === 'ready') return { value: current.file, commit: null };
      throw new AppFailure({ kind: 'settlement_record_conflict' });
    }
    if (current.kind === 'ready' && hasRawPaymentId(current.file, intended.id)) throw new AppFailure({ kind: 'settlement_record_conflict' });
    this.requireAvailableSettlement(intended, basis, currentPayments);
    const sourceDocument = current.kind === 'ready'
      ? { ...current.file.sourceDocument, payments: [...sourcePayments(current.file), intended] }
      : { schema_version: 1, payments: [intended] };
    const serialized = serializeSettlementLedger(sourceDocument);
    const subject = `Record settlement payment ${intended.id}`;
    try {
      const parameters: Record<string, unknown> = {
        owner: repository.owner, repo: repository.name, path: 'settlements.json', branch: repository.defaultBranch,
        message: subject, content: encodeUtf8Base64(serialized), request: { signal },
      };
      if (current.kind === 'ready') parameters.sha = current.file.blobSha;
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', parameters);
      const sha = response.data.content?.sha;
      if (sha) return { value: settlementFileFromSource(sourceDocument, sha, intended.currency), commit: repositoryCommitFromMutation(response.data) };
      const confirmed = await this.readSettlementLedger(repository, intended.currency, signal);
      if (confirmed.kind === 'ready') {
        const remote = confirmed.file.payments.find((payment) => payment.id === intended.id);
        if (remote && settlementCreationMatches(remote, intended)) return { value: confirmed.file, commit: null };
      }
      throw new AppFailure({ kind: 'settlement_record_conflict' });
    } catch (error) {
      if (!(isConflict(error) || isRetryable(error))) throw error;
      const latest = await this.readSettlementLedger(repository, intended.currency, signal);
      if (latest.kind === 'ready') {
        const remote = latest.file.payments.find((payment) => payment.id === intended.id);
        if (remote) {
          if (settlementCreationMatches(remote, intended)) return { value: latest.file, commit: await this.resolveConfirmedCommit(repository, 'settlements.json', subject, intended.recorded_by, signal) };
          throw new AppFailure({ kind: 'settlement_record_conflict' });
        }
        if (hasRawPaymentId(latest.file, intended.id)) throw new AppFailure({ kind: 'settlement_record_conflict' });
      }
      if (latest.kind === 'invalid' || latest.kind === 'unverified') throw new AppFailure({ kind: 'settlement_ledger_invalid' });
      const availableMinor = this.availableSettlementAmount(intended, basis, latest.kind === 'ready' ? latest.file.payments : []);
      if (availableMinor < intended.amount_minor) throw new AppFailure({ kind: 'settlement_stale', availableMinor });
      if (allowSafeRetry) return this.writeSettlementPayment(repository, latest, intended, basis, signal, false);
      throw new AppFailure({ kind: 'settlement_stale', availableMinor });
    }
  }

  async confirmSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    recipient: string,
    confirmedAt: IsoInstant,
    signal?: AbortSignal,
  ): Promise<CommittedMutation<SettlementLedgerFile>> {
    return this.writeSettlementConfirmation(repository, current, paymentId, recipient, confirmedAt, signal, true);
  }

  private async writeSettlementConfirmation(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    recipient: string,
    confirmedAt: IsoInstant,
    signal: AbortSignal | undefined,
    allowSafeRetry: boolean,
  ): Promise<CommittedMutation<SettlementLedgerFile>> {
    const payment = current.payments.find((item) => item.id === paymentId);
    if (!payment) throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
    if (normalizeLogin(payment.to) !== normalizeLogin(recipient)) throw new AppFailure({ kind: 'settlement_confirmation_unauthorized' });
    if (payment.status === 'confirmed') {
      if (payment.confirmed_by && normalizeLogin(payment.confirmed_by) === normalizeLogin(recipient)) return { value: current, commit: null };
      throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
    }
    if (Date.parse(confirmedAt) < Date.parse(payment.recorded_at)) throw new DomainValidationError('Confirmation time cannot predate the payment record.');
    const rawPayments = sourcePayments(current);
    const matchingIndexes = rawPayments.flatMap((raw, index) => isRecord(raw) && raw.id === paymentId ? [index] : []);
    if (matchingIndexes.length !== 1) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
    const targetIndex = matchingIndexes[0]!;
    const sourceDocument = {
      ...current.sourceDocument,
      payments: rawPayments.map((raw, index) => index === targetIndex
        ? { ...(raw as Record<string, unknown>), status: 'confirmed', confirmed_by: recipient.trim(), confirmed_at: confirmedAt }
        : raw),
    };
    const serialized = serializeSettlementLedger(sourceDocument);
    const subject = `Confirm settlement payment ${paymentId}`;
    try {
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: 'settlements.json', branch: repository.defaultBranch, sha: current.blobSha,
        message: subject, content: encodeUtf8Base64(serialized), request: { signal },
      });
      const sha = response.data.content?.sha;
      if (sha) return { value: settlementFileFromSource(sourceDocument, sha, payment.currency), commit: repositoryCommitFromMutation(response.data) };
      const confirmed = await this.readSettlementLedger(repository, payment.currency, signal);
      if (confirmed.kind === 'ready') {
        const remote = confirmed.file.payments.find((item) => item.id === paymentId);
        if (remote?.status === 'confirmed' && settlementCreationMatches(remote, payment) && normalizeLogin(remote.confirmed_by ?? '') === normalizeLogin(recipient)) return { value: confirmed.file, commit: null };
      }
      throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
    } catch (error) {
      if (!(isConflict(error) || isRetryable(error))) throw error;
      const latest = await this.readSettlementLedger(repository, payment.currency, signal);
      if (latest.kind !== 'ready') throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
      const remote = latest.file.payments.find((item) => item.id === paymentId);
      if (!remote || !settlementCreationMatches(remote, payment)) throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
      if (remote.status === 'confirmed') {
        if (normalizeLogin(remote.confirmed_by ?? '') === normalizeLogin(recipient)) return { value: latest.file, commit: await this.resolveConfirmedCommit(repository, 'settlements.json', subject, recipient, signal) };
        throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
      }
      if (allowSafeRetry) return this.writeSettlementConfirmation(repository, latest.file, paymentId, recipient, confirmedAt, signal, false);
      throw new AppFailure({ kind: 'settlement_confirmation_conflict' });
    }
  }

  async deleteSettlementPayment(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    signal?: AbortSignal,
  ): Promise<CommittedMutation<SettlementLedgerState>> {
    return this.writeSettlementDeletion(repository, current, paymentId, signal, true);
  }

  private async writeSettlementDeletion(
    repository: RepositoryRef,
    current: SettlementLedgerFile,
    paymentId: string,
    signal: AbortSignal | undefined,
    allowSafeRetry: boolean,
  ): Promise<CommittedMutation<SettlementLedgerState>> {
    const targetPayment = current.payments.find((payment) => payment.id === paymentId);
    if (!targetPayment) {
      if (hasRawPaymentId(current, paymentId)) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
      return { value: { kind: 'ready', file: current }, commit: null };
    }
    const rawPayments = sourcePayments(current);
    const matchingIndexes = rawPayments.flatMap((raw, index) => isRecord(raw) && raw.id === paymentId ? [index] : []);
    if (matchingIndexes.length !== 1) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
    const targetIndex = matchingIndexes[0]!;
    const sourceDocument = { ...current.sourceDocument, payments: rawPayments.filter((_, index) => index !== targetIndex) };
    const serialized = serializeSettlementLedger(sourceDocument);
    const subject = `Delete settlement payment ${paymentId}`;
    try {
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: 'settlements.json', branch: repository.defaultBranch, sha: current.blobSha,
        message: subject, content: encodeUtf8Base64(serialized), request: { signal },
      });
      const sha = response.data.content?.sha;
      if (sha) return { value: { kind: 'ready', file: settlementFileFromSource(sourceDocument, sha, targetPayment.currency) }, commit: repositoryCommitFromMutation(response.data) };
      const confirmed = await this.readSettlementLedger(repository, targetPayment.currency, signal);
      if (confirmed.kind === 'missing') return { value: confirmed, commit: null };
      if (confirmed.kind === 'ready' && !confirmed.file.payments.some((payment) => payment.id === paymentId)) {
        if (hasRawPaymentId(confirmed.file, paymentId)) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
        return { value: confirmed, commit: null };
      }
      throw new AppFailure({ kind: 'settlement_record_conflict' });
    } catch (error) {
      if (!(isConflict(error) || isRetryable(error))) throw error;
      const latest = await this.readSettlementLedger(repository, targetPayment.currency, signal);
      if (latest.kind === 'missing') return { value: latest, commit: await this.resolveConfirmedCommit(repository, 'settlements.json', subject, null, signal) };
      if (latest.kind === 'invalid' || latest.kind === 'unverified') throw new AppFailure({ kind: 'settlement_ledger_invalid' });
      if (!latest.file.payments.some((payment) => payment.id === paymentId)) {
        if (hasRawPaymentId(latest.file, paymentId)) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
        return { value: latest, commit: await this.resolveConfirmedCommit(repository, 'settlements.json', subject, null, signal) };
      }
      if (allowSafeRetry) return this.writeSettlementDeletion(repository, latest.file, paymentId, signal, false);
      throw new AppFailure({ kind: 'settlement_record_conflict' });
    }
  }

  private requireAvailableSettlement(intended: SettlementPayment, basis: SettlementValidationBasis, payments: SettlementPayment[]) {
    const availableMinor = this.availableSettlementAmount(intended, basis, payments);
    if (availableMinor < intended.amount_minor) throw new AppFailure({ kind: 'settlement_stale', availableMinor });
  }

  private availableSettlementAmount(intended: SettlementPayment, basis: SettlementValidationBasis, payments: SettlementPayment[]): number {
    const balances = calculateBalances(basis.expenses, payments, basis.members);
    if (!balances.zeroSum) return 0;
    const suggestions = simplifySettlements(balances.members);
    const reservations = deriveSettlementReservations(suggestions, payments);
    return reservations.find((item) => normalizeLogin(item.from) === normalizeLogin(intended.from) && normalizeLogin(item.to) === normalizeLogin(intended.to))?.availableToRecordMinor ?? 0;
  }

  async updateSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, signal?: AbortSignal, requestedType?: KnownGroupType): Promise<CommittedMutation<GroupFile>> {
    const type = requestedType ?? current.effectiveType ?? effectiveGroupType(current.group);
    if (!type) throw new AppFailure({ kind: 'unsupported_group_type', groupType: current.group.schema_version === 2 ? current.group.group_type : 'unknown' });
    return this.writeSpendingPlan(repository, current, normalizePlanForWrite(next, type), type, signal, true);
  }

  private async writeSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, type: KnownGroupType, signal: AbortSignal | undefined, allowSafeRetry: boolean): Promise<CommittedMutation<GroupFile>> {
    const sourceDocument = { ...current.sourceDocument };
    sourceDocument.schema_version = 2;
    sourceDocument.group_type = type;
    if (next) sourceDocument.spending_plan = next;
    else delete sourceDocument.spending_plan;
    const subject = next ? 'Update spending plan' : 'Remove spending plan';
    try {
      const response = await this.client.request<ContentMutationData>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: 'group.json', branch: repository.defaultBranch, sha: current.blobSha,
        message: subject, content: encodeUtf8Base64(serializeJson(sourceDocument)), request: { signal },
      });
      const sha = response.data.content?.sha;
      if (sha) {
        const parsed = parseGroupDocument(sourceDocument);
        return { value: { group: parsed.group, blobSha: sha, path: 'group.json', sourceDocument, sourceVersion: parsed.sourceVersion, effectiveType: parsed.effectiveType }, commit: repositoryCommitFromMutation(response.data) };
      }
      const confirmed = await this.readGroup(repository, signal);
      requireUnchangedGroupType(confirmed, type);
      if (spendingPlanMatches(confirmed, next)) return { value: confirmed, commit: null };
      throw new AppFailure({ kind: 'spending_plan_conflict', latest: confirmed, submitted: next });
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'spending_plan_conflict') throw error;
      if (isConflict(error)) {
        const latest = await this.readGroup(repository, signal);
        requireUnchangedGroupType(latest, type);
        throw new AppFailure({ kind: 'spending_plan_conflict', latest, submitted: next });
      }
      if (isRetryable(error)) {
        const latest = await this.readGroup(repository, signal);
        requireUnchangedGroupType(latest, type);
        if (spendingPlanMatches(latest, next)) {
          return { value: latest, commit: await this.resolveConfirmedCommit(repository, 'group.json', subject, next?.updated_by ?? null, signal) };
        }
        if (latest.blobSha === current.blobSha) {
          if (allowSafeRetry) return this.writeSpendingPlan(repository, latest, next, type, signal, false);
          throw error;
        }
        throw new AppFailure({ kind: 'spending_plan_conflict', latest, submitted: next });
      }
      throw error;
    }
  }

  private async requireExpense(repository: RepositoryRef, id: string, signal?: AbortSignal) {
    const file = await this.readExpense(repository, id, signal);
    if (!file) throw new AppFailure({ kind: 'github', status: 502, safeMessage: 'GitHub did not confirm the expense write.', retryable: true });
    return file;
  }

  private async resolveConfirmedCommit(
    repository: RepositoryRef,
    path: string,
    subject: string,
    expectedLogin: string | null,
    signal?: AbortSignal,
  ): Promise<RepositoryCommitRef | null> {
    try {
      const response = await this.client.request<unknown[]>('GET /repos/{owner}/{repo}/commits', {
        owner: repository.owner,
        repo: repository.name,
        sha: repository.defaultBranch,
        path,
        page: 1,
        per_page: 10,
        request: { signal },
      });
      if (!Array.isArray(response.data)) return null;
      const normalizedExpected = expectedLogin ? normalizeLogin(expectedLogin) : null;
      const matches = response.data.flatMap((row) => {
        try {
          const parsed = parseActivityCommit(row);
          const actorMatches = normalizedExpected === null || parsed.authorLogin === normalizedExpected;
          return parsed.firstMessageLine === subject && actorMatches ? [{ sha: parsed.sha, committedAt: parsed.committedAt }] : [];
        } catch {
          return [];
        }
      });
      return matches.length === 1 ? matches[0]! : null;
    } catch {
      return null;
    }
  }

  private async readContent(repository: RepositoryRef, path: string, signal?: AbortSignal): Promise<ContentFile> {
    const response = await this.client.request<ContentFile>('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: repository.owner, repo: repository.name, path, ref: repository.defaultBranch, request: { signal },
    });
    if (response.data.type !== 'file' || !response.data.content) throw new DomainValidationError(`${path} is not a file.`);
    return response.data;
  }

  private async readPending(repository: RepositoryRef, signal?: AbortSignal): Promise<PendingMember[] | null> {
    if (!repository.canAdmin) return null;
    try {
      const rows = await this.paginate<{ invitee?: { login?: string; avatar_url?: string | null } }>('GET /repos/{owner}/{repo}/invitations', null, { owner: repository.owner, repo: repository.name }, signal);
      return rows.flatMap((row) => row.invitee?.login ? [{ login: row.invitee.login, avatarUrl: row.invitee.avatar_url ?? null }] : []);
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'permission') return null;
      throw error;
    }
  }

  private async readExpenseTree(repository: RepositoryRef, signal?: AbortSignal): Promise<TreeItem[]> {
    let response = await this.client.request<{ truncated: boolean; tree: TreeItem[] }>('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
      owner: repository.owner, repo: repository.name, tree_sha: repository.defaultBranch, recursive: '1', request: { signal },
    });
    if (response.data.truncated) {
      const root = await this.client.request<{ truncated: boolean; tree: TreeItem[] }>('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner: repository.owner, repo: repository.name, tree_sha: repository.defaultBranch, request: { signal },
      });
      const expensesTree = root.data.tree.find((item) => item.type === 'tree' && item.path === 'expenses');
      if (!expensesTree) return [];
      response = await this.client.request<{ truncated: boolean; tree: TreeItem[] }>('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
        owner: repository.owner, repo: repository.name, tree_sha: expensesTree.sha, recursive: '1', request: { signal },
      });
      if (response.data.truncated) throw new AppFailure({ kind: 'repository_too_large' });
      return response.data.tree.filter((item) => item.type === 'blob' && /^[-0-9a-f]{36}\.json$/i.test(item.path)).map((item) => ({ ...item, path: `expenses/${item.path}` }));
    }
    return response.data.tree.filter((item) => item.type === 'blob' && /^expenses\/[0-9a-f-]{36}\.json$/i.test(item.path));
  }

  private async paginate<T>(route: string, collection: string | null, parameters: Record<string, unknown>, signal?: AbortSignal): Promise<T[]> {
    const result: T[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.client.request<T[] | Record<string, unknown>>(route, { ...parameters, page, per_page: 100, request: { signal } });
      const items = (collection ? (response.data as Record<string, unknown>)[collection] : response.data) as T[];
      result.push(...items);
      if (items.length < 100) return result;
    }
  }

  private mapRepository(repository: GitHubRepository, installationId: number | null): RepositoryRef {
    return {
      id: repository.id, owner: repository.owner.login, name: repository.name, defaultBranch: repository.default_branch,
      installationId, private: true, canAdmin: Boolean(repository.permissions?.admin),
      canWrite: Boolean(repository.permissions?.admin || repository.permissions?.maintain || repository.permissions?.push),
    };
  }
}

function spendingPlanMatches(file: GroupFile, intended: SpendingPlan | null): boolean {
  if (intended === null) return !Object.prototype.hasOwnProperty.call(file.sourceDocument, 'spending_plan');
  return JSON.stringify(file.group.spending_plan) === JSON.stringify(intended);
}

function normalizePlanForWrite(next: SpendingPlan | null, type: KnownGroupType): SpendingPlan | null {
  if (next === null) return null;
  if (type === 'fuel') {
    if (!('kind' in next) || next.kind !== 'fuel_monthly') throw new AppFailure({ kind: 'plan_type_mismatch' });
    return parseSpendingPlan(next, 'fuel', 2);
  }
  if ('kind' in next && next.kind === 'fuel_monthly') throw new AppFailure({ kind: 'plan_type_mismatch' });
  const candidate = 'kind' in next ? next : { ...next, kind: 'trip' as const };
  return parseSpendingPlan(candidate, 'trip', 2);
}

function validateWritableExpense(expense: WritableExpense, path: string, type: KnownGroupType): void {
  const parsed = parseExpenseDocument(expense, path, expense.currency, type);
  if (parsed.enrichmentWarnings.length) throw new DomainValidationError(parsed.enrichmentWarnings[0] ?? 'Expense enrichment is invalid.');
  if (type === 'fuel' && expense.category !== 'transport') throw new DomainValidationError('Fuel expenses must use the Transport category.');
}

function mergeExpenseSource(source: Record<string, unknown>, expense: WritableExpense, type: KnownGroupType): Record<string, unknown> {
  const next: Record<string, unknown> = { ...source, ...expense };
  if (type === 'trip') {
    delete next.type_data;
    if (expense.line_items?.length) next.line_items = expense.line_items;
    else delete next.line_items;
  } else {
    delete next.line_items;
    if (expense.type_data) {
      const previous = isRecord(source.type_data) ? source.type_data : {};
      next.type_data = { ...previous, ...expense.type_data };
    } else delete next.type_data;
  }
  return next;
}

function requireUnchangedGroupType(file: GroupFile, expected: KnownGroupType): void {
  const actual = file.effectiveType ?? effectiveGroupType(file.group);
  if (actual !== expected) throw new AppFailure({ kind: 'group_type_changed' });
}

function isRetryable(error: unknown): boolean {
  return error instanceof AppFailure && 'retryable' in error.detail && error.detail.retryable;
}


function isConflict(error: unknown) {
  return error instanceof AppFailure && error.detail.kind === 'github' && (error.detail.status === 409 || error.detail.status === 422);
}

function settlementFileFromSource(sourceDocument: Record<string, unknown>, blobSha: string, currency: CurrencyCode): SettlementLedgerFile {
  const parsed = parseSettlementLedgerDocument(sourceDocument, currency);
  return { ...parsed, blobSha, path: 'settlements.json' };
}

function sourcePayments(file: SettlementLedgerFile): unknown[] {
  const payments = file.sourceDocument.payments;
  if (!Array.isArray(payments)) throw new AppFailure({ kind: 'settlement_ledger_invalid' });
  return payments;
}

function hasRawPaymentId(file: SettlementLedgerFile, paymentId: string): boolean {
  return sourcePayments(file).some((raw) => isRecord(raw) && typeof raw.id === 'string' && raw.id.trim().toLowerCase() === paymentId.toLowerCase());
}

function serializeSettlementLedger(sourceDocument: Record<string, unknown>): string {
  const serialized = serializeJson(sourceDocument);
  const byteLength = unescape(encodeURIComponent(serialized)).length;
  if (byteLength > 1_000_000) throw new AppFailure({ kind: 'settlement_ledger_capacity' });
  return serialized;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

function isCommitSha(input: string): boolean {
  return /^[0-9a-f]{40,64}$/.test(input);
}

function repositoryCommitFromMutation(input: ContentMutationData): RepositoryCommitRef | null {
  const sha = typeof input.commit?.sha === 'string' ? input.commit.sha.toLowerCase() : '';
  if (!isCommitSha(sha)) return null;
  const rawDate = input.commit?.committer?.date;
  const parsedDate = typeof rawDate === 'string' ? Date.parse(rawDate) : Number.NaN;
  return { sha, committedAt: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null };
}

function parseActivityCommit(input: unknown): UnclassifiedGroupCommit {
  if (!isRecord(input) || typeof input.sha !== 'string' || !isCommitSha(input.sha.toLowerCase()) || !isRecord(input.commit) || typeof input.commit.message !== 'string') {
    throw new DomainValidationError('GitHub returned invalid commit history.');
  }
  const rawAuthor = isRecord(input.author) && typeof input.author.login === 'string' ? normalizeLogin(input.author.login) : '';
  const author = /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/.test(rawAuthor) && rawAuthor.length <= 39 ? rawAuthor : null;
  const committer = isRecord(input.commit.committer) ? input.commit.committer : null;
  const rawDate = committer && typeof committer.date === 'string' ? committer.date : null;
  const parsedDate = rawDate ? Date.parse(rawDate) : Number.NaN;
  const firstMessageLine = input.commit.message.split(/\r?\n/, 1)[0] ?? '';
  return {
    sha: input.sha.toLowerCase(),
    firstMessageLine,
    authorLogin: author,
    committedAt: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
  };
}

async function mapConcurrent<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      output[index] = await mapper(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}
