import { z } from 'zod';

import { AppFailure } from '@/domain/errors';
import type { OAuthTransport, RotatingTokens } from '@/features/auth/contracts';

const deviceSchema = z.object({
  device_code: z.string(), user_code: z.string(), verification_uri: z.string().url(),
  expires_in: z.number().positive(), interval: z.number().positive(),
});
const tokenSchema = z.object({
  access_token: z.string(), expires_in: z.number().positive(), refresh_token: z.string(), refresh_token_expires_in: z.number().positive(),
});

export class GitHubOAuthTransport implements OAuthTransport {
  constructor(private readonly clientId: string, private readonly request: typeof fetch = fetch) {}

  async requestCode(signal?: AbortSignal) {
    const response = await this.post('https://github.com/login/device/code', { client_id: this.clientId }, signal);
    if (typeof response.value.error === 'string') throw oauthFailure(response.value.error, response.status, 'authorize');
    const parsed = deviceSchema.safeParse(response.value);
    if (!parsed.success) throw invalidOAuthResponse(response.status);
    return { deviceCode: parsed.data.device_code, userCode: parsed.data.user_code, verificationUri: parsed.data.verification_uri, expiresIn: parsed.data.expires_in, interval: parsed.data.interval };
  }

  async poll(deviceCode: string, signal?: AbortSignal) {
    const response = await this.post('https://github.com/login/oauth/access_token', {
      client_id: this.clientId,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }, signal);
    const value = response.value;
    if (value.error === 'authorization_pending') return { kind: 'pending' as const };
    if (value.error === 'slow_down') return { kind: 'slow_down' as const };
    if (value.error === 'access_denied') return { kind: 'denied' as const };
    if (value.error === 'expired_token' || value.error === 'token_expired') return { kind: 'expired' as const };
    if (typeof value.error === 'string') throw oauthFailure(value.error, response.status, 'authorize');
    return { kind: 'authorized' as const, tokens: this.parseTokens(value) };
  }

  async refresh(refreshToken: string, signal?: AbortSignal) {
    const response = await this.post('https://github.com/login/oauth/access_token', {
      client_id: this.clientId, grant_type: 'refresh_token', refresh_token: refreshToken,
    }, signal);
    const value = response.value;
    if (value.error === 'bad_refresh_token' || value.error === 'incorrect_client_credentials') throw new AppFailure({ kind: 'auth_required', reason: 'revoked' });
    if (typeof value.error === 'string') throw oauthFailure(value.error, response.status, 'refresh');
    return this.parseTokens(value);
  }

  private parseTokens(value: Record<string, unknown>): RotatingTokens {
    const token = tokenSchema.safeParse(value);
    if (!token.success) throw new AppFailure({ kind: 'auth_required', reason: 'revoked' });
    return { accessToken: token.data.access_token, accessTokenExpiresIn: token.data.expires_in, refreshToken: token.data.refresh_token, refreshTokenExpiresIn: token.data.refresh_token_expires_in };
  }

  private async post(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<{ value: Record<string, unknown>; status: number }> {
    let response: Response;
    const timeout = new AbortController();
    const timeoutId = setTimeout(() => timeout.abort(), 20_000);
    const cancel = () => timeout.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try {
      response = await this.request(url, {
        method: 'POST', signal: timeout.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError' && signal?.aborted) throw error;
      if (error instanceof Error && error.name === 'AbortError') throw new AppFailure({ kind: 'timeout', retryable: true });
      throw new AppFailure({ kind: 'network', retryable: true });
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', cancel);
    }
    if (!response.ok && response.status >= 500) throw new AppFailure({ kind: 'github', status: response.status, safeMessage: 'GitHub is temporarily unavailable.', retryable: true });
    try { return { value: await response.json() as Record<string, unknown>, status: response.status }; }
    catch { throw new AppFailure({ kind: 'github', status: response.status, safeMessage: 'GitHub returned an invalid authorization response.', retryable: response.status >= 500 }); }
  }
}

function invalidOAuthResponse(status: number) {
  return new AppFailure({ kind: 'github', status, safeMessage: 'GitHub returned an invalid authorization response.', retryable: status >= 500 });
}

function oauthFailure(error: string, status: number, operation: 'authorize' | 'refresh') {
  if (error === 'device_flow_disabled') {
    return new AppFailure({ kind: 'github', status, safeMessage: 'Enable Device Flow in the GitHub App settings, then try again.', retryable: false });
  }
  if (error === 'incorrect_client_credentials') {
    return new AppFailure({ kind: 'github', status, safeMessage: 'The GitHub client ID is invalid. Check EXPO_PUBLIC_GITHUB_CLIENT_ID and try again.', retryable: false });
  }
  if (error === 'unverified_user_email') {
    return new AppFailure({ kind: 'github', status, safeMessage: 'Verify your primary email address on GitHub, then try again.', retryable: false });
  }
  return new AppFailure({
    kind: 'github', status,
    safeMessage: operation === 'refresh' ? 'GitHub could not refresh this session.' : 'GitHub could not complete authorization.',
    retryable: status >= 500,
  });
}
