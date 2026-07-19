import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View, VirtualizedList } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { Body, Card } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { calendarDateAtOffset, calendarDayOrdinal, categoryLabel, formatPercentage } from '@/domain/spending';
import { normalizeLogin, type CurrencyCode, type ExpenseFundingAnalytics, type SpendingAnalytics, type SpendingInsight, type SpendingPaceAnalytics } from '@/domain/types';
import { useTheme, type ThemeColors } from '@/providers/theme-provider';

type DailyItem = { date: string; amountMinor: number };

export function PaceChartCard({ analytics, currency }: { analytics: SpendingAnalytics; currency: CurrencyCode }) {
  const { colors } = useTheme();
  const pace = analytics.pace;
  if (!pace) return null;
  const direction = paceDirection(pace, currency, colors);
  return <Card>
    <View style={styles.between}><View style={styles.flex}><Body muted>Pace · day {pace.elapsedDays} of {pace.totalDays}</Body><Text style={[styles.cardTitle, { color: direction.color }]}>{direction.label}</Text></View><Body muted>{currency}</Body></View>
    <Body muted>Even budget pace spreads the total budget evenly. It is a reference, not a forecast.</Body>
    {analytics.daily.distinctExpenseDateCount >= 2 ? <PaceGraphic pace={pace} currency={currency} accessible /> : <Body muted>One recorded expense date is not enough to draw a spending trend.</Body>}
    <View style={styles.metricRow}>
      <Metric label="Actual to date" value={formatMoney(pace.actualToDateMinor, currency)} />
      <Metric label="Even pace" value={formatMoney(pace.evenPaceMinor, currency)} />
      <Metric label="Difference" value={`${pace.deltaMinor > 0 ? '+' : pace.deltaMinor < 0 ? '−' : ''}${formatMoney(Math.abs(pace.deltaMinor), currency)}`} />
    </View>
  </Card>;
}

export function CompactPaceSummary({ analytics, currency }: { analytics: SpendingAnalytics; currency: CurrencyCode }) {
  const { colors } = useTheme();
  const pace = analytics.pace;
  if (!pace) return null;
  const direction = paceDirection(pace, currency, colors);
  return <View style={styles.compactPace}>
    <View style={styles.between}><Text style={[styles.compactConclusion, { color: direction.color }]}>{direction.label}</Text><Body muted>Not a forecast</Body></View>
    {analytics.daily.distinctExpenseDateCount >= 2 ? <PaceGraphic pace={pace} currency={currency} compact /> : null}
    <Body muted>Actual {formatMoney(pace.actualToDateMinor, currency)} · even pace {formatMoney(pace.evenPaceMinor, currency)}</Body>
  </View>;
}

function PaceGraphic({ pace, currency, compact = false, accessible = false }: { pace: SpendingPaceAnalytics; currency: CurrencyCode; compact?: boolean; accessible?: boolean }) {
  const { colors } = useTheme();
  const width = 320;
  const height = compact ? 58 : 124;
  const padding = compact ? 5 : 10;
  const plotHeight = height - padding * 2;
  const plotWidth = width - padding * 2;
  const startOrdinal = calendarDayOrdinal(pace.referenceEvents[0]!.date);
  const divisor = Math.max(pace.totalDays - 1, 1);
  const scaleMax = Math.max(1, ...pace.events.map((event) => event.cumulativeMinor), ...pace.referenceEvents.map((event) => event.cumulativeMinor));
  const x = (date: string) => padding + ((calendarDayOrdinal(date) - startOrdinal) / divisor) * plotWidth;
  const y = (amount: number) => padding + plotHeight - (amount / scaleMax) * plotHeight;
  const path = (events: { date: string; cumulativeMinor: number }[]) => events.map((event, index) => `${index ? 'L' : 'M'}${x(event.date).toFixed(2)} ${y(event.cumulativeMinor).toFixed(2)}`).join(' ');
  const actualPath = path(pace.events);
  const referencePath = path(pace.referenceEvents);
  const last = pace.events.at(-1)!;
  const areaPath = `${actualPath} L${x(last.date).toFixed(2)} ${(height - padding).toFixed(2)} L${x(pace.events[0]!.date).toFixed(2)} ${(height - padding).toFixed(2)} Z`;
  const label = `Cumulative tracked spending is ${formatMoney(pace.actualToDateMinor, currency)} on day ${pace.elapsedDays}. Even budget pace is ${formatMoney(pace.evenPaceMinor, currency)}. The difference is ${formatMoney(Math.abs(pace.deltaMinor), currency)} ${pace.direction} even pace.`;
  return <View accessible={accessible} accessibilityRole={accessible ? 'image' : undefined} accessibilityLabel={accessible ? label : undefined} style={compact ? styles.compactChart : styles.chart}>
    <Svg accessible={false} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke={colors.border} strokeWidth={1} />
      <Line x1={x(last.date)} y1={padding} x2={x(last.date)} y2={height - padding} stroke={colors.border} strokeWidth={1} />
      <Path d={areaPath} fill={colors.accent} opacity={0.12} />
      <Path d={referencePath} fill="none" stroke={colors.muted} strokeDasharray="6 5" strokeWidth={2} />
      <Path d={actualPath} fill="none" stroke={colors.accent} strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} />
      <Circle cx={x(last.date)} cy={y(last.cumulativeMinor)} r={compact ? 3 : 4} fill={colors.surface} stroke={colors.accent} strokeWidth={2.5} />
    </Svg>
    {!compact ? <View style={styles.legend}><Legend color={colors.accent}>Tracked spending</Legend><Legend color={colors.muted} dashed>Even budget pace</Legend></View> : null}
  </View>;
}

