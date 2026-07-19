import { discoverEligibleGroupInvitations, provisionalGroupName } from './eligibility';

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    repository: {
      id: 20,
      name: 'branch-balance-lisbon-weekend',
      full_name: 'maya/branch-balance-lisbon-weekend',
      private: true,
      owner: { login: 'maya', type: 'User' },
    },
    invitee: { login: 'Bruno' },
    inviter: { login: 'Maya' },
    permissions: 'write',
    created_at: '2026-07-19T12:00:00Z',
    ...overrides,
  };
}

describe('group invitation eligibility', () => {
  it('maps eligible personal private invitations and normalizes presentation fields', () => {
    const result = discoverEligibleGroupInvitations([invitation()], 'bruno');
    expect(result.warnings).toEqual([]);
    expect(result.invitations).toEqual([expect.objectContaining({
      id: 10,
      invitee: 'bruno',
      inviter: 'maya',
      permission: 'write',
      provisionalName: 'Lisbon Weekend',
      createdAt: '2026-07-19T12:00:00.000Z',
    })]);
  });

  it.each([
    ['read access', { permissions: 'read' }],
    ['triage access', { permissions: 'triage' }],
    ['wrong invitee', { invitee: { login: 'someone-else' } }],
    ['public repository', { repository: { ...invitation().repository as object, private: false } }],
    ['organization owner', { repository: { ...invitation().repository as object, owner: { login: 'org', type: 'Organization' }, full_name: 'org/branch-balance-lisbon-weekend' } }],
    ['unrelated repository', { repository: { ...invitation().repository as object, name: 'unrelated', full_name: 'maya/unrelated' } }],
    ['unsafe invitation ID', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['invalid date', { created_at: 'not-a-date' }],
  ])('isolates an ineligible %s without hiding valid rows', (_label, override) => {
    const result = discoverEligibleGroupInvitations([invitation(override), invitation({ id: 11 })], 'bruno');
    expect(result.invitations.map((item) => item.id)).toEqual([11]);
    expect(result.warnings).toHaveLength(1);
  });

  it('accepts maintain and admin, deduplicates agreement, excludes conflicting IDs, and sorts deterministically', () => {
    const newest = invitation({ id: 30, repository: { ...invitation().repository as object, id: 30, name: 'branch-balance-zulu', full_name: 'maya/branch-balance-zulu' }, permissions: 'admin', created_at: '2026-07-20T12:00:00Z' });
    const alpha = invitation({ id: 12, repository: { ...invitation().repository as object, id: 12, name: 'branch-balance-alpha', full_name: 'maya/branch-balance-alpha' }, permissions: 'maintain' });
    const conflict = invitation({ id: 12, repository: { ...invitation().repository as object, id: 99, name: 'branch-balance-other', full_name: 'maya/branch-balance-other' }, permissions: 'maintain' });
    const result = discoverEligibleGroupInvitations([alpha, newest, newest, conflict], 'bruno');
    expect(result.invitations.map((item) => item.id)).toEqual([30]);
    expect(result.warnings).toContainEqual(expect.objectContaining({ path: 'repository-invitation[id=12]' }));
  });

  it.each([
    ['branch-balance-lisbon---weekend', 'Lisbon Weekend'],
    ['branch-balance-', 'branch-balance-'],
    ['another-repository', 'Another Repository'],
  ])('derives a provisional name for %s', (repository, expected) => {
    expect(provisionalGroupName(repository)).toBe(expected);
  });
});
