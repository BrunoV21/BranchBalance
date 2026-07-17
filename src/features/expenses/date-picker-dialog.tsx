import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button } from '@/components/ui';
import type { CalendarDate } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

const weekDays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parts(value: CalendarDate) {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month! - 1, day: day! };
}

function calendarDate(year: number, month: number, day: number): CalendarDate {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function DatePickerDialog({ value, onCancel, onConfirm }: { value: CalendarDate; onCancel(): void; onConfirm(value: CalendarDate): void }) {
  const { colors } = useTheme();
  const initial = parts(value);
  const [visibleMonth, setVisibleMonth] = useState({ year: initial.year, month: initial.month });
  const [selected, setSelected] = useState(value);
  const cells = useMemo(() => {
    const leading = new Date(visibleMonth.year, visibleMonth.month, 1).getDay();
    const count = new Date(visibleMonth.year, visibleMonth.month + 1, 0).getDate();
    return [...Array.from({ length: leading }, () => null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [visibleMonth]);
  const monthLabel = new Date(visibleMonth.year, visibleMonth.month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const moveMonth = (offset: number) => setVisibleMonth((current) => {
    const next = new Date(current.year, current.month + offset, 1);
    return { year: next.getFullYear(), month: next.getMonth() };
  });

  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
    <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
      <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.monthHeader}>
          <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => moveMonth(-1)} style={styles.monthButton}><Text style={[styles.monthArrow, { color: colors.text }]}>‹</Text></Pressable>
          <Text style={[styles.monthTitle, { color: colors.text }]}>{monthLabel}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => moveMonth(1)} style={styles.monthButton}><Text style={[styles.monthArrow, { color: colors.text }]}>›</Text></Pressable>
        </View>
        <View style={styles.grid}>{weekDays.map((label, index) => <View key={`${label}:${index}`} style={styles.cell}><Text style={[styles.weekDay, { color: colors.muted }]}>{label}</Text></View>)}</View>
        <View style={styles.grid}>{cells.map((day, index) => {
          const date = day === null ? null : calendarDate(visibleMonth.year, visibleMonth.month, day);
          const active = date === selected;
          return <View key={`${visibleMonth.year}:${visibleMonth.month}:${index}`} style={styles.cell}>{day === null ? null : <Pressable accessibilityRole="button" accessibilityLabel={new Date(visibleMonth.year, visibleMonth.month, day).toLocaleDateString()} accessibilityState={{ selected: active }} onPress={() => setSelected(date!)} style={[styles.day, active ? { backgroundColor: colors.accent } : null]}><Text style={{ color: active ? colors.accentText : colors.text, fontWeight: active ? '800' : '600' }}>{day}</Text></Pressable>}</View>;
        })}</View>
        <Body muted>Selected date: {selected}</Body>
        <View style={styles.actions}><View style={styles.action}><Button variant="secondary" onPress={onCancel}>Cancel</Button></View><View style={styles.action}><Button onPress={() => onConfirm(selected)}>Use date</Button></View></View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18 }, dialog: { width: '100%', maxWidth: 460, borderRadius: 18, borderWidth: 1, padding: 18, gap: 12, elevation: 12 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, monthButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }, monthArrow: { fontSize: 38, lineHeight: 42, fontWeight: '500' }, monthTitle: { fontSize: 19, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' }, cell: { width: '14.2857%', minHeight: 44, alignItems: 'center', justifyContent: 'center' }, weekDay: { fontSize: 13, fontWeight: '800' }, day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 }, action: { flex: 1 },
});