export function DailySpendCard({ analytics, currency, onSelectDate }: { analytics: SpendingAnalytics; currency: CurrencyCode; onSelectDate(date: string): void }) {
  const { colors } = useTheme();
  const listRef = useRef<VirtualizedList<DailyItem>>(null);
  const daily = analytics.daily;
  const bucketMap = useMemo(() => new Map(daily.buckets.map((bucket) => [bucket.date, bucket.amountMinor])), [daily.buckets]);
  const displayedBuckets = daily.period ? daily.buckets.filter((bucket) => bucket.date >= daily.period!.startsOn && bucket.date <= daily.period!.endsOn) : daily.buckets;
  const maxAmount = Math.max(1, ...displayedBuckets.map((bucket) => bucket.amountMinor));
  const count = daily.period?.totalDays ?? daily.buckets.length;
  if (count === 0) return null;
  const getItem = (_data: SpendingAnalytics['daily'], index: number): DailyItem => {
    const date = daily.period ? calendarDateAtOffset(daily.period.startsOn, index) : daily.buckets[index]!.date;
    return { date, amountMinor: bucketMap.get(date) ?? 0 };
  };
  const initialIndex = daily.period && analytics.today >= daily.period.startsOn && analytics.today <= daily.period.endsOn
    ? Math.max(0, calendarDayOrdinal(analytics.today) - calendarDayOrdinal(daily.period.startsOn) - 2)
    : 0;
  return <Card>
    <Body muted>Daily tracked spending</Body>
    <Text style={[styles.cardTitle, { color: colors.text }]}>Recorded spending by day</Text>
    <Body muted>Zero-spend dates remain visible. Future-dated tracked expenses are not a forecast.</Body>
    {daily.preTripMinor > 0 ? <Body>Before period · {formatMoney(daily.preTripMinor, currency)}</Body> : null}
    <VirtualizedList
      ref={listRef}
      horizontal
      data={daily}
      getItem={getItem}
      getItemCount={() => count}
      getItemLayout={(_data, index) => ({ length: 66, offset: 66 * index, index })}
      initialScrollIndex={Math.min(initialIndex, count - 1)}
      keyExtractor={(item) => item.date}
      onScrollToIndexFailed={({ index }) => listRef.current?.scrollToOffset({ offset: 66 * index, animated: false })}
      renderItem={({ item }) => {
        const future = item.date > analytics.today;
        const height = Math.max(3, Math.round((item.amountMinor / maxAmount) * 82));
        const dateLabel = formatCalendarDate(item.date, { month: 'short', day: 'numeric' });
        return <Pressable accessibilityRole="button" accessibilityLabel={`Filter expenses to ${formatCalendarDate(item.date)}, ${formatMoney(item.amountMinor, currency)} tracked${future ? ', future date' : ''}`} onPress={() => onSelectDate(item.date)} style={styles.dayColumn}>
          <View style={[styles.dayBarArea, { borderBottomColor: colors.border }]}><View style={[styles.dayBar, { height, backgroundColor: future ? colors.muted : colors.accent, opacity: future ? 0.55 : 1 }]} /></View>
          <Text style={[styles.dayAmount, { color: colors.text }]}>{formatMoney(item.amountMinor, currency)}</Text>
          <Text style={[styles.dayDate, { color: item.date === analytics.today ? colors.accent : colors.muted }]}>{item.date === analytics.today ? 'Today' : dateLabel}</Text>
          {future ? <Text style={[styles.futureLabel, { color: colors.muted }]}>Future</Text> : null}
        </Pressable>;
      }}
      showsHorizontalScrollIndicator={false}
      style={styles.dayList}
      windowSize={7}
    />
    {daily.afterTripMinor > 0 ? <Body>After period · {formatMoney(daily.afterTripMinor, currency)}</Body> : null}
    {daily.futureDatedMinor > 0 ? <Body muted>{formatMoney(daily.futureDatedMinor, currency)} is recorded on future expense dates and is included in the total budget.</Body> : null}
  </Card>;
}

