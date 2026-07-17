import { GitHubOAuthTransport } from './oauth';

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('GitHubOAuthTransport', () => {
  it('maps device-code and polling states', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce(response({ device_code: 'device', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }))
      .mockResolvedValueOnce(response({ error: 'authorization_pending' }))
      .mockResolvedValueOnce(response({ error: 'slow_down' }));
    const transport = new GitHubOAuthTransport('client', request);
    await expect(transport.requestCode()).resolves.toMatchObject({ deviceCode: 'device', interval: 5 });
    await expect(transport.poll('device')).resolves.toEqual({ kind: 'pending' });
    await expect(transport.poll('device')).resolves.toEqual({ kind: 'slow_down' });
  });

  it('validates complete rotating token metadata', async () => {
    const request = jest.fn().mockResolvedValue(response({ access_token: 'a', expires_in: 100, refresh_token: 'r', refresh_token_expires_in: 1000 }));
    const transport = new GitHubOAuthTransport('client', request);
    await expect(transport.refresh('old')).resolves.toEqual({ accessToken: 'a', accessTokenExpiresIn: 100, refreshToken: 'r', refreshTokenExpiresIn: 1000 });
  });

  it('maps invalid refresh credentials to terminal authentication', async () => {
    const transport = new GitHubOAuthTransport('client', jest.fn().mockResolvedValue(response({ error: 'bad_refresh_token' })));
    await expect(transport.refresh('old')).rejects.toMatchObject({ detail: { kind: 'auth_required', reason: 'revoked' } });
  });

  it('explains when device flow is disabled instead of leaking schema errors', async () => {
    const transport = new GitHubOAuthTransport('client', jest.fn().mockResolvedValue(response({ error: 'device_flow_disabled' })));
    await expect(transport.requestCode()).rejects.toMatchObject({
      message: 'Enable Device Flow in the GitHub App settings, then try again.',
      detail: { kind: 'github', status: 200, retryable: false },
    });
  });

  it('maps malformed device-code responses to a safe transport error', async () => {
    const transport = new GitHubOAuthTransport('client', jest.fn().mockResolvedValue(response({ unexpected: true })));
    await expect(transport.requestCode()).rejects.toMatchObject({
      message: 'GitHub returned an invalid authorization response.',
      detail: { kind: 'github', status: 200, retryable: false },
    });
  });
});
