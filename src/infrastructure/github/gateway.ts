import { calculateBalances, simplifySettlements, sortExpenses } from '@/domain/balances';
import { decodeUtf8Base64, encodeUtf8Base64, serializeJson } from '@/domain/codec';
import { AppFailure, DomainValidationError } from '@/domain/errors';
import { parseExpenseDocument, parseGroupDocument } from '@/domain/schemas';
import { deriveSpendingSummary, systemLocalCalendar, type LocalCalendar } from '@/domain/spending';
import { groupKey, normalizeLogin, type AccountProfile, type DataWarning, type DiscoveredGroup, type ExpenseFile, type Group, type GroupFile, type Member, type PendingMember, type RemoteGroupSnapshot, type RepositoryRef, type SpendingPlan, type WritableExpense } from '@/domain/types';
import type { Clock } from '@/features/auth/contracts';

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
        groups.push({ key: groupKey(ref.owner, ref.name), repository: ref, group: groupFile.group, summary: null });
      } catch (error) {
        warnings.push({ path: `${ref.owner}/${ref.name}/group.json`, reason: error instanceof Error ? error.message : 'Invalid group file.' });
      }
    }
    groups.sort((a, b) => a.group.name.localeCompare(b.group.name));
    return { groups, warnings, installationCount: installations.length, hasAllRepositoriesInstallation: installations.some((installation) => installation.repository_selection === 'all') };
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
    return { file: { group: parsed.group, blobSha: file.sha, path: 'group.json', sourceDocument: parsed.sourceDocument }, spendingPlanWarning: parsed.spendingPlanWarning };
  }

  async createGroupFile(repository: RepositoryRef, group: Group, signal?: AbortSignal): Promise<GroupFile> {
    const response = await this.client.request<{ content?: { sha?: string } }>('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: repository.owner, repo: repository.name, path: 'group.json', branch: repository.defaultBranch,
      message: 'Initialize BranchBalance group', content: encodeUtf8Base64(serializeJson(group)), request: { signal },
    });
    const sha = response.data.content?.sha;
    return sha ? { group, blobSha: sha, path: 'group.json', sourceDocument: { ...group } } : this.readGroup(repository, signal);
  }

  async refreshGroup(repository: RepositoryRef, currentLogin: string, signal?: AbortSignal): Promise<RemoteGroupSnapshot> {
    const metadata = await this.client.request<GitHubRepository>('GET /repos/{owner}/{repo}', { owner: repository.owner, repo: repository.name, request: { signal } });
    const ref = this.mapRepository(metadata.data, repository.installationId);
    const [groupResult, collaboratorData, pendingMembers, tree] = await Promise.all([
      this.readGroupResult(ref, signal),
      this.paginate<{ login: string; avatar_url: string | null; permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } }>('GET /repos/{owner}/{repo}/collaborators', null, { owner: ref.owner, repo: ref.name, affiliation: 'direct' }, signal),
      this.readPending(ref, signal),
      this.readExpenseTree(ref, signal),
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
        const parsed = parseExpenseDocument(JSON.parse(decodeUtf8Base64(response.data.content)), item.path, group.currency);
        return { expense: parsed.expense, blobSha: item.sha, path: item.path as `expenses/${string}.json`, sourceDocument: parsed.sourceDocument };
      } catch (error) {
        warnings.push({ path: item.path, reason: error instanceof Error ? error.message : 'Invalid expense file.' });
        return null;
      }
    });
    const expenses = sortExpenses(files.filter((file): file is ExpenseFile => file !== null));
    const balances = calculateBalances(expenses.map((file) => file.expense), members);
    if (!balances.zeroSum) warnings.push({ path: 'expenses/', reason: 'Balances do not sum to zero.' });
    const settlements = balances.zeroSum ? simplifySettlements(balances.members) : [];
    let spending = null;
    try { spending = deriveSpendingSummary(expenses.map((file) => file.expense), group.spending_plan, currentLogin, this.calendar.today()); }
    catch (error) { warnings.push({ path: 'expenses/', reason: error instanceof Error ? error.message : 'Unable to derive spending totals.' }); }
    return {
      key: groupKey(ref.owner, ref.name), repository: ref, group, groupFile, members, pendingMembers, expenses,
      balances, settlements, spending, warnings, syncedAt: this.clock.now().toISOString(),
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

  async createExpense(repository: RepositoryRef, expense: WritableExpense, signal?: AbortSignal): Promise<ExpenseFile> {
    const path = `expenses/${expense.id}.json` as const;
    const response = await this.client.request<{ content?: { sha?: string } }>('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner: repository.owner, repo: repository.name, path, branch: repository.defaultBranch,
      message: `Add expense ${expense.id}`, content: encodeUtf8Base64(serializeJson(expense)), request: { signal },
    });
    const sha = response.data.content?.sha;
    if (!sha) return await this.requireExpense(repository, expense.id, signal);
    return { expense, blobSha: sha, path, sourceDocument: { ...expense } };
  }

  async readExpense(repository: RepositoryRef, id: string, signal?: AbortSignal): Promise<ExpenseFile | null> {
    const path = `expenses/${id}.json` as const;
    try {
      const file = await this.readContent(repository, path, signal);
      const groupFile = await this.readGroup(repository, signal);
      const parsed = parseExpenseDocument(JSON.parse(decodeUtf8Base64(file.content)), path, groupFile.group.currency);
      return { expense: parsed.expense, blobSha: file.sha, path, sourceDocument: parsed.sourceDocument };
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'not_found') return null;
      throw error;
    }
  }

  async updateExpense(repository: RepositoryRef, current: ExpenseFile, expense: WritableExpense, signal?: AbortSignal): Promise<ExpenseFile> {
    const path = `expenses/${expense.id}.json` as const;
    const sourceDocument = { ...current.sourceDocument, ...expense };
    try {
      const response = await this.client.request<{ content?: { sha?: string } }>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path, branch: repository.defaultBranch, sha: current.blobSha,
        message: `Update expense ${expense.id}`, content: encodeUtf8Base64(serializeJson(sourceDocument)), request: { signal },
      });
      return { expense, blobSha: response.data.content?.sha ?? current.blobSha, path, sourceDocument };
    } catch (error) {
      if (isConflict(error)) throw new AppFailure({ kind: 'expense_conflict', latest: await this.readExpense(repository, expense.id, signal), operation: 'edit' });
      throw error;
    }
  }

  async deleteExpense(repository: RepositoryRef, current: ExpenseFile, signal?: AbortSignal) {
    const expense = current.expense;
    try {
      await this.client.request('DELETE /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: `expenses/${expense.id}.json`, branch: repository.defaultBranch, sha: current.blobSha,
        message: `Delete expense ${expense.id}`, request: { signal },
      });
    } catch (error) {
      if (isConflict(error)) throw new AppFailure({ kind: 'expense_conflict', latest: await this.readExpense(repository, expense.id, signal), operation: 'delete' });
      if (error instanceof AppFailure && error.detail.kind === 'not_found' && await this.readExpense(repository, expense.id, signal) === null) return;
      throw error;
    }
  }

  async updateSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, signal?: AbortSignal): Promise<GroupFile> {
    return this.writeSpendingPlan(repository, current, next, signal, true);
  }

  private async writeSpendingPlan(repository: RepositoryRef, current: GroupFile, next: SpendingPlan | null, signal: AbortSignal | undefined, allowSafeRetry: boolean): Promise<GroupFile> {
    const sourceDocument = { ...current.sourceDocument };
    if (next) sourceDocument.spending_plan = next;
    else delete sourceDocument.spending_plan;
    try {
      const response = await this.client.request<{ content?: { sha?: string } }>('PUT /repos/{owner}/{repo}/contents/{path}', {
        owner: repository.owner, repo: repository.name, path: 'group.json', branch: repository.defaultBranch, sha: current.blobSha,
        message: next ? 'Update spending plan' : 'Remove spending plan', content: encodeUtf8Base64(serializeJson(sourceDocument)), request: { signal },
      });
      const sha = response.data.content?.sha;
      if (sha) return { group: parseGroupDocument(sourceDocument).group, blobSha: sha, path: 'group.json', sourceDocument };
      const confirmed = await this.readGroup(repository, signal);
      if (spendingPlanMatches(confirmed, next)) return confirmed;
      throw new AppFailure({ kind: 'spending_plan_conflict', latest: confirmed, submitted: next });
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'spending_plan_conflict') throw error;
      if (isConflict(error)) {
        throw new AppFailure({ kind: 'spending_plan_conflict', latest: await this.readGroup(repository, signal), submitted: next });
      }
      if (isRetryable(error)) {
        const latest = await this.readGroup(repository, signal);
        if (spendingPlanMatches(latest, next)) return latest;
        if (latest.blobSha === current.blobSha) {
          if (allowSafeRetry) return this.writeSpendingPlan(repository, latest, next, signal, false);
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

function isRetryable(error: unknown): boolean {
  return error instanceof AppFailure && 'retryable' in error.detail && error.detail.retryable;
}


function isConflict(error: unknown) {
  return error instanceof AppFailure && error.detail.kind === 'github' && (error.detail.status === 409 || error.detail.status === 422);
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