export function SpendingPulse({ insights, currency }: { insights: SpendingInsight[]; currency: CurrencyCode }) {
  const { colors } = useTheme();
  const visible = insights.filter((insight) => insight.kind !== 'pace');
  if (!visible.length) return null;
  return <View style={styles.pulseList}>{visible.map((insight) => {
    const copy = insightCopy(insight, currency);
    return <Card key={insightKey(insight)}><Text style={[styles.pulseTitle, { color: copy.tone === 'negative' ? colors.negative : copy.tone === 'positive' ? colors.positive : colors.text }]}>{copy.title}</Text><Body muted>{copy.body}</Body></Card>;
  })}</View>;
}

export function ScopeMixCard({ analytics, currency, selected, onSelect }: { analytics: SpendingAnalytics; currency: CurrencyCode; selected: 'all' | 'shared' | 'just_me'; onSelect(scope: 'shared' | 'just_me'): void }) {
  const { colors } = useTheme();
  const { sharedMinor, justMeMinor } = analytics.scopeMix;
  const total = sharedMinor + justMeMinor;
  if (!total) return null;
  const sharedPercentage = (sharedMinor / total) * 100;
  const justMePercentage = (justMeMinor / total) * 100;
  return <Card>
    <Text style={[styles.cardTitle, { color: colors.text }]}>{formatMoney(sharedMinor, currency)} shared · {formatMoney(justMeMinor, currency)} Just me</Text>
    <Body muted>Just me expenses still remain visible to the group and count toward its budget.</Body>
    <View accessible accessibilityRole="image" accessibilityLabel={`Shared spending ${formatMoney(sharedMinor, currency)}, ${formatPercentage(sharedPercentage)}. Just me spending ${formatMoney(justMeMinor, currency)}, ${formatPercentage(justMePercentage)}.`} style={[styles.stack, { backgroundColor: colors.border }]}>
      <View style={{ width: `${sharedPercentage}%`, backgroundColor: colors.accent }} /><View style={{ width: `${justMePercentage}%`, backgroundColor: colors.positive }} />
    </View>
    <View style={styles.scopeButtons}>
      <ScopeButton label="Shared" value={`${formatMoney(sharedMinor, currency)} · ${formatPercentage(sharedPercentage)}`} color={colors.accent} selected={selected === 'shared'} onPress={() => onSelect('shared')} />
      <ScopeButton label="Just me" value={`${formatMoney(justMeMinor, currency)} · ${formatPercentage(justMePercentage)}`} color={colors.positive} selected={selected === 'just_me'} onPress={() => onSelect('just_me')} />
    </View>
  </Card>;
}

