import { MemoryKeyValueStore, SnapshotStoreImpl } from './snapshot-store';
import { emptyActivityInbox } from '@/features/activity/model';
import type { RemoteGroupSnapshot } from '@/domain/types';
import { UnsupportedCredentialStore } from './credential-store';

describe('SnapshotStore', () => {
  it('round trips versioned user-scoped data', async () => {
    const keyValue = new MemoryKeyValueStore();
    const store = new SnapshotStoreImpl(keyValue);
    const snapshot = {
      key: 'owner/repo',
      repository: { id: 1, owner: 'owner', name: 'repo', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
      group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-16T00:00:00.000Z' },
      groupFile: null, members: [], pendingMembers: [], expenses: [],
      balances: { totalSpentMinor: 0, members: [], zeroSum: true }, settlements: [], spending: null, warnings: [],
      syncedAt: '2026-07-16T00:00:00.000Z',
    } satisfies RemoteGroupSnapshot;
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

  it('redacts settlement notes and passthrough ledger content from persistent snapshots', async () => {
    const keyValue = new MemoryKeyValueStore();
    const store = new SnapshotStoreImpl(keyValue);
    const payment = {
      id: '8f6cdb85-4677-44af-8d16-e6f70ea54b8a', from: 'friend', to: 'owner', amount_minor: 300, currency: 'EUR' as const,
      paid_on: '2026-07-19', note: 'External transaction ID: private-reference', status: 'pending' as const,
      recorded_by: 'friend', recorded_at: '2026-07-19T12:00:00.000Z', confirmed_by: null, confirmed_at: null,
    };
    const snapshot = {
      key: 'owner/repo',
      repository: { id: 1, owner: 'owner', name: 'repo', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
      group: { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-16T00:00:00.000Z' },
      groupFile: null, members: [], pendingMembers: [], expenses: [],
      balances: { totalSpentMinor: 0, members: [], zeroSum: true }, settlements: [],
      settlementLedger: { kind: 'ready' as const, file: { payments: [payment], blobSha: 'sha', path: 'settlements.json' as const, sourceDocument: { schema_version: 1, payments: [payment], future: 'private-source' }, warnings: [] } },
      payments: [payment], reservations: [], spending: null, warnings: [], syncedAt: '2026-07-19T12:00:00.000Z',
    } satisfies RemoteGroupSnapshot;
    await store.writeGroup(7, 'owner/repo', snapshot);
    const raw = await keyValue.get('bb:v1:group:7:owner%2Frepo');
    expect(raw).not.toContain('private-reference');
    expect(raw).not.toContain('private-source');
    expect(await store.readGroup(7, 'owner/repo')).toMatchObject({ settlementLedger: { kind: 'unverified' }, payments: [{ id: payment.id, hasNote: true }] });
  });

  it('persists validated account-scoped activity and clears it with the account', async () => {
    const memory = new MemoryKeyValueStore();
    const store = new SnapshotStoreImpl(memory);
    const activity = emptyActivityInbox('2026-07-19T12:00:00.000Z');

    await store.writeActivity(7, activity);
    expect(await store.readActivity(7)).toEqual(activity);
    expect(await store.readActivity(8)).toBeNull();

    await store.clearAccount(7);
    expect(await store.readActivity(7)).toBeNull();
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
