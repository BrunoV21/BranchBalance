import { Redirect, Stack } from 'expo-router';

import { useSession } from '@/providers/session-provider';

export default function AuthLayout() {
  const { session } = useSession();
  if (session.status === 'authenticated') return <Redirect href="/groups" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