export function ExpenseFundingCard({ analytics, currency, currentLogin }: { analytics: ExpenseFundingAnalytics; currency: CurrencyCode; currentLogin: string }) {
  const { colors } = useTheme();
  const hasFunding = analytics.rows.some((row) => row.paidMinor > 0 || row.shareMinor > 0);
  return <Card>
    <Body muted>Fairness · expenses only</Body>
    <Text style={[styles.cardTitle, { color: colors.text }]}>Who fronted the group?</Text>
    <View style={styles.legend}><Legend color={colors.accent}>Paid</Legend><Legend color={colors.positive}>Share</Legend></View>
    {hasFunding ? analytics.rows.map((row) => {
      const paidWidth = `${(row.paidMinor / analytics.scaleMaxMinor) * 100}%` as `${number}%`;
      const shareWidth = `${(row.shareMinor / analytics.scaleMaxMinor) * 100}%` as `${number}%`;
      const gapLabel = row.gapMinor > 0 ? `+${formatMoney(row.gapMinor, currency)}` : row.gapMinor < 0 ? `−${formatMoney(Math.abs(row.gapMinor), currency)}` : formatMoney(0, currency);
      return <View key={normalizeLogin(row.login)} accessible accessibilityRole="image" accessibilityLabel={`${normalizeLogin(row.login) === normalizeLogin(currentLogin) ? 'You, ' : ''}@${row.login}: paid ${formatMoney(row.paidMinor, currency)}, share ${formatMoney(row.shareMinor, currency)}, expense funding gap ${gapLabel}.`} style={styles.fundingRow}>
        <View style={styles.fundingHeader}><Text numberOfLines={1} style={[styles.fundingName, { color: colors.text }]}>@{row.login}{normalizeLogin(row.login) === normalizeLogin(currentLogin) ? ' · you' : ''}</Text><Text style={{ color: row.gapMinor >= 0 ? colors.positive : colors.negative, fontWeight: '800' }}>{gapLabel}</Text></View>
        <View style={styles.fundingValue}><Body muted>Paid {formatMoney(row.paidMinor, currency)}</Body><View style={[styles.fundingTrack, { backgroundColor: colors.border }]}><View style={[styles.fundingFill, { width: paidWidth, backgroundColor: colors.accent }]} /></View></View>
        <View style={styles.fundingValue}><Body muted>Share {formatMoney(row.shareMinor, currency)}</Body><View style={[styles.fundingTrack, { backgroundColor: colors.border }]}><View style={[styles.fundingFill, { width: shareWidth, backgroundColor: colors.positive }]} /></View></View>
      </View>;
    }) : <Body muted>No expense funding to compare yet.</Body>}
    <Body muted>Paid minus Share is the expense funding gap. Confirmed settlement payments affect the net balances below, not this chart.</Body>
  </Card>;
}

