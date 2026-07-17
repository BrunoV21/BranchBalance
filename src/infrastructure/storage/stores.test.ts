import { MemoryKeyValueStore, SnapshotStoreImpl } from './snapshot-store';
import type { RemoteGroupSnapshot } from '@/domain/types';
import { UnsupportedCredentialStore } from './credential-store';

describe('SnapshotStore', () => {
  it('round trips versioned user-scoped data', async () => {
    const keyValue = new MemoryKeyValueStore();
    const store = new SnapshotStoreImpl(keyValue);
    const snapshot = {
      key: 'owner/repo',
      repository: { id: 1 },
      group: { schema_version: 1 },
      expenses: [],
      syncedAt: '2026-07-16T00:00:00.000Z',
    } as unknown as RemoteGroupSnapshot;
    await store.writeGroup(7, 'owner/repo', snapshot);
    expect(await store.readGroup(7, 'owner/repo')).toEqual(snapshot);
  });

  it('clears one account without clearing device theme', async () => {
    const keyValue = new MemoryKeyValueStore();
    const store = new SnapshotStoreImpl(keyValue);
    await store.writeActiveAccountId(7);
    await store.writeTheme('dark');
    await store.writeGroups(7, []);
    await store.clearAccount(7);
    expect(await store.readGroups(7)).toBeNull();
    expect(await store.readActiveAccountId()).toBeNull();
    expect(await store.readTheme()).toBe('dark');
  });

  it('treats corrupt records as misses and removes them', async () => {
    const keyValue = new MemoryKeyValueStore();
    await keyValue.set('bb:v1:groups:7', '{bad');
    const store = new SnapshotStoreImpl(keyValue);
    expect(await store.readGroups(7)).toBeNull();
    expect(await keyValue.get('bb:v1:groups:7')).toBeNull();
  });
});

describe('web credential storage', () => {
  it('hydrates as signed out without attempting insecure token persistence', async () => {
    const store = new UnsupportedCredentialStore();
    await expect(store.read()).resolves.toBeNull();
    await expect(store.replace({
      version: 1,
      accessToken: 'access', accessTokenExpiresAt: '2026-07-16T12:00:00.000Z',
      refreshToken: 'refresh', refreshTokenExpiresAt: '2027-01-16T12:00:00.000Z',
    })).rejects.toThrow('only supported on Android');
  });
});
