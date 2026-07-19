import { AppFailure } from '@/domain/errors';
import type { GitHubGateway } from '@/infrastructure/github/contracts';
import { MemoryKeyValueStore, SnapshotStoreImpl } from '@/infrastructure/storage/snapshot-store';

import { createGroupRepository } from './create-group';

const repository = { id: 1, owner: 'alice', name: 'branch-balance-trip', defaultBranch: 'trunk', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const input = { accountId: 7, login: 'alice', name: 'Trip', currency: 'EUR' as const, canCreate: true, clock: { now: () => new Date('2026-07-16T12:00:00.000Z') } };
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'alice', created_at: '2026-07-16T12:00:00.000Z' };

function gateway(overrides: Partial<GitHubGateway> = {}) {
  return { createPrivateRepository: jest.fn().mockResolvedValue(repository), createGroupFile: jest.fn().mockResolvedValue({ value: { group, blobSha: 'blob', path: 'group.json', sourceDocument: group }, commit: null }), ...overrides } as unknown as GitHubGateway;
}

describe('createGroupRepository', () => {
  it('creates only the private repository and group file', async () => {
    const store = new SnapshotStoreImpl(new MemoryKeyValueStore());
    const remote = gateway();
    const result = await createGroupRepository({ ...input, gateway: remote, store });
    expect(remote.createPrivateRepository).toHaveBeenCalledWith('branch-balance-trip');
    expect(remote.createGroupFile).toHaveBeenCalledWith(repository, expect.objectContaining({ name: 'Trip', currency: 'EUR' }));
    expect(result.value.key).toBe('alice/branch-balance-trip');
  });

  it('persists partial creation for bootstrap-only recovery', async () => {
    const store = new SnapshotStoreImpl(new MemoryKeyValueStore());
    const remote = gateway({ createGroupFile: jest.fn().mockRejectedValue(new Error('failed')) });
    await expect(createGroupRepository({ ...input, gateway: remote, store })).rejects.toMatchObject({ detail: { kind: 'partial_group_creation' } });
    expect(await store.readPendingGroup(7)).toMatchObject({ repository: { id: 1 }, group: { name: 'Trip' } });
    expect(remote.createPrivateRepository).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous repository request', async () => {
    const store = new SnapshotStoreImpl(new MemoryKeyValueStore());
    const remote = gateway({ createPrivateRepository: jest.fn().mockRejectedValue(new AppFailure({ kind: 'network', retryable: true })) });
    await expect(createGroupRepository({ ...input, gateway: remote, store })).rejects.toMatchObject({ detail: { kind: 'github', status: 0, retryable: false } });
    expect(remote.createPrivateRepository).toHaveBeenCalledTimes(1);
  });
});
