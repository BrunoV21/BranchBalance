import { StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Card, EmptyState, Screen, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function BalancesScreen() {
  useGroupRefresh();
  const { state } = useGroup();
  const { colors } = useTheme();
  const snapshot = state.data;
  return <Screen>
    <Title eyebrow={snapshot?.group.name ?? 'BranchBalance'}>Balances</Title>
    {state.error ? <Banner tone="warning">{state.error}</Banner> : null}
    {!snapshot ? <EmptyState title="Loading balances…" body="Balances will appear after the group refreshes." /> : <>
      {!snapshot.balances.zeroSum ? <Banner tone="error">Balances do not sum to zero, so settlements are hidden.</Banner> : null}
      <Body>Member totals</Body>
      {snapshot.balances.members.map((member) => <Card key={member.login}><View style={styles.row}><View style={{ flex: 1 }}><Text style={[styles.name, { color: colors.text }]}>@{member.login}</Text><Body muted>Paid {formatMoney(member.totalPaidMinor, snapshot.group.currency)} · share {formatMoney(member.totalShareMinor, snapshot.group.currency)}</Body></View><Text style={{ color: member.netMinor >= 0 ? colors.positive : colors.negative, fontWeight: '800' }}>{member.netMinor >= 0 ? 'is owed ' : 'owes '}{formatMoney(Math.abs(member.netMinor), snapshot.group.currency)}</Text></View></Card>)}
      <Body>Suggested settlements</Body>
      {snapshot.settlements.length ? snapshot.settlements.map((settlement, index) => <Card key={`${settlement.from}:${settlement.to}:${index}`}><Body>@{settlement.from} owes @{settlement.to} {formatMoney(settlement.amountMinor, snapshot.group.currency)}</Body></Card>) : <EmptyState title="All settled" body="There are no suggested transfers for the current balances." />}
    </>}
  </Screen>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { fontSize: 16, fontWeight: '800' } });
