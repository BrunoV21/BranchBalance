import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, Field } from '@/components/ui';
import { allocateEqual, allocateFull, formatMoney, parseAmountToMinor } from '@/domain/money';
import { expenseCategories, expenseCategoryLabels, paymentMethodLabels, paymentMethods } from '@/domain/spending';
import type { CurrencyCode, FuelType, KnownGroupType, Member } from '@/domain/types';
import { useTheme } from '@/providers/theme-provider';

import { DatePickerDialog } from './date-picker-dialog';
import { CategoryIcon, PaymentMethodIcon } from './metadata-icons';
import { applyJustMe, buildFuelTypeData, localCalendarDate, type ExpenseDraft, type ExpenseLineItemDraft, type ExpenseSplitMode, type FuelExpenseDraft } from './model';
import type { ReceiptExpensePrefill } from '@/features/receipt-scanning/receipt-types';

export function ExpenseForm({ currency, members, groupType = 'trip', initial, receiptPrefill, onRetakeReceipt, submitLabel, onSubmit }: { currency: CurrencyCode; members: Member[]; groupType?: KnownGroupType; initial?: ExpenseDraft; receiptPrefill?: ReceiptExpensePrefill | null; onRetakeReceipt?(): void; submitLabel: string; onSubmit(draft: ExpenseDraft): Promise<void> }) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<ExpenseDraft>(initial ?? { description: '', amount: '', category: groupType === 'fuel' ? 'transport' : null, paymentMethod: null, paidBy: members[0]?.login ?? '', splitType: 'equal', participants: members.map((member) => member.login), expenseDate: localCalendarDate(), fuelDetails: groupType === 'fuel' ? null : undefined });
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
      if (groupType === 'trip' && !draft.category) throw new Error('Select an expense category.');
      if (!draft.paymentMethod) throw new Error('Select a payment method.');
      await onSubmit(draft);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this expense.'); }
    finally { submitting.current = false; setLoading(false); }
  };
  return <View style={styles.form}>
    {receiptPrefill ? <Banner tone={receiptPrefill.warnings.length ? 'warning' : 'info'} action={onRetakeReceipt ? <Button variant="ghost" onPress={onRetakeReceipt}>Retake</Button> : undefined}>Receipt read on this device. Review every field before saving.{receiptPrefill.warnings.length ? ` ${receiptPrefill.warnings.join(' ')}` : ''}</Banner> : null}
    {receiptPrefill ? <ExtractedPreview currency={currency} draft={draft} receipt={receiptPrefill} onPatch={patch} onOpenDate={() => setShowDate(true)} /> : <>
      <Field label={groupType === 'fuel' ? 'Station or merchant' : 'Description'} value={draft.description} onChangeText={(description) => patch({ description })} placeholder={groupType === 'fuel' ? 'Where did you fill up?' : 'What was it for?'} maxLength={120} />
      <Field label={`${groupType === 'fuel' ? 'Amount paid' : 'Amount'} (${currency})`} value={draft.amount} onChangeText={(amount) => patch({ amount })} keyboardType="decimal-pad" placeholder="0.00" />
      <Body>Date</Body><Button variant="secondary" onPress={() => setShowDate(true)}>{draft.expenseDate}</Button>
      {groupType === 'fuel' ? <FuelDetailsPanel currency={currency} amount={draft.amount} value={draft.fuelDetails ?? emptyFuelDraft} onChange={(fuelDetails) => patch({ fuelDetails })} /> : null}
    </>}
    {groupType === 'trip' ? <><Body>Category</Body><View accessibilityRole="radiogroup" style={styles.choiceGrid}>{expenseCategories.map((category) => <MetadataChoice key={category} label={expenseCategoryLabels[category]} selected={draft.category === category} onPress={() => patch({ category })} icon={<CategoryIcon category={category} />} />)}</View></> : <Card><Body>Category</Body><View style={styles.fixedCategory}><CategoryIcon category="transport" /><Body>Transport</Body></View><Body muted>Fuel expenses always use Transport so Fuel analytics can replace category mix.</Body></Card>}
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
    {showDate ? <DatePickerDialog value={draft.expenseDate} onCancel={() => setShowDate(false)} onConfirm={(expenseDate) => { patch({ expenseDate }); setShowDate(false); }} /> : null}
    {error ? <Banner tone="error">{error}</Banner> : null}
    <Button loading={loading} onPress={() => void submit()}>{submitLabel}</Button>
  </View>;
}

