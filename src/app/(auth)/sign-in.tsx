import { useRouter } from 'expo-router';
import { Image, Platform } from 'react-native';

import { Body, Button, Card, Screen, Title } from '@/components/ui';
import { githubConfigurationError, isGitHubConfigured } from '@/config/app';
import { useSession } from '@/providers/session-provider';

export default function SignInScreen() {
  const router = useRouter();
  const { session } = useSession();
  return <Screen contentStyle={{ justifyContent: 'center' }}>
    <Image accessibilityLabel="BranchBalance" resizeMode="contain" source={require('../../../assets/images/icon.png')} style={{ width: 72, height: 72 }} />
    <Title eyebrow="Shared expenses, backed by GitHub">Balance life{`\n`}without a backend.</Title>
    <Body muted>Sign in with GitHub to create private expense groups with the people you trust.</Body>
    {session.error ? <Card><Body>{session.error}</Body></Card> : null}
    <Button disabled={!isGitHubConfigured || Platform.OS === 'web'} onPress={() => router.push('/device-code' as never)}>Sign in with GitHub</Button>
    {Platform.OS === 'web' ? <Body muted>Web is a UI preview. GitHub sign-in and secure token storage require Android.</Body> : null}
    {githubConfigurationError ? <Body muted>{githubConfigurationError}</Body> : null}
  </Screen>;
}
