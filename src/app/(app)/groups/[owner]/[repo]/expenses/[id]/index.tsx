import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarClock, CalendarDays, ChevronDown, ChevronUp, GitCommitHorizontal, PencilLine, UserRound, UsersRound } from 'lucide-react-native';

import { Banner, Body, Button, Card, ConfirmDialog, EmptyState, Screen, Title } from '@/components/ui';
import { effectiveGroupType } from '@/domain/groups';
import { formatMoney } from '@/domain/money';
import { categoryLabel, isJustMeExpense, paymentMethodLabel } from '@/domain/spending';
import { CategoryIcon, PaymentMethodIcon } from '@/features/expenses/metadata-icons';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { MetadataItem } from '@/features/spending/components';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function ExpenseDetailScreen() {
  const { owner, repo, id } = useLocalSearchParams<{ owner: string; repo: string; id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { state, deleteExpense, refresh } = useGroup();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const file = state.data?.expenses.find((item) => item.expense.id === id);
  if (!file) return <Screen><EmptyState title="Expense unavailable" body="It may have been deleted on another device." action={<Button onPress={() => void refresh().catch(() => undefined)}>Refresh group</Button>} /></Screen>;
  const expense = file.expense;
  const groupType = state.data ? effectiveGroupType(state.data.group) : null;
  const confirmDelete = async () => {
    setDeleting(true); setError(null);
    try { await deleteExpense(file); router.back(); }
    catch (cause) { setShowDelete(false); setError(cause instanceof Error ? cause.message : 'Unable to delete this expense.'); }
    finally { setDeleting(false); }
  };
  const justMe = isJustMeExpense(expense);
  const splitLabel = justMe ? 'Just me' : expense.split_type === 'equal' ? 'Equal split' : 'Full to one';
  const activityCount = 2 + (expense.updated_at ? 1 : 0);
  return <Screen>
    <Title eyebrow={state.data && groupType ? groupContextLabel(groupType, state.data.group.name) : state.data?.group.name}>Expense details</Title>
    <Card><Text style={[styles.description, { color: colors.text }]}>{expense.description}</Text><Text style={[styles.heroAmount, { color: colors.text }]}>{formatMoney(expense.amount_minor, expense.currency)}</Text><View style={styles.metadataGrid}><View style={styles.metadataCell}><MetadataItem icon={<CategoryIcon category={expense.category ?? 'uncategorized'} size={19} />} label={categoryLabel(expense.category ?? 'uncategorized')} accessibilityLabel={`Category: ${categoryLabel(expense.category ?? 'uncategorized')}`} /></View><View style={styles.metadataCell}><MetadataItem icon={<PaymentMethodIcon method={expense.payment_method ?? 'unspecified'} size={19} />} label={paymentMethodLabel(expense.payment_method ?? 'unspecified')} accessibilityLabel={`Payment method: ${paymentMethodLabel(expense.payment_method ?? 'unspecified')}`} /></View><View style={styles.metadataCell}><MetadataItem icon={<UserRound color={colors.accent} size={19} />} label={`@${expense.paid_by}`} accessibilityLabel={`Paid by @${expense.paid_by}`} /></View><View style={styles.metadataCell}><MetadataItem icon={<CalendarDays color={colors.accent} size={19} />} label={expense.expense_date} accessibilityLabel={`Expense date ${expense.expense_date}`} /></View></View></Card>
    <Card><View style={styles.sectionHeading}>{justMe ? <UserRound color={colors.accent} size={21} /> : <UsersRound color={colors.accent} size={21} />}<Text style={[styles.sectionTitle, { color: colors.text }]}>{splitLabel}</Text></View><View style={styles.shareList}>{Object.entries(expense.shares_minor).map(([login, share]) => <View key={login} style={styles.shareRow}><MetadataItem icon={<UserRound color={colors.accent} size={18} />} label={`@${login}`} accessibilityLabel={`Share assigned to @${login}`} /><Text style={[styles.shareAmount, { color: colors.text }]}>{formatMoney(share, expense.currency)}</Text></View>)}</View></Card>
    {groupType === 'trip' && expense.line_items?.length ? <Card><Text style={[styles.sectionTitle, { color: colors.text }]}>Line items</Text>{expense.line_items.map((item, index) => <View key={index} style={styles.shareRow}><View style={{ flex: 1 }}><Body>{item.description}</Body>{item.quantity || item.unit_price_minor !== undefined ? <Body muted>{item.quantity ? `${item.quantity} × ` : ''}{item.unit_price_minor !== undefined ? formatMoney(item.unit_price_minor, expense.currency) : 'unit price unavailable'}</Body> : null}</View><Body>{formatMoney(item.line_total_minor, expense.currency)}</Body></View>)}<Body muted>Informational only · does not change Amount or shares.</Body></Card> : null}
    {groupType === 'fuel' ? <Card><Text style={[styles.sectionTitle, { color: colors.text }]}>Fuel details</Text>{expense.type_data ? <><DetailRow label="Litres" value={`${formatScaled(expense.type_data.volume_millilitres, 3)} L`} /><DetailRow label="Printed price per litre" value={expense.type_data.unit_price_micros_per_litre === undefined ? 'Not recorded' : `${expense.currency} ${formatScaled(expense.type_data.unit_price_micros_per_litre, 6)}/L`} /><DetailRow label="Pre-discount total" value={expense.type_data.gross_amount_minor === undefined ? 'Not recorded' : formatMoney(expense.type_data.gross_amount_minor, expense.currency)} /><DetailRow label="Discount" value={expense.type_data.discount_minor === undefined ? 'Not recorded' : formatMoney(expense.type_data.discount_minor, expense.currency)} /><DetailRow label="Fuel type" value={expense.type_data.fuel_type ?? 'Not recorded'} /></> : <Body muted>Amount-only expense. Litres, unit price, savings, and fuel type were not recorded.</Body>}</Card> : null}
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel="Activity log" accessibilityState={{ expanded: activityExpanded }} onPress={() => setActivityExpanded((value) => !value)} style={styles.activityToggle}><View style={{ flex: 1 }}><Text style={[styles.sectionTitle, { color: colors.text }]}>Activity log</Text><Body muted>{activityCount} {activityCount === 1 ? 'entry' : 'entries'} · repository-backed history</Body></View>{activityExpanded ? <ChevronUp color={colors.accent} size={22} /> : <ChevronDown color={colors.accent} size={22} />}</Pressable>
      {activityExpanded ? <View style={styles.activityList}>
        <ActivityEntry icon={<CalendarClock color={colors.accent} size={18} />} title="Created" timestamp={expense.created_at} actor={expense.created_by} />
        {expense.updated_at && expense.updated_by ? <ActivityEntry icon={<PencilLine color={colors.accent} size={18} />} title="Updated" timestamp={expense.updated_at} actor={expense.updated_by} /> : null}
        <ActivityEntry icon={<GitCommitHorizontal color={colors.accent} size={18} />} title="Repository revision" detail={`Blob ${file.blobSha.slice(0, 10)}`} />
      </View> : null}
    </Card>
    {error ? <Banner tone="error" action={<Button variant="ghost" onPress={() => void refresh().catch(() => undefined)}>Review latest</Button>}>{error}</Banner> : null}
    <Button onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]/edit', params: { owner, repo, id } } as never)}>Edit expense</Button>
    <Button variant="danger" onPress={() => setShowDelete(true)}>Delete expense</Button>
    <ConfirmDialog visible={showDelete} title={`Delete “${expense.description}”?`} message={`${formatMoney(expense.amount_minor, expense.currency)} will be removed from spending and balance calculations. Git history remains available.`} confirmLabel="Delete" loading={deleting} onCancel={() => setShowDelete(false)} onConfirm={() => void confirmDelete()} />
  </Screen>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.shareRow}><Body muted>{label}</Body><Body>{value}</Body></View>;
}

