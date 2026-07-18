import { Stack, useLocalSearchParams } from 'expo-router';

import { GroupProvider } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function SelectedGroupLayout() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { colors } = useTheme();
  if (!owner || !repo) return null;
  return <GroupProvider owner={owner} repo={repo}><Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }}>
    <Stack.Screen name="(tabs)" options={{ title: 'Group' }} />
    <Stack.Screen name="expenses/new" options={{ title: 'Add expense' }} />
    <Stack.Screen name="expenses/[id]/index" options={{ title: 'Expense details' }} />
    <Stack.Screen name="expenses/[id]/edit" options={{ title: 'Edit expense' }} />
    <Stack.Screen name="spending-plan/edit" options={{ title: 'Spending plan' }} />
  </Stack></GroupProvider>;
}
