import * as Linking from 'expo-linking';
import { Alert } from 'react-native';

import { Avatar, Body, Button, Card, Screen, Title } from '@/components/ui';
import { githubInstallationUrl } from '@/config/app';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function AccountScreen() {
  const { session, signOut } = useSession();
  const { preference, setPreference } = useTheme();
  if (!session.account) return null;
  const account = session.account;
  return <Screen>
    <Title eyebrow="GitHub account">Account</Title>
    <Card style={{ alignItems: 'center' }}><Avatar login={account.login} uri={account.avatarUrl} size={68} /><Body>{account.name ?? `@${account.login}`}</Body><Body muted>@{account.login}</Body></Card>
    <Card><Body>Theme: {preference}</Body>
      <Button variant="secondary" onPress={() => void setPreference('system')}>Use system theme</Button>
      <Button variant="secondary" onPress={() => void setPreference('light')}>Use light theme</Button>
      <Button variant="secondary" onPress={() => void setPreference('dark')}>Use dark theme</Button>
    </Card>
    <Button variant="secondary" onPress={() => void Linking.openURL(githubInstallationUrl)}>Manage GitHub App installation</Button>
    <Button variant="danger" onPress={() => Alert.alert('Sign out?', 'Tokens and cached group data will be removed from this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => void signOut() }])}>Sign out</Button>
  </Screen>;
}