function formatScaled(value: number, scale: number): string {
  const raw = String(value).padStart(scale + 1, '0');
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function ActivityEntry({ icon, title, timestamp, actor, detail }: { icon: React.ReactNode; title: string; timestamp?: string; actor?: string; detail?: string }) {
  const { colors } = useTheme();
  return <View style={[styles.activityEntry, { borderColor: colors.border }]}><View style={[styles.activityIcon, { backgroundColor: colors.surfaceStrong }]}>{icon}</View><View style={{ flex: 1 }}><Text style={[styles.activityTitle, { color: colors.text }]}>{title}</Text>{timestamp ? <Body muted>{new Date(timestamp).toLocaleString()}</Body> : null}{actor ? <Body muted>@{actor}</Body> : null}{detail ? <Text style={[styles.revision, { color: colors.muted }]}>{detail}</Text> : null}</View></View>;
}

const styles = StyleSheet.create({
  description: { fontSize: 22, fontWeight: '800' }, heroAmount: { fontSize: 28, fontWeight: '800' }, metadataGrid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 11 }, metadataCell: { flexBasis: '46%', flexGrow: 1, minWidth: 120 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 }, sectionTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' }, shareList: { gap: 8 }, shareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, shareAmount: { fontSize: 16, fontWeight: '800' },
  activityToggle: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }, activityList: { gap: 0 }, activityEntry: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth }, activityIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, activityTitle: { fontSize: 15, fontWeight: '800' }, revision: { fontFamily: 'monospace', fontSize: 13, lineHeight: 20 },
});
