import { useMemo, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ChevronLeft, ChevronRight, Fuel, UserRound } from 'lucide-react-native';

import { Banner, Body, Button, Card, EmptyState, Screen, Title } from '@/components/ui';
import { deriveFuelAnalytics, nextMonth, normalizeStation, previousMonth } from '@/domain/analytics';
import { formatMoney } from '@/domain/money';
import { isJustMeExpense, paymentMethodLabel, paymentMethods } from '@/domain/spending';
import type { ExpenseFile, MonthKey, RemoteGroupSnapshot } from '@/domain/types';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { FilterChip, ProgressBar } from '@/features/spending/components';
import { systemLocalCalendar } from '@/infrastructure/runtime';
import { useTheme } from '@/providers/theme-provider';

type Scope = 'all' | 'shared' | 'just_me';

export function FuelSpendingScreen({ snapshot, openPlan }: { snapshot: RemoteGroupSnapshot; openPlan(): void }) {
  const router = useRouter();
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { colors } = useTheme();
  const [month, setMonth] = useState<MonthKey>((snapshot.analytics?.type === 'fuel' ? snapshot.analytics.fuel.selectedMonth.month : systemLocalCalendar.today().slice(0, 7)) as MonthKey);
  const [station, setStation] = useState('all');
  const [payment, setPayment] = useState('all');
  const [payer, setPayer] = useState('all');
  const [scope, setScope] = useState<Scope>('all');
  const analytics = useMemo(() => deriveFuelAnalytics(snapshot.expenses.map((file) => file.expense), snapshot.group.spending_plan, systemLocalCalendar.today(), month), [month, snapshot.expenses, snapshot.group.spending_plan]);
  const monthExpenses = useMemo(() => snapshot.expenses.filter((file) => file.expense.expense_date.slice(0, 7) === month), [month, snapshot.expenses]);
  const filtered = useMemo(() => monthExpenses.filter((file) => {
    const expense = file.expense;
    return (station === 'all' || normalizeStation(expense.description) === station)
      && (payment === 'all' || expense.payment_method === payment)
      && (payer === 'all' || expense.paid_by.toLowerCase() === payer.toLowerCase())
      && (scope === 'all' || (scope === 'just_me') === isJustMeExpense(expense));
  }), [monthExpenses, payer, payment, scope, station]);
  const summary = analytics.selectedMonth;
  const grossMinor = monthExpenses.reduce((sum, file) => sum + (file.expense.type_data?.gross_amount_minor ?? 0), 0);
  const payerOptions = [...new Set(monthExpenses.map((file) => file.expense.paid_by))].sort();
  const maxPaid = Math.max(...analytics.monthlySeries.map((row) => Math.max(row.paidMinor, row.applicableLimitMinor ?? 0)), 1);
  const clearFilters = () => { setStation('all'); setPayment('all'); setPayer('all'); setScope('all'); };
  const openExpense = (file: ExpenseFile) => router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]', params: { owner, repo, id: file.expense.id } } as never);

  return <Screen>
    <View style={styles.titleRow}><View style={{ flex: 1 }}><Title eyebrow={groupContextLabel('fuel', snapshot.group.name)}>Fuel spending</Title></View><Button variant="secondary" onPress={openPlan}>Monthly limits</Button></View>
    <View style={styles.monthNav}><Button variant="ghost" accessibilityLabel="Previous month" onPress={() => setMonth(previousMonth(month))}><ChevronLeft color={colors.text} /></Button><View style={{ alignItems: 'center' }}><Body muted>Selected month</Body><Text style={[styles.month, { color: colors.text }]}>{formatMonth(month)}</Text></View><Button variant="ghost" accessibilityLabel="Next month" onPress={() => setMonth(nextMonth(month))}><ChevronRight color={colors.text} /></Button></View>
    <Card><Body muted>Amount paid this month</Body><Text style={[styles.hero, { color: colors.text }]}>{formatMoney(summary.paidMinor, snapshot.group.currency)}</Text>{summary.applicableLimitMinor === null ? <Body>No monthly limit applies.</Body> : <><Body>{summary.status === 'over' ? `${formatMoney(Math.abs(summary.remainingMinor!), snapshot.group.currency)} over` : summary.status === 'at' ? 'Exactly at' : `${formatMoney(summary.remainingMinor!, snapshot.group.currency)} remaining from`} the {formatMoney(summary.applicableLimitMinor, snapshot.group.currency)} limit.</Body><ProgressBar percentage={summary.paidMinor / summary.applicableLimitMinor * 100} tone={summary.status === 'over' ? 'negative' : 'positive'} label={`${formatMoney(summary.paidMinor, snapshot.group.currency)} paid against ${formatMoney(summary.applicableLimitMinor, snapshot.group.currency)} monthly limit.`} /></>}</Card>
    <View style={styles.metrics}><Metric label="Fill-ups" value={String(summary.expenseCount)} /><Metric label="Represented litres" value={formatLitres(summary.representedVolumeMl)} /><Metric label="Effective paid price" value={summary.weightedPaidPrice ? formatPaidUnitPrice(summary.weightedPaidPrice.numerator, summary.weightedPaidPrice.denominator, snapshot.group.currency) : 'Not enough data'} /><Metric label="Explicit discounts" value={formatMoney(summary.explicitDiscountMinor, snapshot.group.currency)} /></View>
    <Banner tone={analytics.coverage.withVolume === analytics.coverage.expenseCount ? 'info' : 'warning'}>{analytics.coverage.withVolume} of {analytics.coverage.expenseCount} expenses include litres. Amount-only expenses still count toward spending and the monthly limit.</Banner>

    <Section title="Monthly spend versus limit" />
    {analytics.monthlySeries.map((row) => <Pressable key={row.month} accessibilityRole="button" accessibilityState={{ selected: row.month === month }} accessibilityLabel={`${formatMonth(row.month)}, paid ${formatMoney(row.paidMinor, snapshot.group.currency)}${row.applicableLimitMinor === null ? ', no limit' : `, limit ${formatMoney(row.applicableLimitMinor, snapshot.group.currency)}`}`} onPress={() => setMonth(row.month)}><Card><View style={styles.between}><Body>{formatMonth(row.month)}</Body><Body>{formatMoney(row.paidMinor, snapshot.group.currency)}{row.applicableLimitMinor === null ? '' : ` / ${formatMoney(row.applicableLimitMinor, snapshot.group.currency)}`}</Body></View><ProgressBar percentage={row.paidMinor / maxPaid * 100} label={`${formatMonth(row.month)} paid amount bar.`} tone={row.status === 'over' ? 'negative' : 'positive'} /></Card></Pressable>)}

    <Section title="Fuel volume and unit-price trend" />
    <Card><Body>{formatLitres(summary.representedVolumeMl)} represented in {formatMonth(month)}</Body>{monthExpenses.filter((file) => file.expense.type_data?.unit_price_micros_per_litre).map((file) => <View key={file.expense.id} style={styles.between}><View style={{ flex: 1 }}><Body>{file.expense.description}</Body><Body muted>{file.expense.expense_date} · {formatLitres(file.expense.type_data!.volume_millilitres)}</Body></View><Body>{formatPrintedUnitPrice(file.expense.type_data!.unit_price_micros_per_litre!, snapshot.group.currency)}</Body></View>)}{!analytics.coverage.withPrintedPrice ? <Body muted>No printed unit prices are represented this month.</Body> : null}</Card>

    <Section title="Savings" />
    <Card><Detail label="Represented pre-discount total" value={formatMoney(grossMinor, snapshot.group.currency)} /><Detail label="All amount paid" value={formatMoney(summary.paidMinor, snapshot.group.currency)} /><Detail label="Explicit discounts" value={formatMoney(summary.explicitDiscountMinor, snapshot.group.currency)} /><Body muted>Discount totals include only {summary.expensesWithExplicitDiscount} expenses with an explicit value; missing discounts are never assumed to be zero.</Body></Card>

    <Section title="Stations" />
    {analytics.stationRows.map((row) => <Pressable key={row.key} accessibilityRole="button" accessibilityState={{ selected: station === row.key }} onPress={() => setStation(station === row.key ? 'all' : row.key)}><Card><View style={styles.between}><View style={{ flex: 1 }}><Body>{row.label}</Body><Body muted>{row.expenseCount} fill-ups · {formatLitres(row.representedVolumeMl)}</Body></View><Body>{formatMoney(row.paidMinor, snapshot.group.currency)}</Body></View></Card></Pressable>)}

    <Section title="Data coverage" />
    <Card><Detail label="Expenses" value={String(analytics.coverage.expenseCount)} /><Detail label="Valid Fuel details" value={String(analytics.coverage.withValidFuelData)} /><Detail label="Litres" value={String(analytics.coverage.withVolume)} /><Detail label="Printed price" value={String(analytics.coverage.withPrintedPrice)} /><Detail label="Pre-discount total" value={String(analytics.coverage.withGross)} /><Detail label="Explicit discount" value={String(analytics.coverage.withExplicitDiscount)} /></Card>

    <Section title="Expense explorer" />
    <Card><FilterGroup label="Payment">{(['all', ...paymentMethods] as const).map((value) => <FilterChip key={value} selected={payment === value} accessibilityLabel={value === 'all' ? 'All payment methods' : paymentMethodLabel(value)} onPress={() => setPayment(value)}>{value === 'all' ? 'All methods' : paymentMethodLabel(value)}</FilterChip>)}</FilterGroup><FilterGroup label="Paid by"><FilterChip selected={payer === 'all'} accessibilityLabel="Anyone" onPress={() => setPayer('all')}>Anyone</FilterChip>{payerOptions.map((value) => <FilterChip key={value} selected={payer === value} accessibilityLabel={`@${value}`} onPress={() => setPayer(value)}>@{value}</FilterChip>)}</FilterGroup><FilterGroup label="Expense type">{(['all', 'shared', 'just_me'] as const).map((value) => <FilterChip key={value} selected={scope === value} accessibilityLabel={value === 'all' ? 'Shared and Just me' : value === 'just_me' ? 'Just me' : 'Shared'} onPress={() => setScope(value)}>{value === 'all' ? 'Shared & Just me' : value === 'just_me' ? 'Just me' : 'Shared'}</FilterChip>)}</FilterGroup><View style={styles.between}><Body>{filtered.length} shown</Body><Button variant="ghost" onPress={clearFilters}>Clear filters</Button></View></Card>
    {filtered.length ? filtered.map((file) => <Pressable key={file.expense.id} accessibilityRole="button" accessibilityLabel={`Open ${file.expense.description}`} onPress={() => openExpense(file)}><Card><View style={styles.between}><View style={{ flex: 1 }}><Body>{file.expense.description}</Body><Body muted><CalendarDays size={14} color={colors.muted} /> {file.expense.expense_date} · <UserRound size={14} color={colors.muted} /> @{file.expense.paid_by}</Body></View><Body>{formatMoney(file.expense.amount_minor, snapshot.group.currency)}</Body></View></Card></Pressable>) : <EmptyState icon={<Fuel color={colors.muted} size={44} />} title="No matching Fuel expenses" body="Choose another month or clear one or more filters." />}
  </Screen>;
}

