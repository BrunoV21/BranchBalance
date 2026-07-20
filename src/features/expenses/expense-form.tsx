import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Field } from '@/components/ui';
import { allocateEqual, allocateFull, formatMoney, parseAmountToMinor } from '@/domain/money';
import { expenseCategories, expenseCategoryLabels, paymentMethodLabels, paymentMethods } from '@/domain/spending';
import type { CurrencyCode, Member } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

import { DatePickerDialog } from './date-picker-dialog';
import { CategoryIcon, PaymentMethodIcon } from './metadata-icons';
import { applyJustMe, localCalendarDate, type ExpenseDraft, type ExpenseSplitMode } from './model';
import type { ReceiptExpensePrefill } from '@/features/receipt-scanning/receipt-types';

export function ExpenseForm({ currency, members, initial, receiptPrefill, onRetakeReceipt, submitLabel, onSubmit }: { currency: CurrencyCode; members: Member[]; initial?: ExpenseDraft; receiptPrefill?: ReceiptExpensePrefill | null; onRetakeReceipt?(): void; submitLabel: string; onSubmit(draft: ExpenseDraft): Promise<void> }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<ExpenseDraft>(initial ?? { description: '', amount: '', category: null, paymentMethod: null, paidBy: members[0]?.login ?? '', splitType: 'equal', participants: members.map((member) => member.login), expenseDate: localCalendarDate() });
  const [showDate, setShowDate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);
  const shares = useMemo(() => {
    try {
      const amount = parseAmountToMinor(draft.amount, currency);
      return draft.splitType === 'equal' || draft.splitType === 'just_me' ? allocateEqual(amount, draft.splitType === 'just_me' ? [draft.paidBy] : draft.participants) : allocateFull(amount, draft.paidBy, draft.participants[0] ?? '');
    } catch { return {}; }
  }, [currency, draft.amount, draft.paidBy, draft.participants, draft.splitType]);
  const patch = (next: Partial<ExpenseDraft>) => setDraft((value) => ({ ...value, ...next }));
  const chooseSplit = (splitType: ExpenseSplitMode) => {
    if (splitType === 'just_me') setDraft((value) => applyJustMe(value, value.paidBy));
    else patch({ splitType, participants: splitType === 'equal' ? members.map((member) => member.login) : members.filter((member) => member.login.toLowerCase() !== draft.paidBy.toLowerCase()).slice(0, 1).map((member) => member.login) });
  };
  const submit = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true); setError(null);
    try {
      if (!draft.category) throw new Error('Select an expense category.');
      if (!draft.paymentMethod) throw new Error('Select a payment method.');
      await onSubmit(draft);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this expense.'); }
    finally { submitting.current = false; setLoading(false); }
  };
  return <View style={styles.form}>
    {receiptPrefill ? <Banner tone={receiptPrefill.warnings.length ? 'warning' : 'info'} action={onRetakeReceipt ? <Button variant="ghost" onPress={onRetakeReceipt}>Retake</Button> : undefined}>Receipt read on this device. Review every field before saving.{receiptPrefill.warnings.length ? ` ${receiptPrefill.warnings.join(' ')}` : ''}</Banner> : null}
    <Field label="Description" value={draft.description} onChangeText={(description) => patch({ description })} placeholder="What was it for?" maxLength={120} />
    <Field label={`Amount (${currency})`} value={draft.amount} onChangeText={(amount) => patch({ amount })} keyboardType="decimal-pad" placeholder="0.00" />
    <Body>Category</Body>
    <View accessibilityRole="radiogroup" style={styles.choiceGrid}>{expenseCategories.map((category) => <MetadataChoice key={category} label={expenseCategoryLabels[category]} selected={draft.category === category} onPress={() => patch({ category })} icon={<CategoryIcon category={category} />} />)}</View>
    <Body>Payment method</Body>
    <View accessibilityRole="radiogroup" style={styles.choiceGrid}>{paymentMethods.map((method) => <MetadataChoice key={method} label={paymentMethodLabels[method]} selected={draft.paymentMethod === method} onPress={() => patch({ paymentMethod: method })} icon={<PaymentMethodIcon method={method} />} />)}</View>
    <Body muted>Only the method is recorded—never card, bank, account, or wallet details.</Body>
    <Body>Paid by</Body>
    <View style={styles.wrap}>{members.map((member) => <Choice key={member.login} label={`@${member.login}`} selected={draft.paidBy.toLowerCase() === member.login.toLowerCase()} onPress={() => {
      if (draft.splitType === 'just_me') setDraft((value) => applyJustMe(value, member.login));
      else {
        const participants = draft.splitType === 'full' && draft.participants[0]?.toLowerCase() === member.login.toLowerCase() ? members.filter((item) => item.login.toLowerCase() !== member.login.toLowerCase()).slice(0, 1).map((item) => item.login) : draft.participants;
        patch({ paidBy: member.login, participants });
      }
    }} />)}</View>
    <Body>How should it be split?</Body><View style={styles.row}><Choice label="Equal" selected={draft.splitType === 'equal'} onPress={() => chooseSplit('equal')} />{members.length > 1 ? <Choice label="Full to one" selected={draft.splitType === 'full'} onPress={() => chooseSplit('full')} /> : null}<Choice label="Just me" selected={draft.splitType === 'just_me'} onPress={() => chooseSplit('just_me')} /></View>
    {draft.splitType === 'just_me' ? <Banner tone="info">Only @{draft.paidBy} has a share. This expense remains visible to the group and counts toward group spending, but nobody owes the payer.</Banner> : <>
    <Body>{draft.splitType === 'equal' ? 'Shared by' : 'Who owes the full amount?'}</Body>
    {members.filter((member) => draft.splitType === 'equal' || member.login.toLowerCase() !== draft.paidBy.toLowerCase()).map((member) => {
      const selected = draft.participants.some((login) => login.toLowerCase() === member.login.toLowerCase());
      return <Pressable accessibilityRole={draft.splitType === 'equal' ? 'checkbox' : 'radio'} accessibilityState={{ checked: selected }} key={member.login} onPress={() => patch({ participants: draft.splitType === 'full' ? [member.login] : selected ? draft.participants.filter((login) => login.toLowerCase() !== member.login.toLowerCase()) : [...draft.participants, member.login] })}><Card style={styles.member}><View><Text style={{ color: colors.text, fontWeight: '800' }}>@{member.login}</Text><Body muted>{shares[member.login] !== undefined ? `${formatMoney(shares[member.login]!, currency)} share` : 'Not included'}</Body></View><Text style={{ color: selected ? colors.accent : colors.muted, fontWeight: '900' }}>{selected ? 'Selected' : 'Select'}</Text></Card></Pressable>;
    })}</>}
    <Body>Date</Body><Button variant="secondary" onPress={() => setShowDate(true)}>{draft.expenseDate}</Button>
    {showDate ? <DatePickerDialog value={draft.expenseDate} onCancel={() => setShowDate(false)} onConfirm={(expenseDate) => { patch({ expenseDate }); setShowDate(false); }} /> : null}
    {error ? <Banner tone="error">{error}</Banner> : null}
    <Button loading={loading} onPress={() => void submit()}>{submitLabel}</Button>
  </View>;
}

function MetadataChoice({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress(): void; icon: ReactNode }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ selected }} onPress={onPress} style={[styles.metadataChoice, { backgroundColor: selected ? colors.surfaceStrong : colors.surface, borderColor: selected ? colors.accent : colors.border }]}><View>{icon}</View><Text style={{ color: colors.text, fontWeight: '700', fontSize: 13 }}>{label}</Text></Pressable>;
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress(): void }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={{ minHeight: 46, paddingHorizontal: 14, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent : colors.surface, borderColor: colors.border, borderWidth: 1 }}><Text style={{ color: selected ? colors.accentText : colors.text, fontWeight: '800' }}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({ form: { gap: 14 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metadataChoice: { minHeight: 68, width: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 7, alignItems: 'center', justifyContent: 'center' }, member: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' } });
