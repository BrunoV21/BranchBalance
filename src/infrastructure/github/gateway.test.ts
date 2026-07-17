import { GitHubGatewayImpl, type GitHubRequestClient } from './gateway';
import { AppFailure } from '@/domain/errors';

function clientWith(handler: (route: string, parameters: Record<string, unknown>) => unknown): GitHubRequestClient {
  return { request: async (route, parameters = {}) => handler(route, parameters) as never };
}

const encoded = (value: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));
const group = { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-16T00:00:00.000Z' };

describe('GitHubGateway discovery', () => {
  it('paginates, deduplicates, and excludes invalid candidates', async () => {
    const client = clientWith((route, parameters) => {
      if (route === 'GET /user/installations') return { data: { installations: parameters.page === 1 ? [{ id: 10 }] : [] }, headers: {}, status: 200 };
      if (route === 'GET /user/installations/{installation_id}/repositories') return { data: { repositories: parameters.page === 1 ? [
        { id: 1, name: 'branch-balance-trip', private: true, default_branch: 'trunk', owner: { login: 'owner' }, permissions: { admin: true, push: true } },
        { id: 2, name: 'branch-balance-bad', private: true, default_branch: 'main', owner: { login: 'owner' }, permissions: { push: true } },
      ] : [] }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') {
        return { data: { type: 'file', sha: 'sha', content: parameters.repo === 'branch-balance-trip' ? encoded(group) : encoded({ nope: true }) }, headers: {}, status: 200 };
      }
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date('2026-07-16T12:00:00.000Z') });
    const result = await gateway.discoverGroups();
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.repository.defaultBranch).toBe('trunk');
    expect(result.warnings).toHaveLength(1);
  });
});

describe('GitHubGateway group refresh', () => {
  it('excludes malformed expenses and calculates one atomic snapshot', async () => {
    const expense = {
      schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
      currency: 'EUR', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'],
      shares_minor: { owner: 500, friend: 500 }, expense_date: '2026-07-16', created_by: 'owner',
      created_at: '2026-07-16T00:00:00.000Z', updated_by: null, updated_at: null,
    };
    const client = clientWith((route, parameters) => {
      if (route === 'GET /repos/{owner}/{repo}') return { data: { id: 1, name: 'branch-balance-trip', private: true, default_branch: 'main', owner: { login: 'owner' }, permissions: { admin: true, push: true } }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'g', content: encoded(group) }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/collaborators') return { data: [{ login: 'owner', avatar_url: null, permissions: { admin: true } }, { login: 'friend', avatar_url: null, permissions: { push: true } }], headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/invitations') return { data: [], headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/git/trees/{tree_sha}') return { data: { truncated: false, tree: [
        { type: 'blob', path: `expenses/${expense.id}.json`, sha: 'expense-sha' },
        { type: 'blob', path: 'expenses/00000000-0000-4000-8000-000000000000.json', sha: 'bad-sha' },
      ] }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/git/blobs/{file_sha}') return { data: { encoding: 'base64', content: parameters.file_sha === 'expense-sha' ? encoded(expense) : encoded({ broken: true }) }, headers: {}, status: 200 };
      if (route === 'GET /users/{username}') return { data: { login: parameters.username, name: null, avatar_url: null }, headers: {}, status: 200 };
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date('2026-07-16T12:00:00.000Z') });
    const snapshot = await gateway.refreshGroup({ id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true }, 'owner');
    expect(snapshot.expenses).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.balances.zeroSum).toBe(true);
    expect(snapshot.settlements).toEqual([{ from: 'friend', to: 'owner', amountMinor: 500 }]);
  });
});

describe('GitHubGateway expense writes', () => {
  const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
  const expense = {
    schema_version: 1 as const, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
    currency: 'EUR' as const, paid_by: 'owner', split_type: 'equal' as const, participants: ['owner', 'friend'],
    shares_minor: { owner: 500, friend: 500 }, expense_date: '2026-07-16', created_by: 'owner',
    created_at: '2026-07-16T00:00:00.000Z', updated_by: null, updated_at: null,
  };

  it('creates a UUID path and retains the returned blob SHA', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'new-sha' } }, headers: {}, status: 201 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    await expect(gateway.createExpense(repository, expense)).resolves.toMatchObject({ blobSha: 'new-sha', path: `expenses/${expense.id}.json` });
    expect(request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/contents/{path}', expect.objectContaining({ message: `Add expense ${expense.id}`, branch: 'main' }));
  });

  it('returns the latest remote file after a stale-SHA edit', async () => {
    const client = clientWith((route, parameters) => {
      if (route.startsWith('PUT ')) throw new AppFailure({ kind: 'github', status: 409, safeMessage: 'Conflict', retryable: false });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && parameters.path === 'group.json') return { data: { type: 'file', sha: 'group-sha', content: encoded(group) }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'latest-sha', content: encoded({ ...expense, description: 'Remote dinner' }) }, headers: {}, status: 200 };
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date() });
    await expect(gateway.updateExpense(repository, expense, 'stale-sha')).rejects.toMatchObject({ detail: { kind: 'expense_conflict', operation: 'edit', latest: { blobSha: 'latest-sha' } } });
  });

  it('treats an already-absent delete as success after confirmation', async () => {
    const client = clientWith((route) => {
      if (route.startsWith('DELETE ')) throw new AppFailure({ kind: 'not_found', resource: 'Expense' });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') throw new AppFailure({ kind: 'not_found', resource: 'Expense' });
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date() });
    await expect(gateway.deleteExpense(repository, expense, 'old-sha')).resolves.toBeUndefined();
  });
});