const emptyFuelDraft: FuelExpenseDraft = { litres: '', unitPrice: '', gross: '', discount: '', fuelType: null };
const fuelTypes: FuelType[] = ['petrol', 'diesel', 'lpg', 'other'];

function ExtractedPreview({ currency, draft, receipt, onPatch, onOpenDate }: { currency: CurrencyCode; draft: ExpenseDraft; receipt: ReceiptExpensePrefill; onPatch(next: Partial<ExpenseDraft>): void; onOpenDate(): void }) {
  const { colors } = useTheme();
  const lineItems = draft.lineItems ?? [];
  return <Card>
    <Text accessibilityRole="header" style={[styles.extractedHeading, { color: colors.text }]}>{receipt.profile === 'fuel_v1' ? 'Extracted Fuel data' : 'Extracted expense data'}</Text>
    <Body muted>Detected locally · editable before anything is shared.</Body>
    <Field label={receipt.profile === 'fuel_v1' ? 'Station or merchant · Detected' : 'Description · Detected'} value={draft.description} onChangeText={(description) => onPatch({ description })} maxLength={120} />
    <Field label={`${receipt.profile === 'fuel_v1' ? 'Amount paid' : 'Amount'} (${currency}) · Detected`} value={draft.amount} onChangeText={(amount) => onPatch({ amount })} keyboardType="decimal-pad" />
    <Body>Date · Detected</Body><Button variant="secondary" onPress={onOpenDate}>{draft.expenseDate}</Button>
    {receipt.profile === 'generic_v1' && lineItems.length ? <LineItemsPanel currency={currency} amount={draft.amount} rows={lineItems} onChange={(rows) => onPatch({ lineItems: rows.length ? rows : null })} /> : null}
    {receipt.profile === 'fuel_v1' ? <FuelDetailsPanel currency={currency} amount={draft.amount} value={draft.fuelDetails ?? emptyFuelDraft} onChange={(fuelDetails) => onPatch({ fuelDetails })} detected /> : null}
  </Card>;
}

function LineItemsPanel({ currency, amount, rows, onChange }: { currency: CurrencyCode; amount: string; rows: ExpenseLineItemDraft[]; onChange(rows: ExpenseLineItemDraft[]): void }) {
  const { colors } = useTheme();
  let sum: number | null = 0;
  for (const row of rows) {
    try { sum += parseAmountToMinor(row.lineTotal, currency); } catch { sum = null; break; }
  }
  let amountMinor: number | null = null;
  try { amountMinor = parseAmountToMinor(amount, currency); } catch { /* editable incomplete value */ }
  return <View style={styles.subsection}>
    <Text accessibilityRole="header" style={[styles.sectionHeading, { color: colors.text }]}>Detected line items</Text>
    {rows.map((row, index) => <View key={index} style={styles.itemRow}>
      <Field label={`Item ${index + 1} description`} value={row.description} onChangeText={(description) => onChange(rows.map((item, rowIndex) => rowIndex === index ? { ...item, description } : item))} maxLength={120} />
      <View style={styles.rowFields}><View style={styles.grow}><Field label="Quantity" value={row.quantity} onChangeText={(quantity) => onChange(rows.map((item, rowIndex) => rowIndex === index ? { ...item, quantity } : item))} keyboardType="decimal-pad" /></View><View style={styles.grow}><Field label={`Unit price (${currency})`} value={row.unitPrice} onChangeText={(unitPrice) => onChange(rows.map((item, rowIndex) => rowIndex === index ? { ...item, unitPrice } : item))} keyboardType="decimal-pad" /></View></View>
      <Field label={`Line total (${currency})`} value={row.lineTotal} onChangeText={(lineTotal) => onChange(rows.map((item, rowIndex) => rowIndex === index ? { ...item, lineTotal } : item))} keyboardType="decimal-pad" />
      <Button variant="ghost" onPress={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}>Remove item {index + 1}</Button>
    </View>)}
    <Body>{sum === null ? 'Item sum needs review' : `Item sum: ${formatMoney(sum, currency)}${amountMinor === null ? '' : sum === amountMinor ? ' · matches Amount' : ` · differs from Amount by ${formatMoney(Math.abs(sum - amountMinor), currency)}`}`}</Body>
    <Body muted>A mismatch can be legitimate. Items never rewrite Amount or change shares and balances.</Body>
  </View>;
}

function FuelDetailsPanel({ currency, amount, value, onChange, detected = false }: { currency: CurrencyCode; amount: string; value: FuelExpenseDraft; onChange(value: FuelExpenseDraft): void; detected?: boolean }) {
  const { colors } = useTheme();
  const patch = (next: Partial<FuelExpenseDraft>) => onChange({ ...value, ...next });
  let arithmetic: string | null = null;
  const hasDetails = [value.litres, value.unitPrice, value.gross, value.discount].some((item) => item.trim()) || value.fuelType;
  if (hasDetails) {
    try { const amountMinor = parseAmountToMinor(amount, currency); buildFuelTypeData(value, currency, amountMinor); arithmetic = 'Fuel values are arithmetically consistent.'; }
    catch (cause) { arithmetic = cause instanceof Error ? cause.message : 'Review Fuel arithmetic.'; }
  }
  const suffix = detected ? ' · Detected' : '';
  return <View style={styles.subsection}>
    <Text accessibilityRole="header" style={[styles.sectionHeading, { color: colors.text }]}>Fuel details (optional)</Text>
    {!detected ? <Body muted>You may save amount-only; litre, unit-price, savings, and coverage insights will be incomplete.</Body> : null}
    <Field label={`Litres${suffix}`} value={value.litres} onChangeText={(litres) => patch({ litres })} keyboardType="decimal-pad" placeholder="24.500" />
    <Field label={`Printed price per litre (${currency})${suffix}`} value={value.unitPrice} onChangeText={(unitPrice) => patch({ unitPrice })} keyboardType="decimal-pad" placeholder="1.633" />
    <Field label={`Pre-discount total (${currency})${suffix}`} value={value.gross} onChangeText={(gross) => patch({ gross })} keyboardType="decimal-pad" placeholder="40.01" />
    <Field label={`Discount (${currency})${suffix}`} value={value.discount} onChangeText={(discount) => patch({ discount })} keyboardType="decimal-pad" placeholder="4.00" />
    <Body>Fuel type (optional)</Body><View accessibilityRole="radiogroup" style={styles.row}>{fuelTypes.map((fuelType) => <Choice key={fuelType} label={fuelType === 'lpg' ? 'LPG' : `${fuelType[0]!.toUpperCase()}${fuelType.slice(1)}`} selected={value.fuelType === fuelType} onPress={() => patch({ fuelType: value.fuelType === fuelType ? null : fuelType })} />)}</View>
    {arithmetic ? <Banner tone={arithmetic.endsWith('consistent.') ? 'info' : 'warning'}>{arithmetic}</Banner> : null}
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
const styles = StyleSheet.create({ form: { gap: 14 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, metadataChoice: { minHeight: 68, width: '47%', flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 7, alignItems: 'center', justifyContent: 'center' }, member: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, extractedHeading: { fontSize: 19, fontWeight: '800' }, sectionHeading: { fontSize: 17, fontWeight: '800' }, subsection: { gap: 11 }, itemRow: { gap: 9, paddingVertical: 8 }, rowFields: { flexDirection: 'row', gap: 8 }, grow: { flex: 1 }, fixedCategory: { flexDirection: 'row', alignItems: 'center', gap: 9 } });