function Metric({ label, value }: { label: string; value: string }) { const { colors } = useTheme(); return <Card style={styles.metric}><Body muted>{label}</Body><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></Card>; }
function Section({ title }: { title: string }) { const { colors } = useTheme(); return <Text accessibilityRole="header" style={[styles.section, { color: colors.text }]}>{title}</Text>; }
function Detail({ label, value }: { label: string; value: string }) { return <View style={styles.between}><Body muted>{label}</Body><Body>{value}</Body></View>; }
function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) { return <View style={styles.filter}><Body>{label}</Body><View style={styles.chips}>{children}</View></View>; }
function formatMonth(month: MonthKey) { const [year, value] = month.split('-').map(Number); return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year!, value! - 1, 1))); }
function formatLitres(value: number) { return `${formatScaled(value, 3)} L`; }
function formatPrintedUnitPrice(value: number, currency: string) { return `${currency} ${formatScaled(value, 6)}/L`; }
function formatPaidUnitPrice(paidMinor: number, volumeMl: number, currency: string) { const thousandths = Number((BigInt(paidMinor) * 10_000n + BigInt(Math.floor(volumeMl / 2))) / BigInt(volumeMl)); return `${currency} ${formatScaled(thousandths, 3)}/L`; }
function formatScaled(value: number, scale: number) { const raw = String(value).padStart(scale + 1, '0'); return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, ''); }

const styles = StyleSheet.create({ titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, month: { fontSize: 18, fontWeight: '800' }, hero: { fontSize: 30, fontWeight: '900' }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 }, metric: { flexBasis: '46%', flexGrow: 1 }, metricValue: { fontSize: 17, fontWeight: '800' }, section: { fontSize: 19, fontWeight: '800', marginTop: 8 }, between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, filter: { gap: 7 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 } });
