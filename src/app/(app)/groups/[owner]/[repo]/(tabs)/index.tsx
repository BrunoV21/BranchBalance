import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserRound } from 'lucide-react-native';

import { Banner, Body, Button, Card, EmptyState, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { categoryLabel, isJustMeExpense, paymentMethodLabel } from '@/domain/spending';
import type { ExpenseFile } from '@/domain/types';
import { CategoryIcon, PaymentMethodIcon } from '@/features/expenses/metadata-icons';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { BudgetSummaryCard, MetadataItem } from '@/features/spending/components';
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
        {snapshot ? <Card><Body muted>Total group spending</Body><Text style={[styles.heroMoney, { color: colors.text }]}>{formatMoney(snapshot.spending?.totalSpentMinor ?? snapshot.balances.totalSpentMinor, snapshot.group.currency)}</Text><Body muted>{snapshot.members.length} accepted members · synced {new Date(snapshot.syncedAt).toLocaleString()}</Body></Card> : null}
        {snapshot?.spending?.budget ? <BudgetSummaryCard compact summary={snapshot.spending} currency={snapshot.group.currency} /> : null}
        {state.error ? <Banner tone="warning" action={<Button variant="ghost" onPress={refresh}>Retry</Button>}>{state.error}</Banner> : null}
        {snapshot?.warnings.map((warning) => <Banner key={`${warning.path}:${warning.reason}`}>Skipped {warning.path}: {warning.reason}</Banner>)}
        <View style={styles.actions}><View style={{ flex: 1 }}><Button disabled={!snapshot} onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner, repo } } as never)}>Add expense</Button></View><View style={{ flex: 1 }}><Button variant="secondary" disabled={!snapshot} onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/spending', params: { owner, repo } } as never)}>View spending</Button></View></View>
        {snapshot && snapshot.members.length < 2 ? <Body muted>Invite another member to use full-to-one splits.</Body> : null}
      </View>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.expense.description}`} onPress={() => open(item)}><Card>
        <View style={styles.row}><View style={{ flex: 1 }}><Text style={[styles.expenseTitle, { color: colors.text }]}>{item.expense.description}</Text></View><Text style={[styles.amount, { color: colors.text }]}>{formatMoney(item.expense.amount_minor, item.expense.currency)}</Text></View>
        <View style={styles.metadataGrid}>
          <View style={styles.metadataCell}><MetadataItem icon={<CategoryIcon category={item.expense.category ?? 'uncategorized'} size={18} />} label={categoryLabel(item.expense.category ?? 'uncategorized')} accessibilityLabel={`Category: ${categoryLabel(item.expense.category ?? 'uncategorized')}`} /></View>
          <View style={styles.metadataCell}><MetadataItem icon={<PaymentMethodIcon method={item.expense.payment_method ?? 'unspecified'} size={18} />} label={paymentMethodLabel(item.expense.payment_method ?? 'unspecified')} accessibilityLabel={`Payment method: ${paymentMethodLabel(item.expense.payment_method ?? 'unspecified')}`} /></View>
          <View style={[styles.metadataCell, styles.metadataCellWide]}><MetadataItem icon={<UserRound color={colors.accent} size={18} />} label={`@${item.expense.paid_by} · ${isJustMeExpense(item.expense) ? 'Just me' : item.expense.split_type === 'equal' ? `${item.expense.participants.length}-person equal split` : `Full to @${item.expense.participants[0]}`}`} accessibilityLabel={`Paid by @${item.expense.paid_by}; ${isJustMeExpense(item.expense) ? 'Just me expense' : item.expense.split_type === 'equal' ? `split equally between ${item.expense.participants.length} people` : `fully owed by @${item.expense.participants[0]}`}`} /></View>
        </View>
      </Card></Pressable>}
      ListEmptyComponent={state.status === 'loading' ? <EmptyState title="Refreshing group…" body="Loading members and expenses from GitHub." /> : <EmptyState title="No expenses yet" body="Add the first expense when this group has at least two members." />}
    />
  </SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 }, content: { flexGrow: 1, padding: 20, gap: 12 }, header: { gap: 14 }, actions: { flexDirection: 'row', gap: 8 }, heroMoney: { fontSize: 30, fontWeight: '800' }, row: { flexDirection: 'row', gap: 12, justifyContent: 'space-between' }, metadataGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 10 }, metadataCell: { flexBasis: '46%', flexGrow: 1, minWidth: 120 }, metadataCellWide: { flexBasis: '100%' }, expenseTitle: { fontSize: 17, fontWeight: '800' }, amount: { fontSize: 17, fontWeight: '800' } });
