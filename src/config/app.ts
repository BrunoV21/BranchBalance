export const appPrefix = 'branch-balance';
export const githubClientId = process.env.EXPO_PUBLIC_GITHUB_CLIENT_ID?.trim() ?? '';
export const githubAppSlug = process.env.EXPO_PUBLIC_GITHUB_APP_SLUG?.trim() ?? '';
export const githubInstallationUrl = githubAppSlug ? `https://github.com/apps/${githubAppSlug}/installations/new` : 'https://github.com/settings/installations';
export const githubAuthorizationSettingsUrl = 'https://github.com/settings/apps/authorizations';
export const githubDeviceUrl = 'https://github.com/login/device';
export const githubGroupTypeRequestUrl = 'https://github.com/BrunoV21/BranchBalance/issues/new?template=group_type_request.yml';

export function configurationErrorFor(clientId: string, appSlug: string): string | null {
  if (!clientId) return 'Set EXPO_PUBLIC_GITHUB_CLIENT_ID to the client ID from your GitHub App.';
  if (clientId.startsWith('Ov')) return 'EXPO_PUBLIC_GITHUB_CLIENT_ID belongs to an OAuth App. Use the client ID from a GitHub App instead.';
  if (!appSlug) return 'Set EXPO_PUBLIC_GITHUB_APP_SLUG to your GitHub App slug.';
  return null;
}

export const githubConfigurationError = configurationErrorFor(githubClientId, githubAppSlug);
export const isGitHubConfigured = githubConfigurationError === null;
