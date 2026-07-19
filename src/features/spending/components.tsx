import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Card } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { formatPercentage } from '@/domain/spending';
import type { CurrencyCode, SpendingSummary } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

export function ProgressBar({ percentage, label, tone = 'accent' }: { percentage: number; label: string; tone?: 'accent' | 'negative' }) {
  const { colors } = useTheme();
  const width = `${Math.max(0, Math.min(percentage, 100))}%` as `${number}%`;
  return <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.max(0, Math.min(Math.round(percentage), 100)), text: label }} style={[styles.track, { backgroundColor: colors.border }]}><View style={[styles.fill, { width, backgroundColor: tone === 'negative' ? colors.negative : colors.accent }]} /></View>;
}

export function BudgetSummaryCard({ summary, currency, compact = false }: { summary: SpendingSummary; currency: CurrencyCode; compact?: boolean }) {
  const { colors } = useTheme();
  const budget = summary.budget;
  if (!budget) return null;
  const statusLabel = budget.status === 'under' ? 'Under budget' : budget.status === 'at' ? 'Exactly at budget' : 'Over budget';
  const remainingLabel = budget.status === 'over'
    ? `${formatMoney(Math.abs(budget.remainingMinor), currency)} over budget`
    : budget.status === 'at' ? 'No budget remaining' : `${formatMoney(budget.remainingMinor, currency)} remaining`;
  const trip = summary.trip;
  const dailyLabel = trip?.dailyAvailableMinor === null || trip?.dailyAvailableMinor === undefined ? null
    : trip.phase === 'before' ? `${formatMoney(trip.dailyAvailableMinor, currency)} planned per day`
      : `${formatMoney(trip.dailyAvailableMinor, currency)} available per remaining day`;
  return <Card style={compact ? styles.compactCard : undefined}>
    <View style={styles.between}><View style={{ flex: 1 }}><Body muted>{compact ? 'Group budget' : 'Spending plan'}</Body><Text style={[styles.budgetAmount, { color: colors.text }]}>{formatMoney(summary.totalSpentMinor, currency)} <Text style={styles.budgetOf}>of {formatMoney(budget.budgetMinor, currency)}</Text></Text></View><Text style={{ color: budget.status === 'over' ? colors.negative : colors.positive, fontWeight: '800' }}>{statusLabel}</Text></View>
    <ProgressBar percentage={budget.percentageUsed} label={`${formatPercentage(budget.percentageUsed)} of the total budget used. ${remainingLabel}.`} tone={budget.status === 'over' ? 'negative' : 'accent'} />
    <View style={styles.between}><Body muted>{formatPercentage(budget.percentageUsed)} used</Body><Body style={{ color: budget.status === 'over' ? colors.negative : colors.text }}>{remainingLabel}</Body></View>
    {trip ? <Body muted>{trip.phase === 'during' ? `Day ${trip.currentDay} of ${trip.totalDays}` : trip.phase === 'before' ? `${trip.totalDays}-day period has not started` : `${trip.totalDays}-day period completed`}</Body> : null}
    {dailyLabel ? <Body>{dailyLabel}</Body> : null}
  </Card>;
}

export function FilterChip({ selected, onPress, children, accessibilityLabel, icon }: PropsWithChildren<{ selected: boolean; onPress(): void; accessibilityLabel?: string; icon?: ReactNode }>) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="radio" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, { borderColor: selected ? colors.accent : colors.border, backgroundColor: selected ? colors.surfaceStrong : colors.surface }]}>{icon}<Text style={{ color: selected ? colors.accent : colors.text, fontWeight: '700', fontSize: 13 }}>{children}</Text></Pressable>;
}

export function MetadataItem({ icon, label, accessibilityLabel }: { icon: ReactNode; label: string; accessibilityLabel?: string }) {
  const { colors } = useTheme();
  return <View accessible accessibilityLabel={accessibilityLabel ?? label} style={styles.metadataItem}>{icon}<Text style={[styles.metadataText, { color: colors.muted }]}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  track: { height: 9, borderRadius: 999, overflow: 'hidden' }, fill: { height: '100%', borderRadius: 999 },
  compactCard: { gap: 9 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  budgetAmount: { fontSize: 24, fontWeight: '800', marginTop: 4 }, budgetOf: { fontSize: 13, fontWeight: '600' },
  chip: { minHeight: 42, borderRadius: 999, borderWidth: 1, paddingHorizontal: 13, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  metadataItem: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' }, metadataText: { fontSize: 14, lineHeight: 20, flexShrink: 1 },
});
