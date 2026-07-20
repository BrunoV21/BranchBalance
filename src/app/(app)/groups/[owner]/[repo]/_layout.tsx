import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { GroupProvider, useGroup } from '@/providers/group-provider';
import { ReceiptDraftProvider } from '@/features/receipt-scanning/receipt-draft-provider';
import { useTheme } from '@/providers/theme-provider';

export default function SelectedGroupLayout() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  if (!owner || !repo) return null;
  return <GroupProvider owner={owner} repo={repo}><ReceiptDraftProvider key={`${owner}/${repo}`}><SelectedGroupNavigator /></ReceiptDraftProvider></GroupProvider>;
}

function SelectedGroupNavigator() {
  const { accessLost } = useGroup();
  const { colors } = useTheme();
  if (accessLost) return <Redirect href={'/groups' as never} />;
  return <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false }}>
    <Stack.Screen name="(tabs)" options={{ title: 'Group' }} />
    <Stack.Screen name="expenses/new" options={{ title: 'Add expense' }} />
    <Stack.Screen name="expenses/scan" options={{ title: 'Scan receipt' }} />
    <Stack.Screen name="expenses/[id]/index" options={{ title: 'Expense details' }} />
    <Stack.Screen name="expenses/[id]/edit" options={{ title: 'Edit expense' }} />
    <Stack.Screen name="spending-plan/edit" options={{ title: 'Spending plan' }} />
    <Stack.Screen name="settlements/new" options={{ title: 'Record payment' }} />
  </Stack>;
}
