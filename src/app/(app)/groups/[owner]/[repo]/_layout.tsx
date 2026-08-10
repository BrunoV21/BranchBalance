import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { GroupProvider, useGroup } from '@/providers/group-provider';
import { ReceiptDraftProvider } from '@/features/receipt-scanning/receipt-draft-provider';
import { useTheme } from '@/providers/theme-provider';
import { effectiveGroupType } from '@/domain/groups';
import { Banner, Body, Button, Card, Screen, Title } from '@/components/ui';

export default function SelectedGroupLayout() {
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  if (!owner || !repo) return null;
  return <GroupProvider owner={owner} repo={repo}><ReceiptDraftProvider key={`${owner}/${repo}`} groupKey={`${owner}/${repo}`}><SelectedGroupNavigator /></ReceiptDraftProvider></GroupProvider>;
}

function SelectedGroupNavigator() {
  const { accessLost, state } = useGroup();
  const { colors } = useTheme();
  if (accessLost) return <Redirect href={'/groups' as never} />;
  if (state.data && !effectiveGroupType(state.data.group)) return <UnsupportedGroupTypeScreen />;
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

function UnsupportedGroupTypeScreen() {
  const router = useRouter();
  const { state } = useGroup();
  const snapshot = state.data!;
  return <Screen>
    <Title eyebrow="Update required">{snapshot.group.name}</Title>
    <Banner tone="warning">This group uses a type that this BranchBalance version does not understand. It is read-only to protect its repository data.</Banner>
    <Card><Body>Currency: {snapshot.group.currency}</Body><Body>Repository owner: @{snapshot.repository.owner}</Body><Body muted>No expenses, members, plans, balances, or type-specific data were loaded.</Body></Card>
    <Button variant="secondary" onPress={() => router.replace('/groups' as never)}>Back to groups</Button>
  </Screen>;
}
