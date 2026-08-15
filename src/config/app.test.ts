import { configurationErrorFor, githubGroupTypeRequestUrl } from './app';

describe('GitHub configuration', () => {
  it('rejects OAuth App credentials because BranchBalance requires a GitHub App', () => {
    expect(configurationErrorFor('Ov23li0123456789abcd', 'branch-balance-dev')).toBe(
      'EXPO_PUBLIC_GITHUB_CLIENT_ID belongs to an OAuth App. Use the client ID from a GitHub App instead.',
    );
  });

  it('accepts a GitHub App client ID and slug', () => {
    expect(configurationErrorFor('Iv23li0123456789abcd', 'branch-balance-dev')).toBeNull();
  });

  it('uses the fixed dedicated public Issue Form for group-type requests', () => {
    expect(githubGroupTypeRequestUrl).toBe(
      'https://github.com/BrunoV21/BranchBalance/issues/new?template=group_type_request.yml',
    );
  });
});
