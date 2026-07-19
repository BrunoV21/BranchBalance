import { AuthenticatedGitHubClient } from './client';
import { Octokit } from '@octokit/rest';

describe('AuthenticatedGitHubClient', () => {
  it('refreshes and retries exactly once after an unexpected 401', async () => {
    const tokens = { getValidAccessToken: jest.fn().mockResolvedValue('old'), forceRefresh: jest.fn().mockResolvedValue('new'), install: jest.fn() };
    const request = jest.fn().mockRejectedValueOnce({ status: 401 }).mockResolvedValueOnce({ data: { ok: true }, status: 200, headers: {} });
    const client = new AuthenticatedGitHubClient(tokens, () => ({ request }));
    await expect(client.request('GET /user')).resolves.toMatchObject({ data: { ok: true } });
    expect(tokens.forceRefresh).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('ends the session after the retried request also returns 401', async () => {
    const tokens = { getValidAccessToken: jest.fn().mockResolvedValue('old'), forceRefresh: jest.fn().mockResolvedValue('new'), install: jest.fn() };
    const request = jest.fn().mockRejectedValue({ status: 401 });
    const client = new AuthenticatedGitHubClient(tokens, () => ({ request }));
    await expect(client.request('GET /user')).rejects.toMatchObject({ detail: { kind: 'auth_required', reason: 'revoked' } });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('maps a revoked-installation 404 without refreshing the user session', async () => {
    const tokens = { getValidAccessToken: jest.fn().mockResolvedValue('valid'), forceRefresh: jest.fn(), install: jest.fn() };
    const request = jest.fn().mockRejectedValue({ status: 404 });
    const client = new AuthenticatedGitHubClient(tokens, () => ({ request }));

    await expect(client.request('GET /repos/{owner}/{repo}/contents/{path}')).rejects.toMatchObject({ detail: { kind: 'not_found' } });
    expect(tokens.forceRefresh).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not send an expected GitHub HTTP failure to console.error', async () => {
    const tokens = { getValidAccessToken: jest.fn().mockResolvedValue('valid'), forceRefresh: jest.fn(), install: jest.fn() };
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const client = new AuthenticatedGitHubClient(tokens);
      await client.request('GET /user');
      const options = (Octokit as unknown as { lastOptions?: { log?: { error(message: string): void } } }).lastOptions;
      options?.log?.error('GET /repos/owner/private/contents/group.json - 404');
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
