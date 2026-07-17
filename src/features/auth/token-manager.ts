import { AppFailure } from '@/domain/errors';
import type { StoredCredentialV1 } from '@/domain/types';
import type { CredentialStore } from '@/infrastructure/storage/contracts';

import type { Clock, RefreshTransport, RotatingTokens, TokenSource } from './contracts';

const REFRESH_SKEW_MS = 5 * 60 * 1000;

export class TokenManager implements TokenSource {
  private refreshPromise: Promise<string> | null = null;

  constructor(
    private readonly store: CredentialStore,
    private readonly transport: RefreshTransport,
    private readonly clock: Clock,
  ) {}

  async getValidAccessToken(): Promise<string> {
    const credential = await this.requireCredential();
    if (Date.parse(credential.accessTokenExpiresAt) - this.clock.now().getTime() > REFRESH_SKEW_MS) return credential.accessToken;
    return this.refreshSingleFlight(credential);
  }

  async forceRefresh(): Promise<string> {
    return this.refreshSingleFlight(await this.requireCredential());
  }

  async install(tokens: RotatingTokens): Promise<StoredCredentialV1> {
    const now = this.clock.now().getTime();
    const credential: StoredCredentialV1 = {
      version: 1,
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: new Date(now + tokens.accessTokenExpiresIn * 1000).toISOString(),
      refreshToken: tokens.refreshToken,
      refreshTokenExpiresAt: new Date(now + tokens.refreshTokenExpiresIn * 1000).toISOString(),
    };
    if (!tokens.accessToken || !tokens.refreshToken || tokens.accessTokenExpiresIn <= 0 || tokens.refreshTokenExpiresIn <= 0) {
      throw new AppFailure({ kind: 'auth_required', reason: 'revoked' });
    }
    await this.store.replace(credential);
    return credential;
  }

  private async requireCredential() {
    const credential = await this.store.read();
    if (!credential) throw new AppFailure({ kind: 'auth_required', reason: 'missing' });
    if (Date.parse(credential.refreshTokenExpiresAt) <= this.clock.now().getTime()) {
      await this.store.clear();
      throw new AppFailure({ kind: 'auth_required', reason: 'refresh_expired' });
    }
    return credential;
  }

  private refreshSingleFlight(credential: StoredCredentialV1): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh(credential).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  private async performRefresh(credential: StoredCredentialV1) {
    try {
      const tokens = await this.transport.refresh(credential.refreshToken);
      return (await this.install(tokens)).accessToken;
    } catch (error) {
      if (error instanceof AppFailure && error.detail.kind === 'auth_required') await this.store.clear();
      throw error;
    }
  }
}
