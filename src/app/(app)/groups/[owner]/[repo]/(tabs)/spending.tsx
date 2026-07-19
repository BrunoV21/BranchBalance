import { forwardRef, type ReactNode, useMemo, useRef, useState } from 'react';
import { type NativeStackNavigationProp, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { AccessibilityInfo, findNodeHandle, Pressable, type ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarDays, ListFilter, UserRound, UsersRound } from 'lucide-react-native';

import { Banner, Body, Button, Card, EmptyState, Screen, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { categoryBuckets, categoryLabel, emptySpendingFilters, expenseCategories, filterExpenses, formatPercentage, paymentMethodBuckets, paymentMethodLabel, paymentMethods, type CategoryBucket, type PaymentMethodBucket, type SpendingFilters } from '@/domain/spending';
import type { ExpenseFile } from '@/domain/types';
import { CategoryIcon, PaymentMethodIcon } from '@/features/expenses/metadata-icons';
import { DatePickerDialog } from '@/features/expenses/date-picker-dialog';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { DailySpendCard, formatCalendarDate, PaceChartCard, ScopeMixCard, SpendingPulse } from '@/features/spending/analytics-components';
import { BudgetSummaryCard, FilterChip, MetadataItem, ProgressBar } from '@/features/spending/components';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

type GroupStackRoutes = {
  '(tabs)': undefined;
  'spending-plan/edit': undefined;
};

export default function SpendingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { owner, repo } = useLocalSearchParams<{ owner: string; repo: string }>();
  const { colors } = useTheme();
  const { state } = useGroup();
  useGroupRefresh();
  const [filters, setFilters] = useState<SpendingFilters>(emptySpendingFilters);
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [explorerY, setExplorerY] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const explorerHeadingRef = useRef<Text>(null);
  const snapshot = state.data;
  const summary = snapshot?.spending;
  const payerOptions = useMemo(() => {
    const logins = new Map<string, string>();
    for (const file of snapshot?.expenses ?? []) logins.set(file.expense.paid_by.toLowerCase(), file.expense.paid_by);
    return [...logins.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }, [snapshot?.expenses]);
  const filtered = useMemo(() => {
    if (!snapshot) return [];
    const ids = new Set(filterExpenses(snapshot.expenses.map((file) => file.expense), filters).map((expense) => expense.id));
    return snapshot.expenses.filter((file) => ids.has(file.expense.id));
  }, [filters, snapshot]);
  const patchFilter = <K extends keyof SpendingFilters>(key: K, value: SpendingFilters[K]) => setFilters((current) => ({ ...current, [key]: value }));
  const applyAnalyticsFilter = (patch: Partial<SpendingFilters>, label: string) => {
    if (!snapshot) return;
    const next = { ...filters, ...patch };
    const count = filterExpenses(snapshot.expenses.map((file) => file.expense), next).length;
    setFilters(next);
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: Math.max(0, explorerY - 12), animated: true });
      const handle = findNodeHandle(explorerHeadingRef.current);
      if (handle) AccessibilityInfo.setAccessibilityFocus(handle);
      AccessibilityInfo.announceForAccessibility(`${label}. ${count} ${count === 1 ? 'expense' : 'expenses'} shown.`);
    }, 0);
  };
  const openExpense = (file: ExpenseFile) => router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]', params: { owner, repo, id: file.expense.id } } as never);
  const openPlan = () => navigation.getParent<NativeStackNavigationProp<GroupStackRoutes>>()?.push('spending-plan/edit');
  const addExpense = () => router.push({ pathname: '/groups/[owner]/[repo]/expenses/new', params: { owner, repo } } as never);

  if (!snapshot) return <Screen><Title>Spending</Title><EmptyState title="Loading spending…" body="Spending insights appear after the group refreshes." /></Screen>;

  return <Screen scrollViewRef={scrollRef}>
    <View style={styles.titleRow}><View style={{ flex: 1 }}><Title eyebrow={snapshot.group.name}>Spending</Title></View><Button variant="secondary" onPress={openPlan}>Spending plan</Button></View>
    {state.error ? <Banner tone="warning">{state.error}</Banner> : null}
    {summary ? <>
      {summary.budget ? <BudgetSummaryCard summary={summary} currency={snapshot.group.currency} /> : <Card><Body>No total budget yet</Body><Body muted>Spending is still tracked. Add a shared budget or optional period when the group is ready.</Body><Button onPress={openPlan}>Set up spending plan</Button></Card>}
      {!summary.budget && summary.trip && snapshot.group.spending_plan?.starts_on ? <Card><Body>Budget period</Body><Body>{snapshot.group.spending_plan.starts_on} → {snapshot.group.spending_plan.ends_on}</Body><Body muted>{summary.trip.phase === 'before' ? `${summary.trip.totalDays} planned days` : summary.trip.phase === 'during' ? `Day ${summary.trip.currentDay} of ${summary.trip.totalDays}` : `${summary.trip.totalDays}-day period completed`}</Body></Card> : null}
      <View style={styles.insights}><Insight label="Group spent" value={formatMoney(summary.totalSpentMinor, snapshot.group.currency)} /><Insight label="You paid" value={formatMoney(summary.currentUserPaidMinor, snapshot.group.currency)} /><Insight label="Your share" value={formatMoney(summary.currentUserShareMinor, snapshot.group.currency)} /></View>

      {snapshot.expenses.length === 0 ? <EmptyState title="No expenses yet" body="Add an expense to start building category and payment-method insights." action={<Button onPress={addExpense}>Add expense</Button>} /> : <>
        {summary.analytics.pace ? <><SectionTitle>Budget pace</SectionTitle><PaceChartCard analytics={summary.analytics} currency={snapshot.group.currency} /></> : null}

        <SectionTitle>Day by day</SectionTitle>
        <DailySpendCard analytics={summary.analytics} currency={snapshot.group.currency} onSelectDate={(date) => applyAnalyticsFilter({ date }, `Filtered to ${formatCalendarDate(date)}`)} />

        {summary.analytics.insights.some((insight) => insight.kind !== 'pace') ? <><SectionTitle>Spending pulse</SectionTitle><SpendingPulse insights={summary.analytics.insights} currency={snapshot.group.currency} /></> : null}

        <SectionTitle>Category mix</SectionTitle>
        <Body muted>Accent bars compare share of total spending. Limit bars are labelled separately.</Body>
        {[...categoryBuckets].sort((left, right) => {
          const leftRank = summary.analytics.categoryMix.findIndex((item) => item.category === left);
          const rightRank = summary.analytics.categoryMix.findIndex((item) => item.category === right);
          if (leftRank >= 0 && rightRank >= 0) return leftRank - rightRank;
          if (leftRank >= 0) return -1;
          if (rightRank >= 0) return 1;
          return categoryBuckets.indexOf(left) - categoryBuckets.indexOf(right);
        }).filter((category) => summary.categorySpentMinor[category] > 0 || (category !== 'uncategorized' && summary.budget?.categoryLimits[category])).map((category) => {
          const spent = summary.categorySpentMinor[category];
          const limit = category === 'uncategorized' ? undefined : summary.budget?.categoryLimits[category];
          const share = summary.totalSpentMinor ? (spent / summary.totalSpentMinor) * 100 : 0;
          const categoryAccessibility = `${categoryLabel(category)}, ${formatMoney(spent, snapshot.group.currency)}, ${formatPercentage(share)} of all spending}${limit ? `, ${formatPercentage(limit.percentageUsed)} of its ${formatMoney(limit.limitMinor, snapshot.group.currency)} category limit` : ', no category limit'}. Filter expenses to ${categoryLabel(category)}.`;
          return <Pressable key={category} accessibilityRole="button" accessibilityLabel={categoryAccessibility} onPress={() => applyAnalyticsFilter({ category }, `Filtered to ${categoryLabel(category)}`)}><Card>
            <View style={styles.between}><View style={{ flex: 1 }}><View style={styles.labelWithIcon}><CategoryIcon category={category} size={20} /><Text style={[styles.rowTitle, { color: colors.text }]}>{categoryLabel(category)}</Text></View><Body muted>{category === 'uncategorized' ? `Legacy expenses · ${formatPercentage(share)} of spending` : `${formatPercentage(share)} of all spending`}</Body></View><View style={{ alignItems: 'flex-end' }}><Text style={[styles.rowValue, { color: colors.text }]}>{formatMoney(spent, snapshot.group.currency)}</Text>{limit ? <Body muted>of {formatMoney(limit.limitMinor, snapshot.group.currency)}</Body> : null}</View></View>
            <ProgressBar percentage={share} label={`${categoryLabel(category)} is ${formatPercentage(share)} of all spending.`} />
            {limit ? <><ProgressBar percentage={limit.percentageUsed} label={`${categoryLabel(category)} is ${formatPercentage(limit.percentageUsed)} of its category limit.`} tone={limit.status === 'over' ? 'negative' : 'positive'} />{limit.status === 'over' ? <Body style={{ color: colors.negative }}>{formatMoney(Math.abs(limit.remainingMinor), snapshot.group.currency)} over category limit</Body> : null}</> : null}
          </Card></Pressable>;
        })}

        <SectionTitle>Shared vs Just me</SectionTitle>
        <ScopeMixCard analytics={summary.analytics} currency={snapshot.group.currency} selected={filters.scope} onSelect={(scope) => applyAnalyticsFilter({ scope }, `Filtered to ${scope === 'just_me' ? 'Just me' : 'Shared'} expenses`)} />

        <SectionTitle>By payment method</SectionTitle>
        <PaymentBreakdown summary={summary.paymentMethodSpentMinor} total={summary.totalSpentMinor} currency={snapshot.group.currency} />

        <View onLayout={(event) => setExplorerY(event.nativeEvent.layout.y)}><SectionTitle ref={explorerHeadingRef}>Expense explorer</SectionTitle></View>
        <Card>
          <FilterGroup label="Date"><FilterChip selected={filters.date === 'all'} accessibilityLabel="All dates" onPress={() => patchFilter('date', 'all')} icon={<CalendarDays color={filters.date === 'all' ? colors.accent : colors.muted} size={17} />}>All dates</FilterChip><FilterChip selected={filters.date !== 'all'} accessibilityLabel={filters.date === 'all' ? 'Choose date' : `Selected date ${formatCalendarDate(filters.date)}`} onPress={() => setShowDateFilter(true)} icon={<CalendarDays color={filters.date !== 'all' ? colors.accent : colors.muted} size={17} />}>{filters.date === 'all' ? 'Choose date' : formatCalendarDate(filters.date, { month: 'short', day: 'numeric' })}</FilterChip></FilterGroup>
          <FilterGroup label="Category">{(['all', ...expenseCategories, 'uncategorized'] as const).map((value) => {
            const selected = filters.category === value;
            const label = value === 'all' ? 'All categories' : categoryLabel(value);
            return <FilterChip key={value} selected={selected} accessibilityLabel={label} onPress={() => patchFilter('category', value as 'all' | CategoryBucket)} icon={value === 'all' ? <ListFilter color={selected ? colors.accent : colors.muted} size={17} /> : <CategoryIcon category={value} color={selected ? colors.accent : colors.muted} size={17} />}>{label}</FilterChip>;
          })}</FilterGroup>
          <FilterGroup label="Payment">{(['all', ...paymentMethods, 'unspecified'] as const).map((value) => {
            const selected = filters.paymentMethod === value;
            const label = value === 'all' ? 'All methods' : paymentMethodLabel(value);
            return <FilterChip key={value} selected={selected} accessibilityLabel={label} onPress={() => patchFilter('paymentMethod', value as 'all' | PaymentMethodBucket)} icon={value === 'all' ? <ListFilter color={selected ? colors.accent : colors.muted} size={17} /> : <PaymentMethodIcon method={value} color={selected ? colors.accent : colors.muted} size={17} />}>{label}</FilterChip>;
          })}</FilterGroup>
          <FilterGroup label="Paid by"><FilterChip selected={filters.payer === 'all'} accessibilityLabel="Anyone" onPress={() => patchFilter('payer', 'all')} icon={<UsersRound color={filters.payer === 'all' ? colors.accent : colors.muted} size={17} />}>Anyone</FilterChip>{payerOptions.map((payer) => {
            const selected = filters.payer.toLowerCase() === payer.toLowerCase();
            return <FilterChip key={payer} selected={selected} accessibilityLabel={`@${payer}`} onPress={() => patchFilter('payer', payer)} icon={<UserRound color={selected ? colors.accent : colors.muted} size={17} />}>@{payer}</FilterChip>;
          })}</FilterGroup>
          <FilterGroup label="Expense type">{(['all', 'shared', 'just_me'] as const).map((value) => {
            const selected = filters.scope === value;
            const label = value === 'all' ? 'Shared & Just me' : value === 'shared' ? 'Shared' : 'Just me';
            return <FilterChip key={value} selected={selected} accessibilityLabel={label} onPress={() => patchFilter('scope', value)} icon={value === 'just_me' ? <UserRound color={selected ? colors.accent : colors.muted} size={17} /> : <UsersRound color={selected ? colors.accent : colors.muted} size={17} />}>{label}</FilterChip>;
          })}</FilterGroup>
          <View style={styles.between}><Body>{filtered.length} {filtered.length === 1 ? 'expense' : 'expenses'} shown</Body><Button variant="ghost" onPress={() => setFilters(emptySpendingFilters)}>Clear filters</Button></View>
        </Card>
        {filtered.length ? filtered.map((file) => <ExpenseRow key={file.expense.id} file={file} onPress={() => openExpense(file)} />) : <EmptyState title="No matching expenses" body="Clear one or more filters to see tracked spending." action={<Button variant="secondary" onPress={() => setFilters(emptySpendingFilters)}>Clear filters</Button>} />}
        <Button onPress={addExpense}>Add expense</Button>
      </>}
      {showDateFilter ? <DatePickerDialog value={filters.date === 'all' ? summary.analytics.today : filters.date} onCancel={() => setShowDateFilter(false)} onConfirm={(date) => { setFilters((current) => ({ ...current, date })); setShowDateFilter(false); }} /> : null}
    </> : <Banner tone="error">Spending totals are unavailable because the current snapshot contains an unsafe aggregate. Review the data warning and refresh after correcting the repository data.</Banner>}
  </Screen>;
}

