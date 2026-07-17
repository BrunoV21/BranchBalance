import { AuthenticatedGitHubClient } from './client';

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
});
