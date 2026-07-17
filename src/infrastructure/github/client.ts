import { Octokit } from '@octokit/rest';

import { AppFailure } from '@/domain/errors';
import type { TokenSource } from '@/features/auth/contracts';

import type { GitHubRequestClient, GitHubResponse } from './gateway';

const API_VERSION = '2022-11-28';

export class AuthenticatedGitHubClient implements GitHubRequestClient {
  constructor(
    private readonly tokens: TokenSource,
    private readonly requesterFactory: (token: string) => { request(route: string, parameters: Record<string, unknown>): Promise<unknown> } = (token) => new Octokit({ auth: token, request: { timeout: 20_000 }, userAgent: 'BranchBalance/1.0' }) as never,
  ) {}

  async request<T = unknown>(route: string, parameters: Record<string, unknown> = {}): Promise<GitHubResponse<T>> {
    try {
      return await this.perform<T>(await this.tokens.getValidAccessToken(), route, parameters);
    } catch (error) {
      if (statusOf(error) !== 401) throw mapGitHubError(error);
      try {
        return await this.perform<T>(await this.tokens.forceRefresh(), route, parameters);
      } catch (retryError) {
        if (statusOf(retryError) === 401) throw new AppFailure({ kind: 'auth_required', reason: 'revoked' });
        throw mapGitHubError(retryError);
      }
    }
  }

  private async perform<T>(token: string, route: string, parameters: Record<string, unknown>) {
    const response = await this.requesterFactory(token).request(route, {
      ...parameters,
      headers: { accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION },
    });
    return response as unknown as GitHubResponse<T>;
  }
}

function statusOf(error: unknown): number | null {
  return typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number' ? error.status : null;
}

export function mapGitHubError(error: unknown): AppFailure {
  if (error instanceof AppFailure) return error;
  const status = statusOf(error) ?? 0;
  const response = typeof error === 'object' && error !== null && 'response' in error ? error.response as { headers?: Record<string, string> } | undefined : undefined;
  const headers = response?.headers ?? {};
  if (status === 403 && (headers['x-ratelimit-remaining'] === '0' || headers['retry-after'])) {
    const retrySeconds = Number(headers['retry-after']);
    const resetSeconds = Number(headers['x-ratelimit-reset']);
    const retryAt = Number.isFinite(retrySeconds) ? new Date(Date.now() + retrySeconds * 1000).toISOString()
      : Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : null;
    return new AppFailure({ kind: 'rate_limit', retryable: true, retryAt, secondary: headers['x-ratelimit-remaining'] !== '0' });
  }
  if (status === 401) return new AppFailure({ kind: 'auth_required', reason: 'revoked' });
  if (status === 403) return new AppFailure({ kind: 'permission', operation: 'perform this GitHub operation' });
  if (status === 404) return new AppFailure({ kind: 'not_found', resource: 'GitHub resource' });
  if (status === 409 || status === 422) return new AppFailure({ kind: 'github', status, safeMessage: 'GitHub rejected the conflicting change.', retryable: false });
  if (status >= 500) return new AppFailure({ kind: 'github', status, safeMessage: 'GitHub is temporarily unavailable.', retryable: true });
  const name = error instanceof Error ? error.name : '';
  if (name === 'AbortError') return new AppFailure({ kind: 'timeout', retryable: true });
  if (!status) return new AppFailure({ kind: 'network', retryable: true });
  return new AppFailure({ kind: 'github', status, safeMessage: 'GitHub could not complete the request.', retryable: false });
}
