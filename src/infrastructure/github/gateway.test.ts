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

describe('GitHubGateway received group invitations', () => {
  const invitation = (id: number) => ({
    id,
    repository: { id: 1000 + id, name: `branch-balance-trip-${id}`, full_name: `owner/branch-balance-trip-${id}`, private: true, owner: { login: 'owner', type: 'User' } },
    invitee: { login: 'friend' }, inviter: { login: 'owner' }, permissions: 'write', created_at: '2026-07-19T12:00:00Z',
  });

  it('publishes only after paginating the complete authenticated-user invitation list', async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => invitation(index + 1));
    const request = jest.fn(async (_route: string, parameters: Record<string, unknown>) => ({
      data: parameters.page === 1 ? pageOne : [invitation(101)], headers: {}, status: 200,
    }));
    const gateway = new GitHubGatewayImpl({ request: request as never }, { now: () => new Date() });
    const result = await gateway.listGroupInvitations('FRIEND');

    expect(result.invitations).toHaveLength(101);
    expect(request).toHaveBeenNthCalledWith(1, 'GET /user/repository_invitations', expect.objectContaining({ page: 1, per_page: 100 }));
    expect(request).toHaveBeenNthCalledWith(2, 'GET /user/repository_invitations', expect.objectContaining({ page: 2, per_page: 100 }));
  });

  it('rejects a later page instead of returning a partial invitation list', async () => {
    const request = jest.fn(async (_route: string, parameters: Record<string, unknown>) => {
      if (parameters.page === 1) return { data: Array.from({ length: 100 }, (_, index) => invitation(index + 1)), headers: {}, status: 200 };
      throw new AppFailure({ kind: 'network', retryable: true });
    });
    const gateway = new GitHubGatewayImpl({ request: request as never }, { now: () => new Date() });
    await expect(gateway.listGroupInvitations('friend')).rejects.toMatchObject({ detail: { kind: 'network' } });
  });

  it('uses the received-invitation decision endpoints without a request body', async () => {
    const request = jest.fn().mockResolvedValue({ data: undefined, headers: {}, status: 204 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });

    await gateway.acceptGroupInvitation(42);
    await gateway.declineGroupInvitation(43);

    expect(request).toHaveBeenNthCalledWith(1, 'PATCH /user/repository_invitations/{invitation_id}', { invitation_id: 42, request: { signal: undefined } });
    expect(request).toHaveBeenNthCalledWith(2, 'DELETE /user/repository_invitations/{invitation_id}', { invitation_id: 43, request: { signal: undefined } });
  });

  it('maps invitation permission and unavailable errors without private repository details', async () => {
    const permissionGateway = new GitHubGatewayImpl({ request: jest.fn().mockRejectedValue(new AppFailure({ kind: 'permission', operation: 'perform this GitHub operation' })) }, { now: () => new Date() });
    await expect(permissionGateway.listGroupInvitations('friend')).rejects.toMatchObject({ detail: { kind: 'invitation_permission', operation: 'list' } });
    await expect(permissionGateway.acceptGroupInvitation(42)).rejects.toMatchObject({ detail: { kind: 'invitation_permission', operation: 'accept' } });

    const unavailableGateway = new GitHubGatewayImpl({ request: jest.fn().mockRejectedValue(new AppFailure({ kind: 'not_found', resource: 'GitHub resource' })) }, { now: () => new Date() });
    await expect(unavailableGateway.declineGroupInvitation(42)).rejects.toMatchObject({ detail: { kind: 'invitation_unavailable', invitationId: 42 } });
  });
});