function Metric({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return <View style={styles.metric}><Text style={[styles.metricLabel, { color: colors.muted }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text></View>;
}

function Legend({ children, color, dashed = false }: { children: string; color: string; dashed?: boolean }) {
  return <View style={styles.legendItem}><View style={[styles.legendSwatch, { backgroundColor: dashed ? 'transparent' : color, borderTopColor: color, borderTopWidth: dashed ? 2 : 0, borderStyle: dashed ? 'dashed' : 'solid' }]} /><Body muted>{children}</Body></View>;
}

function ScopeButton({ label, value, color, selected, onPress }: { label: string; value: string; color: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.scopeButton, { borderColor: selected ? color : colors.border, backgroundColor: colors.surfaceStrong }]}><View style={styles.scopeLabel}><View style={[styles.scopeDot, { backgroundColor: color }]} /><Body>{label}</Body></View><Text style={[styles.scopeValue, { color: colors.text }]}>{value}</Text></Pressable>;
}

function paceDirection(pace: SpendingPaceAnalytics, currency: CurrencyCode, colors: ThemeColors) {
  const amount = formatMoney(Math.abs(pace.deltaMinor), currency);
  return {
    color: pace.direction === 'above' ? colors.negative : pace.direction === 'below' ? colors.positive : colors.text,
    label: pace.direction === 'on' ? 'On even budget pace' : `${amount} ${pace.direction} even pace`,
  };
}

function insightCopy(insight: SpendingInsight, currency: CurrencyCode): { title: string; body: string; tone: 'neutral' | 'positive' | 'negative' } {
  switch (insight.kind) {
    case 'pace': return { title: `${formatMoney(Math.abs(insight.deltaMinor), currency)} ${insight.direction} even pace`, body: `Actual ${formatMoney(insight.actualToDateMinor, currency)} · even pace ${formatMoney(insight.evenPaceMinor, currency)}.`, tone: insight.direction === 'above' ? 'negative' : insight.direction === 'below' ? 'positive' : 'neutral' };
    case 'budget_overage': return { title: `Group spending is ${formatMoney(insight.overMinor, currency)} over budget`, body: 'The budget remains informational and does not block new expenses.', tone: 'negative' };
    case 'category_overage': return { title: `${categoryLabel(insight.category)} is ${formatMoney(insight.overMinor, currency)} over its limit`, body: `${formatMoney(insight.spentMinor, currency)} spent against ${formatMoney(insight.limitMinor, currency)}.`, tone: 'negative' };
    case 'largest_category': return { title: `${categoryLabel(insight.category)} drives ${formatPercentage(insight.sharePercentage)} of spending`, body: `It is the largest category at ${formatMoney(insight.spentMinor, currency)}.`, tone: 'neutral' };
    case 'funding_gap': return insight.gapMinor > 0
      ? { title: `You fronted ${formatMoney(insight.gapMinor, currency)} more than your share`, body: 'Expense funding only; confirmed settlements affect your net balance.', tone: 'positive' }
      : { title: `Your share is ${formatMoney(Math.abs(insight.gapMinor), currency)} more than you paid`, body: 'Expense funding only; confirmed settlements affect your net balance.', tone: 'neutral' };
    case 'highest_day': return { title: `${formatCalendarDate(insight.date, { month: 'short', day: 'numeric' })} is the highest recorded day`, body: `${formatMoney(insight.amountMinor, currency)} of tracked spending.`, tone: 'neutral' };
    case 'scope_split': return { title: `${formatMoney(insight.sharedMinor, currency)} shared · ${formatMoney(insight.justMeMinor, currency)} Just me`, body: 'Both amounts count toward total tracked spending.', tone: 'neutral' };
  }
}

function insightKey(insight: SpendingInsight): string {
  if (insight.kind === 'category_overage' || insight.kind === 'largest_category') return `${insight.kind}:${insight.category}`;
  if (insight.kind === 'highest_day') return `${insight.kind}:${insight.date}`;
  return insight.kind;
}

export function formatCalendarDate(date: string, options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, options);
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, between: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, cardTitle: { fontSize: 17, lineHeight: 23, fontWeight: '800' },
  chart: { gap: 7 }, compactChart: { marginVertical: 2 }, compactPace: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(128,128,128,0.3)', paddingTop: 10, gap: 7 }, compactConclusion: { flex: 1, fontSize: 14, fontWeight: '800' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 }, legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 }, legendSwatch: { width: 22, height: 4, borderRadius: 999 },
  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metric: { flexGrow: 1, minWidth: '28%', gap: 3 }, metricLabel: { fontSize: 11, fontWeight: '700' }, metricValue: { fontSize: 14, fontWeight: '800' },
  dayList: { minHeight: 150 }, dayColumn: { width: 66, minHeight: 142, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'flex-end', gap: 4 }, dayBarArea: { width: '100%', height: 86, alignItems: 'center', justifyContent: 'flex-end', borderBottomWidth: 1 }, dayBar: { width: 24, borderTopLeftRadius: 7, borderTopRightRadius: 7 }, dayAmount: { fontSize: 10, fontWeight: '800' }, dayDate: { fontSize: 10, fontWeight: '700' }, futureLabel: { fontSize: 9, fontWeight: '700' },
  pulseList: { gap: 10 }, pulseTitle: { fontSize: 15, lineHeight: 21, fontWeight: '800' }, stack: { height: 15, borderRadius: 999, overflow: 'hidden', flexDirection: 'row' }, scopeButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scopeButton: { flexGrow: 1, minWidth: '46%', minHeight: 66, borderWidth: 1, borderRadius: 12, padding: 10, gap: 5 }, scopeLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 }, scopeDot: { width: 8, height: 8, borderRadius: 4 }, scopeValue: { fontSize: 13, fontWeight: '800' },
  fundingRow: { gap: 7, paddingVertical: 7 }, fundingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, fundingName: { flex: 1, fontSize: 14, fontWeight: '800' }, fundingValue: { gap: 3 }, fundingTrack: { height: 7, borderRadius: 999, overflow: 'hidden' }, fundingFill: { height: '100%', borderRadius: 999 },
});
