import { type ReactNode, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ArrowRight, CircleCheck, Clock3, HandCoins, History, ReceiptText, Scale, Send, Trash2, UserRound, UsersRound, WalletCards } from 'lucide-react-native';

import { Banner, Body, Button, Card, ConfirmDialog, EmptyState, Screen, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { deriveExpenseFundingAnalytics } from '@/domain/spending';
import { normalizeLogin, type SettlementPayment } from '@/domain/types';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { ExpenseFundingCard } from '@/features/spending/analytics-components';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function BalancesScreen() {
  useGroupRefresh();
  const router = useRouter();
  const { session } = useSession();
  const { state, confirmSettlementPayment, deleteSettlementPayment } = useGroup();
  const { colors } = useTheme();
  const [confirmation, setConfirmation] = useState<{ kind: 'confirm' | 'delete'; payment: SettlementPayment } | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const snapshot = state.data;

  const performAction = async () => {
    if (!confirmation || loading) return;
    setLoading(true); setActionError(null);
    try {
      if (confirmation.kind === 'confirm') {
        await confirmSettlementPayment(confirmation.payment.id);
        setAnnouncement('Payment confirmed as received. Balances and settlement suggestions were updated.');
      } else {
        await deleteSettlementPayment(confirmation.payment.id);
        setAnnouncement('Payment deleted. Settlement balances and reservations were updated.');
      }
      setConfirmation(null);
    } catch (error) { setActionError(error instanceof Error ? error.message : 'Unable to update this payment.'); }
    finally { setLoading(false); }
  };

  if (!snapshot) return <Screen><Title eyebrow="BranchBalance">Balances</Title><EmptyState title="Loading balances…" body="Balances will appear after the group refreshes." /></Screen>;
  const ledger = snapshot.settlementLedger ?? { kind: 'unverified' as const };
  const payments = snapshot.payments ?? [];
  const pending = payments.filter((payment) => payment.status === 'pending');
  const verified = ledger.kind === 'missing' || ledger.kind === 'ready';
  const currentLogin = session.account?.login ?? '';
  const fundingAnalytics = deriveExpenseFundingAnalytics(snapshot.balances.members, currentLogin);
  const acceptedCurrentUser = snapshot.members.some((member) => normalizeLogin(member.login) === normalizeLogin(currentLogin));
  const mutable = snapshot.repository.canWrite && acceptedCurrentUser && verified;
  const allSuggestionsReserved = snapshot.settlements.length > 0 && snapshot.settlements.every((settlement) => {
    const reservation = snapshot.reservations?.find((item) => normalizeLogin(item.from) === normalizeLogin(settlement.from) && normalizeLogin(item.to) === normalizeLogin(settlement.to));
    return reservation?.availableToRecordMinor === 0;
  });

  return <Screen>
    <Title eyebrow={snapshot.group.name}>Balances</Title>
    {state.error ? <Banner tone="warning">{state.error}</Banner> : null}
    {snapshot.warnings.filter((warning) => warning.path.startsWith('settlements.json')).map((warning) => <Banner key={`${warning.path}:${warning.reason}`}>Skipped {warning.path}: {warning.reason}</Banner>)}
    {actionError ? <Banner tone="error">{actionError}</Banner> : null}
    {announcement ? <Banner tone="info">{announcement}</Banner> : null}
    {!snapshot.balances.zeroSum ? <Banner tone="error">Balances do not sum to zero, so settlements are hidden.</Banner> : null}
    {ledger.kind === 'unverified' ? <Banner>Cached payment totals are provisional. Refresh GitHub before viewing notes or changing payments.</Banner> : null}
    {ledger.kind === 'invalid' ? <Banner tone="error">The settlement ledger is invalid. Payment-adjusted suggestions and payment actions are disabled until it is repaired on GitHub.</Banner> : null}

    <SectionHeading icon={<WalletCards color={colors.accent} size={20} />}>Expense funding</SectionHeading>
    <ExpenseFundingCard analytics={fundingAnalytics} currency={snapshot.group.currency} currentLogin={currentLogin} />

    <SectionHeading icon={<UsersRound color={colors.accent} size={20} />}>{ledger.kind === 'invalid' ? 'Expense-only totals (payment adjustment unavailable)' : 'Member totals'}</SectionHeading>
    {snapshot.balances.members.map((member) => <Card key={member.login}>
      <View style={styles.memberHeader}>
        <View style={styles.identity}><UserRound color={colors.accent} size={21} /><Text style={[styles.name, { color: colors.text }]}>@{member.login}</Text></View>
        <Text style={[styles.net, { color: member.netMinor >= 0 ? colors.positive : colors.negative }]}>{member.netMinor >= 0 ? 'is owed ' : 'owes '}{formatMoney(Math.abs(member.netMinor), snapshot.group.currency)}</Text>
      </View>
      <Detail icon={<ReceiptText color={colors.muted} size={18} />}>Expenses paid {formatMoney(member.totalPaidMinor, snapshot.group.currency)} · share {formatMoney(member.totalShareMinor, snapshot.group.currency)}</Detail>
      <Detail icon={<CircleCheck color={colors.muted} size={18} />}>Confirmed payments sent {formatMoney(member.settlementSentMinor, snapshot.group.currency)} · received {formatMoney(member.settlementReceivedMinor, snapshot.group.currency)}</Detail>
    </Card>)}

    <SectionHeading icon={<Scale color={colors.accent} size={20} />}>Suggested settlements</SectionHeading>
    {allSuggestionsReserved ? <Banner tone="info">Awaiting confirmation: every currently suggested amount is reserved by a pending payment.</Banner> : null}
    {snapshot.settlements.length ? snapshot.settlements.map((settlement) => {
      const reservation = snapshot.reservations?.find((item) => normalizeLogin(item.from) === normalizeLogin(settlement.from) && normalizeLogin(item.to) === normalizeLogin(settlement.to));
      const pendingMinor = reservation?.pendingMinor ?? 0;
      const availableMinor = reservation?.availableToRecordMinor ?? settlement.amountMinor;
      return <Card key={`${normalizeLogin(settlement.from)}:${normalizeLogin(settlement.to)}`}>
        <PaymentRoute from={settlement.from} to={settlement.to} />
        <Detail icon={<HandCoins color={colors.muted} size={18} />}>Total still owed {formatMoney(settlement.amountMinor, snapshot.group.currency)}</Detail>
        <Detail icon={<Clock3 color={colors.muted} size={18} />}>Awaiting confirmation {formatMoney(pendingMinor, snapshot.group.currency)}</Detail>
        <Detail icon={<WalletCards color={colors.muted} size={18} />}>Available to record {formatMoney(availableMinor, snapshot.group.currency)}</Detail>
        {mutable && availableMinor > 0 ? <Button icon={<Send color={colors.accentText} size={18} />} onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/settlements/new', params: { owner: snapshot.repository.owner, repo: snapshot.repository.name, from: settlement.from, to: settlement.to } } as never)}>Record payment</Button> : null}
      </Card>;
    }) : ledger.kind === 'invalid' ? <EmptyState title="Settlement data unavailable" body="Repair settlements.json on GitHub, then refresh to derive payment-adjusted suggestions." /> : pending.length ? <EmptyState title="Awaiting confirmation" body="There is no unreserved transfer to record while pending payments await their recipients." /> : <EmptyState icon={<View accessibilityLabel="Everything is settled" accessibilityRole="image"><CircleCheck color={colors.positive} size={52} strokeWidth={1.8} /></View>} title="All settled" body="There are no suggested transfers for the adjusted balances." />}

    <SectionHeading icon={<Clock3 color={colors.accent} size={20} />}>Awaiting confirmation</SectionHeading>
    {pending.length ? pending.map((payment) => {
      const canConfirm = mutable && acceptedCurrentUser && normalizeLogin(payment.to) === normalizeLogin(currentLogin);
      return <Card key={`pending:${payment.id}`}>
        <PaymentRoute from={payment.from} to={payment.to} />
        <Detail icon={<HandCoins color={colors.muted} size={18} />}>Reported payment {formatMoney(payment.amount_minor, snapshot.group.currency)}</Detail>
        <Detail icon={<Clock3 color={colors.muted} size={18} />}>Paid on {payment.paid_on} · awaiting @{payment.to}</Detail>
        {canConfirm ? <Button icon={<CircleCheck color={colors.accentText} size={18} />} onPress={() => setConfirmation({ kind: 'confirm', payment })}>Confirm received</Button> : null}
      </Card>;
    }) : <Body muted>{ledger.kind === 'invalid' ? 'Pending payment status is unavailable until the ledger is repaired.' : 'No payments are awaiting confirmation.'}</Body>}

    <SectionHeading icon={<History color={colors.accent} size={20} />}>Payment history</SectionHeading>
    {payments.length ? payments.map((payment) => <Card key={payment.id}>
      <View style={styles.statusRow}><View style={styles.statusLabel}>{payment.status === 'confirmed' ? <CircleCheck color={colors.positive} size={18} /> : <Clock3 color={colors.warning} size={18} />}<Text style={[styles.status, { color: payment.status === 'confirmed' ? colors.positive : colors.warning }]}>{payment.status === 'confirmed' ? 'Confirmed' : 'Pending'}</Text></View><Body>{formatMoney(payment.amount_minor, snapshot.group.currency)}</Body></View>
      <PaymentRoute from={payment.from} to={payment.to} />
      <Detail icon={<Clock3 color={colors.muted} size={18} />}>Paid on {payment.paid_on}</Detail>
      {verified && payment.note ? <View style={styles.note}><Body muted>Shared repository note</Body><Text selectable style={[styles.noteText, { color: colors.text }]}>{payment.note}</Text></View> : null}
      <Body muted>Recorded by @{payment.recorded_by} at {payment.recorded_at}</Body>
      {payment.status === 'confirmed' ? <Body muted>Confirmed by @{payment.confirmed_by} at {payment.confirmed_at}</Body> : null}
      {mutable ? <Button icon={<Trash2 color={colors.accentText} size={18} />} variant="danger" onPress={() => setConfirmation({ kind: 'delete', payment })}>Delete payment</Button> : null}
    </Card>) : ledger.kind === 'invalid' ? <EmptyState title="Payment history unavailable" body="The remote ledger must be repaired before BranchBalance can show valid payment history." /> : <EmptyState title="No payments recorded" body="Current suggestions remain available until someone records a payment made elsewhere." />}

    <ConfirmDialog
      visible={confirmation !== null}
      title={confirmation?.kind === 'confirm' ? 'Confirm payment received?' : 'Delete payment?'}
      message={confirmation ? confirmation.kind === 'confirm'
        ? `Confirm that you received ${formatMoney(confirmation.payment.amount_minor, snapshot.group.currency)} from @${confirmation.payment.from} on ${confirmation.payment.paid_on}.${confirmation.payment.note ? ` Shared note: ${confirmation.payment.note}` : ''}`
        : `Delete this ${confirmation.payment.status} payment of ${formatMoney(confirmation.payment.amount_minor, snapshot.group.currency)} from @${confirmation.payment.from} to @${confirmation.payment.to} on ${confirmation.payment.paid_on}? Git history may retain it.` : ''}
      confirmLabel={confirmation?.kind === 'confirm' ? 'Confirm received' : 'Delete payment'}
      confirmVariant={confirmation?.kind === 'confirm' ? 'primary' : 'danger'}
      loading={loading}
      onCancel={() => { if (!loading) setConfirmation(null); }}
      onConfirm={() => void performAction()}
    />
  </Screen>;
}

function SectionHeading({ children, icon }: { children: string; icon: ReactNode }) {
  const { colors } = useTheme();
  return <View style={styles.sectionHeading}>{icon}<Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>{children}</Text></View>;
}

function PaymentRoute({ from, to }: { from: string; to: string }) {
  const { colors } = useTheme();
  return <View accessibilityLabel={`@${from} pays @${to}`} style={styles.route}>
    <View style={styles.party}><UserRound color={colors.accent} size={18} /><Text numberOfLines={1} style={[styles.partyName, { color: colors.text }]}>@{from}</Text></View>
    <ArrowRight color={colors.muted} size={18} />
    <View style={styles.party}><UserRound color={colors.accent} size={18} /><Text numberOfLines={1} style={[styles.partyName, { color: colors.text }]}>@{to}</Text></View>
  </View>;
}

function Detail({ children, icon }: { children: ReactNode; icon: ReactNode }) {
  return <View style={styles.detail}>{icon}<Body muted style={styles.detailText}>{children}</Body></View>;
}

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 4 },
  sectionTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '800' },
  memberHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  identity: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '800' },
  net: { flexShrink: 1, fontWeight: '800', textAlign: 'right' },
  detail: { flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  detailText: { flex: 1 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  party: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  partyName: { flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  status: { fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  note: { gap: 5 },
  noteText: { fontSize: 15, lineHeight: 22 },
});
