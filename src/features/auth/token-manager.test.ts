import { AppFailure } from '@/domain/errors';
import type { StoredCredentialV1 } from '@/domain/types';
import { MemoryCredentialStore } from '@/infrastructure/storage/credential-store';

import { TokenManager } from './token-manager';

const credential: StoredCredentialV1 = {
  version: 1,
  accessToken: 'old-access',
  accessTokenExpiresAt: '2026-07-16T12:04:00.000Z',
  refreshToken: 'old-refresh',
  refreshTokenExpiresAt: '2027-01-16T12:00:00.000Z',
};

describe('TokenManager', () => {
  it('coalesces refresh and atomically rotates credentials', async () => {
    const store = new MemoryCredentialStore();
    await store.replace(credential);
    let calls = 0;
    const manager = new TokenManager(store, {
      refresh: async () => {
        calls += 1;
        return {
          accessToken: 'new-access', accessTokenExpiresIn: 28_800,
          refreshToken: 'new-refresh', refreshTokenExpiresIn: 15_552_000,
        };
      },
    }, { now: () => new Date('2026-07-16T12:00:00.000Z') });

    await expect(Promise.all([manager.getValidAccessToken(), manager.getValidAccessToken()]))
      .resolves.toEqual(['new-access', 'new-access']);
    expect(calls).toBe(1);
    expect((await store.read())?.refreshToken).toBe('new-refresh');
  });

  it('keeps credentials after a transient refresh error', async () => {
    const store = new MemoryCredentialStore();
    await store.replace(credential);
    const manager = new TokenManager(store, { refresh: async () => { throw new AppFailure({ kind: 'network', retryable: true }); } }, { now: () => new Date('2026-07-16T12:00:00.000Z') });
    await expect(manager.getValidAccessToken()).rejects.toThrow('Unable to reach GitHub');
    expect(await store.read()).toEqual(credential);
  });

  it('clears expired refresh credentials', async () => {
    const store = new MemoryCredentialStore();
    await store.replace({ ...credential, refreshTokenExpiresAt: '2026-07-16T11:59:00.000Z' });
    const manager = new TokenManager(store, { refresh: jest.fn() }, { now: () => new Date('2026-07-16T12:00:00.000Z') });
    await expect(manager.getValidAccessToken()).rejects.toMatchObject({ detail: { kind: 'auth_required', reason: 'refresh_expired' } });
    expect(await store.read()).toBeNull();
  });
});
