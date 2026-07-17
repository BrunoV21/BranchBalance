import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Field } from '@/components/ui';
import { allocateEqual, allocateFull, formatMoney, parseAmountToMinor } from '@/domain/money';
import type { CurrencyCode, Member, SplitType } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

import { DatePickerDialog } from './date-picker-dialog';
import { localCalendarDate, type ExpenseDraft } from './model';

export function ExpenseForm({ currency, members, initial, submitLabel, onSubmit }: { currency: CurrencyCode; members: Member[]; initial?: ExpenseDraft; submitLabel: string; onSubmit(draft: ExpenseDraft): Promise<void> }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<ExpenseDraft>(initial ?? { description: '', amount: '', paidBy: members[0]?.login ?? '', splitType: 'equal', participants: members.map((member) => member.login), expenseDate: localCalendarDate() });
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const shares = useMemo(() => {
    try {
      const amount = parseAmountToMinor(draft.amount, currency);
      return draft.splitType === 'equal' ? allocateEqual(amount, draft.participants) : allocateFull(amount, draft.paidBy, draft.participants[0] ?? '');
    } catch { return {}; }
  }, [currency, draft.amount, draft.paidBy, draft.participants, draft.splitType]);
  const patch = (next: Partial<ExpenseDraft>) => setDraft((value) => ({ ...value, ...next }));
  const chooseSplit = (splitType: SplitType) => patch({ splitType, participants: splitType === 'equal' ? members.map((member) => member.login) : members.filter((member) => member.login.toLowerCase() !== draft.paidBy.toLowerCase()).slice(0, 1).map((member) => member.login) });
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true); setError(null);
    try { await onSubmit(draft); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this expense.'); }
    finally { submitting.current = false; setLoading(false); }
  };
  return <View style={styles.form}>
    <Field label="Description" value={draft.description} onChangeText={(description) => patch({ description })} placeholder="What was it for?" maxLength={120} />
    <Field label={`Amount (${currency})`} value={draft.amount} onChangeText={(amount) => patch({ amount })} keyboardType="decimal-pad" placeholder="0.00" />
    <Body>Paid by</Body>
    <View style={styles.wrap}>{members.map((member) => <Choice key={member.login} label={`@${member.login}`} selected={draft.paidBy.toLowerCase() === member.login.toLowerCase()} onPress={() => {
      const participants = draft.splitType === 'full' && draft.participants[0]?.toLowerCase() === member.login.toLowerCase() ? members.filter((item) => item.login.toLowerCase() !== member.login.toLowerCase()).slice(0, 1).map((item) => item.login) : draft.participants;
      patch({ paidBy: member.login, participants });
    }} />)}</View>
    <Body>How should it be split?</Body><View style={styles.row}><Choice label="Equal" selected={draft.splitType === 'equal'} onPress={() => chooseSplit('equal')} />{members.length > 1 ? <Choice label="Full to one" selected={draft.splitType === 'full'} onPress={() => chooseSplit('full')} /> : null}</View>
    <Body>{draft.splitType === 'equal' ? 'Shared by' : 'Who owes the full amount?'}</Body>
    {members.filter((member) => draft.splitType === 'equal' || member.login.toLowerCase() !== draft.paidBy.toLowerCase()).map((member) => {
      const selected = draft.participants.some((login) => login.toLowerCase() === member.login.toLowerCase());
      return <Pressable accessibilityRole={draft.splitType === 'equal' ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} key={member.login} onPress={() => patch({ participants: draft.splitType === 'full' ? [member.login] : selected ? draft.participants.filter((login) => login.toLowerCase() !== member.login.toLowerCase()) : [...draft.participants, member.login] })}><Card style={styles.member}><View><Text style={{ color: colors.text, fontWeight: '800' }}>@{member.login}</Text><Body muted>{shares[member.login] !== undefined ? `${formatMoney(shares[member.login]!, currency)} share` : 'Not included'}</Body></View><Text style={{ color: selected ? colors.accent : colors.muted, fontWeight: '900' }}>{selected ? 'Selected' : 'Select'}</Text></Card></Pressable>;
    })}
    <Body>Date</Body><Button variant="secondary" onPress={() => setShowDate(true)}>{draft.expenseDate}</Button>
    {showDate ? <DatePickerDialog value={draft.expenseDate} onCancel={() => setShowDate(false)} onConfirm={(expenseDate) => { patch({ expenseDate }); setShowDate(false); }} /> : null}
    {error ? <Banner tone="error">{error}</Banner> : null}
    <Button loading={loading} onPress={() => void submit()}>{submitLabel}</Button>
  </View>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent : colors.surface, borderColor: colors.border, borderWidth: 1 }}><Text style={{ color: selected ? colors.accentText : colors.text, fontWeight: '800' }}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ form: { gap: 14 }, row: { flexDirection: 'row', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, member: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } });
