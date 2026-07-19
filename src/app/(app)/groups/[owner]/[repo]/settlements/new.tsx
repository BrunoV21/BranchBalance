import { useEffect, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Banner, Body, Button, Card, ConfirmDialog, Field, Screen, Title } from '@/components/ui';
import { AppFailure, messageForError } from '@/domain/errors';
import { currencies, formatMoney } from '@/domain/money';
import { buildSettlementPayment, pairKey, validateSettlementDraft, type ValidSettlementPaymentInput } from '@/domain/settlements';
import { normalizeLogin, type CalendarDate } from '@/domain/types';
import { DatePickerDialog } from '@/features/expenses/date-picker-dialog';
import { systemClock, systemLocalCalendar } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';

export default function NewSettlementPaymentScreen() {
  const params = useLocalSearchParams<{ from: string; to: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { state, recordSettlementPayment } = useGroup();
  const snapshot = state.data;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const to = Array.isArray(params.to) ? params.to[0] : params.to;
  const suggestion = snapshot?.settlements.find((item) => pairKey(item.from, item.to) === pairKey(from ?? '', to ?? ''));
  const reservation = snapshot?.reservations?.find((item) => pairKey(item.from, item.to) === pairKey(from ?? '', to ?? ''));
  const availableMinor = reservation?.availableToRecordMinor ?? suggestion?.amountMinor ?? 0;
  const initializedAmount = useRef(false);
  const [amount, setAmount] = useState(() => snapshot ? amountInput(availableMinor, snapshot.group.currency) : '');
  const [paidOn, setPaidOn] = useState<CalendarDate>(() => systemLocalCalendar.today());
  const [note, setNote] = useState('');
  const [showDate, setShowDate] = useState(false);
  const [review, setReview] = useState<ValidSettlementPaymentInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshot || availableMinor <= 0 || initializedAmount.current) return;
    initializedAmount.current = true;
    setAmount(amountInput(availableMinor, snapshot.group.currency));
  }, [availableMinor, snapshot]);

  if (!snapshot || !session.account) return <Screen><Banner>Refresh the group before recording a payment.</Banner></Screen>;
  const acceptedCurrentUser = snapshot.members.some((member) => normalizeLogin(member.login) === normalizeLogin(session.account!.login));
  const mutable = snapshot.repository.canWrite && acceptedCurrentUser && (snapshot.settlementLedger?.kind === 'missing' || snapshot.settlementLedger?.kind === 'ready');
  if (!suggestion || availableMinor <= 0) return <Screen>
    <Title eyebrow={snapshot.group.name}>Record payment</Title>
    <Banner tone="info">This settlement is no longer available, or its full amount is awaiting recipient confirmation.</Banner>
    <Button variant="secondary" onPress={() => router.back()}>Return to Balances</Button>
  </Screen>;

  const openReview = () => {
    setError(null);
    try {
      setReview(validateSettlementDraft({ from: suggestion.from, to: suggestion.to, amount, paidOn, note }, snapshot.settlements, snapshot.reservations ?? [], snapshot.group.currency, systemLocalCalendar.today()));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Review the payment details.'); }
  };
  const submit = async () => {
    if (!review || loading) return;
    setLoading(true); setError(null);
    try {
      const payment = buildSettlementPayment(review, Crypto.randomUUID(), snapshot.group.currency, session.account!.login, systemClock);
      await recordSettlementPayment(payment);
      setReview(null);
      router.back();
    } catch (cause) {
      setReview(null);
      setError(cause instanceof AppFailure ? messageForError(cause.detail) : cause instanceof Error ? cause.message : 'Unable to record this payment.');
    } finally { setLoading(false); }
  };

  return <Screen>
    <Title eyebrow={snapshot.group.name}>Record payment</Title>
    <Banner tone="info">BranchBalance records money moved elsewhere. The recipient must confirm receipt before balances change.</Banner>
    <Card>
      <Body muted>Sender</Body><Body>@{suggestion.from}</Body>
      <Body muted>Recipient</Body><Body>@{suggestion.to}</Body>
      <Body muted>Available to record</Body><Body>{formatMoney(availableMinor, snapshot.group.currency)}</Body>
    </Card>
    <Field label={`Amount (${snapshot.group.currency})`} value={amount} onChangeText={(value) => { setAmount(value); setReview(null); }} keyboardType="decimal-pad" placeholder="0.00" />
    <Body>Payment date</Body>
    <Button variant="secondary" onPress={() => setShowDate(true)}>{paidOn}</Button>
    {showDate ? <DatePickerDialog value={paidOn} onCancel={() => setShowDate(false)} onConfirm={(value) => { setPaidOn(value); setShowDate(false); setReview(null); }} /> : null}
    <Field label="Shared note (optional)" value={note} onChangeText={(value) => { setNote(value); setReview(null); }} multiline textAlignVertical="top" maxLength={2_000} style={styles.note} placeholder="Payment context, receipt reference, external transaction ID, or account identifier" />
    <Body muted>{Array.from(note).length}/2,000 characters. Every repository member can read this note and Git history may retain it. Never enter passwords, PINs, CVVs, tokens, recovery codes, or other authentication secrets.</Body>
    {error ? <Banner tone="error">{error}</Banner> : null}
    {!mutable ? <Banner>Refresh the remote settlement ledger before recording a payment.</Banner> : null}
    <Button disabled={!mutable} onPress={openReview}>Review payment</Button>
    <ConfirmDialog
      visible={review !== null}
      title="Record pending payment?"
      message={review ? `Record ${formatMoney(review.amountMinor, snapshot.group.currency)} from @${review.from} to @${review.to} on ${review.paidOn}? ${review.note ? 'The shared note will be stored in the repository and Git history.' : 'No note will be shared.'} The recipient must confirm receipt.` : ''}
      confirmLabel="Record payment"
      confirmVariant="primary"
      loading={loading}
      onCancel={() => setReview(null)}
      onConfirm={() => void submit()}
    />
  </Screen>;
}

function amountInput(amountMinor: number, currency: keyof typeof currencies): string {
  const digits = currencies[currency].minorDigits;
  const divisor = 10 ** digits;
  return `${Math.floor(amountMinor / divisor)}.${String(amountMinor % divisor).padStart(digits, '0')}`;
}

const styles = StyleSheet.create({ note: { minHeight: 112, paddingTop: 14 } });
