import { Platform } from 'react-native';

import { githubClientId } from '@/config/app';
import { systemClock } from '@/features/auth/contracts';
import { systemLocalCalendar } from '@/domain/spending';
import { TokenManager } from '@/features/auth/token-manager';

import { SecureCredentialStore, UnsupportedCredentialStore } from './storage/credential-store';
import { snapshotStore } from './storage/snapshot-store';
import { AuthenticatedGitHubClient } from './github/client';
import { GitHubGatewayImpl } from './github/gateway';
import { GitHubOAuthTransport } from './github/oauth';

export const credentialStore = Platform.OS === 'web' ? new UnsupportedCredentialStore() : new SecureCredentialStore();
export const oauthTransport = new GitHubOAuthTransport(githubClientId);
export const tokenManager = new TokenManager(credentialStore, oauthTransport, systemClock);
export const githubRequestClient = new AuthenticatedGitHubClient(tokenManager);
export const githubGateway = new GitHubGatewayImpl(githubRequestClient, systemClock);
export { snapshotStore, systemClock, systemLocalCalendar };