describe('GitHubGateway group refresh', () => {
  it('excludes malformed expenses and calculates one atomic snapshot', async () => {
    const expense = {
      schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
      currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'],
      shares_minor: { owner: 500, friend: 500 }, expense_date: '2026-07-16', created_by: 'owner',
      created_at: '2026-07-16T00:00:00.000Z', updated_by: null, updated_at: null,
    };
    const client = clientWith((route, parameters) => {
      if (route === 'GET /repos/{owner}/{repo}') return { data: { id: 1, name: 'branch-balance-trip', private: true, default_branch: 'main', owner: { login: 'owner' }, permissions: { admin: true, push: true } }, headers: {}, status: 200 };
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}' && parameters.path === 'settlements.json') throw new AppFailure({ kind: 'not_found', resource: 'Settlement ledger' });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'g', content: encoded({ ...group, spending_plan: { budget_minor: 0, updated_by: 'owner', updated_at: '2026-07-16T00:00:00.000Z' } }) }, headers: {}, status: 200 };
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
    expect(snapshot.warnings).toHaveLength(2);
    expect(snapshot.warnings).toContainEqual(expect.objectContaining({ path: 'group.json#spending_plan' }));
    expect(snapshot.group.spending_plan).toBeUndefined();
    expect(snapshot.groupFile?.blobSha).toBe('g');
    expect(snapshot.spending).toMatchObject({ totalSpentMinor: 1000, currentUserPaidMinor: 1000, currentUserShareMinor: 500 });
    expect(snapshot.balances.zeroSum).toBe(true);
    expect(snapshot.settlements).toEqual([{ from: 'friend', to: 'owner', amountMinor: 500 }]);
  });
});

describe('GitHubGateway expense writes', () => {
  const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
  const expense = {
    schema_version: 1 as const, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1000,
    currency: 'EUR' as const, category: 'food_drink' as const, payment_method: 'card' as const, paid_by: 'owner', split_type: 'equal' as const, participants: ['owner', 'friend'],
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
    await expect(gateway.updateExpense(repository, { expense, blobSha: 'stale-sha', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } }, expense)).rejects.toMatchObject({ detail: { kind: 'expense_conflict', operation: 'edit', latest: { blobSha: 'latest-sha' } } });
  });

  it('treats an already-absent delete as success after confirmation', async () => {
    const client = clientWith((route) => {
      if (route.startsWith('DELETE ')) throw new AppFailure({ kind: 'not_found', resource: 'Expense' });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') throw new AppFailure({ kind: 'not_found', resource: 'Expense' });
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date() });
    await expect(gateway.deleteExpense(repository, { expense, blobSha: 'old-sha', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } })).resolves.toBeUndefined();
  });

  it('preserves unrelated passthrough properties during an edit', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'updated-sha' } }, headers: {}, status: 200 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    const updated = { ...expense, description: 'Updated dinner' };
    const file = await gateway.updateExpense(repository, { expense, blobSha: 'old-sha', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense, future: { retained: true } } }, updated);
    expect(file.sourceDocument.future).toEqual({ retained: true });
    const body = JSON.parse(atob(jest.mocked(request).mock.calls[0]?.[1]?.content as string));
    expect(body).toMatchObject({ description: 'Updated dinner', future: { retained: true } });
  });
});

describe('GitHubGateway spending-plan writes', () => {
  const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
  const current = { group: { ...group, schema_version: 1 as const, currency: 'EUR' as const }, blobSha: 'group-sha', path: 'group.json' as const, sourceDocument: { ...group, future: { retained: true } } };
  const plan = { budget_minor: 100_000, starts_on: '2026-08-10', ends_on: '2026-08-16', updated_by: 'owner', updated_at: '2026-07-17T14:00:00.000Z' } as const;

  it('merges only the spending plan and retains the returned SHA', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'next-group-sha' } }, headers: {}, status: 200 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    const result = await gateway.updateSpendingPlan(repository, current, plan);
    expect(result).toMatchObject({ blobSha: 'next-group-sha', group: { spending_plan: plan }, sourceDocument: { future: { retained: true } } });
    expect(request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/contents/{path}', expect.objectContaining({ sha: 'group-sha', message: 'Update spending plan' }));
  });

  it('removes only the spending plan from the passthrough group document', async () => {
    const request = jest.fn().mockResolvedValue({ data: { content: { sha: 'removed-plan-sha' } }, headers: {}, status: 200 });
    const gateway = new GitHubGatewayImpl({ request }, { now: () => new Date() });
    const currentWithPlan = { ...current, group: { ...current.group, spending_plan: plan }, sourceDocument: { ...current.sourceDocument, spending_plan: plan } };

    const result = await gateway.updateSpendingPlan(repository, currentWithPlan, null);

    expect(result.group.spending_plan).toBeUndefined();
    expect(result.sourceDocument).toMatchObject({ future: { retained: true } });
    expect(result.sourceDocument).not.toHaveProperty('spending_plan');
    expect(request).toHaveBeenCalledWith('PUT /repos/{owner}/{repo}/contents/{path}', expect.objectContaining({ sha: 'group-sha', message: 'Remove spending plan' }));
  });

  it('returns the latest document and submitted values for stale-SHA review', async () => {
    const remotePlan = { ...plan, budget_minor: 120_000, updated_at: '2026-07-17T14:01:00.000Z' };
    const client = clientWith((route) => {
      if (route.startsWith('PUT ')) throw new AppFailure({ kind: 'github', status: 409, safeMessage: 'Conflict', retryable: false });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'remote-sha', content: encoded({ ...group, spending_plan: remotePlan }) }, headers: {}, status: 200 };
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl(client, { now: () => new Date() });
    await expect(gateway.updateSpendingPlan(repository, current, plan)).rejects.toMatchObject({ detail: { kind: 'spending_plan_conflict', latest: { blobSha: 'remote-sha' }, submitted: plan } });
  });

  it('recognizes an ambiguous write that already committed semantically', async () => {
    const request = jest.fn(async (route: string) => {
      if (route.startsWith('PUT ')) throw new AppFailure({ kind: 'network', retryable: true });
      if (route === 'GET /repos/{owner}/{repo}/contents/{path}') return { data: { type: 'file', sha: 'confirmed-sha', content: encoded({ ...group, spending_plan: plan }) }, headers: {}, status: 200 };
      throw new Error(`Unexpected ${route}`);
    });
    const gateway = new GitHubGatewayImpl({ request: request as never }, { now: () => new Date() });
    await expect(gateway.updateSpendingPlan(repository, current, plan)).resolves.toMatchObject({ blobSha: 'confirmed-sha', group: { spending_plan: plan } });
    expect(request).toHaveBeenCalledTimes(2);
  });
});