function Insight({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return <Card style={styles.insight}><Body muted>{label}</Body><Text style={[styles.insightValue, { color: colors.text }]}>{value}</Text></Card>;
}

const SectionTitle = forwardRef<Text, { children: string }>(function SectionTitle({ children }, ref) {
  const { colors } = useTheme();
  return <Text ref={ref} accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text>;
});

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return <View style={styles.filterGroup}><Body>{label}</Body><View accessibilityRole="radiogroup" style={styles.chips}>{children}</View></View>;
}

function ExpenseRow({ file, onPress }: { file: ExpenseFile; onPress(): void }) {
  const { colors } = useTheme();
  const expense = file.expense;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${expense.description}`} onPress={onPress}><Card><View style={styles.between}><Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>{expense.description}</Text><Text style={[styles.rowValue, { color: colors.text }]}>{formatMoney(expense.amount_minor, expense.currency)}</Text></View><View style={styles.expenseMetadata}><MetadataItem icon={<CalendarDays color={colors.accent} size={18} />} label={formatCalendarDate(expense.expense_date, { month: 'short', day: 'numeric' })} accessibilityLabel={`Expense date: ${formatCalendarDate(expense.expense_date)}`} /><MetadataItem icon={<CategoryIcon category={expense.category ?? 'uncategorized'} size={18} />} label={categoryLabel(expense.category ?? 'uncategorized')} accessibilityLabel={`Category: ${categoryLabel(expense.category ?? 'uncategorized')}`} /><MetadataItem icon={<PaymentMethodIcon method={expense.payment_method ?? 'unspecified'} size={18} />} label={paymentMethodLabel(expense.payment_method ?? 'unspecified')} accessibilityLabel={`Payment method: ${paymentMethodLabel(expense.payment_method ?? 'unspecified')}`} /><MetadataItem icon={<UserRound color={colors.accent} size={18} />} label={`@${expense.paid_by}`} accessibilityLabel={`Paid by @${expense.paid_by}`} /></View></Card></Pressable>;
}

function PaymentBreakdown({ summary, total, currency }: { summary: Record<PaymentMethodBucket, number>; total: number; currency: 'EUR' | 'USD' | 'GBP' }) {
  const { colors } = useTheme();
  const rows = paymentMethodBuckets.filter((method) => summary[method] > 0);
  const palette = [colors.accent, colors.positive, colors.muted, colors.warning];
  const label = rows.map((method) => `${paymentMethodLabel(method)} ${formatMoney(summary[method], currency)}`).join(', ');
  return <Card>
    <View accessibilityRole="image" accessibilityLabel={label} style={[styles.methodBar, { backgroundColor: colors.border }]}>{rows.map((method, index) => <View key={method} style={{ width: `${total ? (summary[method] / total) * 100 : 0}%` as `${number}%`, backgroundColor: palette[index], height: '100%' }} />)}</View>
    {rows.map((method, index) => <View key={method} style={styles.between}><View style={styles.methodLabel}><PaymentMethodIcon method={method} color={palette[index]} size={18} /><Body>{paymentMethodLabel(method)}{method === 'unspecified' ? ' (legacy)' : ''}</Body></View><Body>{formatMoney(summary[method], currency)} · {formatPercentage(total ? (summary[method] / total) * 100 : 0)}</Body></View>)}
  </Card>;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, insights: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, insight: { minWidth: '30%', flexGrow: 1, padding: 13 }, insightValue: { fontSize: 18, fontWeight: '800' },
  sectionTitle: { fontSize: 19, fontWeight: '800', marginTop: 8 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, labelWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 8 }, rowTitle: { fontSize: 16, fontWeight: '800' }, rowValue: { fontSize: 16, fontWeight: '800' }, expenseMetadata: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 7 },
  filterGroup: { gap: 8 }, chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, methodBar: { height: 12, borderRadius: 999, flexDirection: 'row', overflow: 'hidden' }, methodLabel: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
