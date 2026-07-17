import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function AppLayout() {
  const { session } = useSession();
  const { colors } = useTheme();
  if (session.status === 'unauthenticated') return <Redirect href={'/sign-in' as never} />;
  return <Stack screenOptions={{ headerShadowVisible: false, headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background } }}>
    <Stack.Screen name="groups/index" options={{ title: 'Your groups' }} />
    <Stack.Screen name="groups/new" options={{ title: 'Create a group', presentation: 'modal' }} />
    <Stack.Screen name="account" options={{ title: 'Account', presentation: 'modal' }} />
    <Stack.Screen name="groups/[owner]/[repo]" options={{ headerShown: false }} />
  </Stack>;
}
