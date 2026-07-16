import { createOAuthDeviceAuth } from '@octokit/auth-oauth-device';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

import { githubClientId } from '@/config/app';

const ACCESS_TOKEN_KEY = 'github-access-token';

export async function signInWithGitHub(onUserCode: (userCode: string) => void): Promise<string> {
  if (!githubClientId) {
    throw new Error('EXPO_PUBLIC_GITHUB_CLIENT_ID is not configured.');
  }

  const auth = createOAuthDeviceAuth({
    clientId: githubClientId,
    clientType: 'github-app',
    onVerification: async ({ user_code, verification_uri }) => {
      onUserCode(user_code);
      await WebBrowser.openBrowserAsync(verification_uri);
    },
  });
  const result = await auth({ type: 'oauth' });

  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, result.token);
  return result.token;
}

export function getStoredAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export function clearStoredAccessToken(): Promise<void> {
  return SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
}
