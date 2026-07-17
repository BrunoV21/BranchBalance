import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, Body, Button, Card, EmptyState, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import type { ExpenseFile } from '@/domain/types';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function GroupOverviewScreen() {
  const router = useRouter();
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { colors } = useTheme();
  const { state } = useGroup();
  const refresh = useGroupRefresh();
  const snapshot = state.data;
  const open = (file: ExpenseFile) => router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]', params: { owner, repo, id: file.expense.id } } as never);
  return <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
    <FlatList data={snapshot?.expenses ?? []} keyExtractor={(item) => item.expense.id} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={state.isRefreshing} onRefresh={refresh} tintColor={colors.accent} />}
      ListHeaderComponent={<View style={styles.header}><Title eyebrow={snapshot?.group.name ?? 'BranchBalance'}>Group overview</Title>
        {snapshot ? <Card><Body muted>Total group spending</Body><Text style={[styles.heroMoney, { color: colors.text }]}>{formatMoney(snapshot.balances.totalSpentMinor, snapshot.group.currency)}</Text><Body muted>{snapshot.members.length} accepted members · synced {new Date(snapshot.syncedAt).toLocaleString()}</Body></Card> : null}
        {state.error ? <Banner tone="warning" action={<Button variant="ghost" onPress={refresh}>Retry</Button>}>{state.error}</Banner> : null}
        {snapshot?.warnings.map((warning) => <Banner key={`${warning.path}:${warning.reason}`}>Skipped {warning.path}: {warning.reason}</Banner>)}
        <Button disabled={!snapshot} onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner, repo } } as never)}>Add expense</Button>
        {snapshot && snapshot.members.length < 2 ? <Body muted>Invite another member to use full-to-one splits.</Body> : null}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.expense.description}`} onPress={() => open(item)}><Card>
        <View style={styles.row}><View style={{ flex: 1 }}><Text style={[styles.expenseTitle, { color: colors.text }]}>{item.expense.description}</Text><Body muted>{item.expense.expense_date} · paid by @{item.expense.paid_by}</Body></View><Text style={[styles.amount, { color: colors.text }]}>{formatMoney(item.expense.amount_minor, item.expense.currency)}</Text></View>
        <Body muted>{item.expense.split_type === 'equal' ? `Split equally between ${item.expense.participants.length}` : `Fully owed by @${item.expense.participants[0]}`} · created by @{item.expense.created_by}</Body>
        <Body muted>{item.expense.updated_at ? `Updated ${new Date(item.expense.updated_at).toLocaleString()} by @${item.expense.updated_by}` : `Created ${new Date(item.expense.created_at).toLocaleString()}`}</Body>
      </Card></Pressable>}
      ListEmptyComponent={state.status === 'loading' ? <EmptyState title="Refreshing group…" body="Loading members and expenses from GitHub." /> : <EmptyState title="No expenses yet" body="Add the first expense when this group has at least two members." />}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 12 }, header: { gap: 14 }, heroMoney: { fontSize: 30, fontWeight: '800' }, row: { flexDirection: 'row', gap: 12 }, expenseTitle: { fontSize: 17, fontWeight: '800' }, amount: { fontSize: 17, fontWeight: '800' } });
