import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, ConfirmDialog, Field, Screen, Title } from '@/components/ui';
import { AppFailure, DomainValidationError } from '@/domain/errors';
import { applicableFuelLimit, monthKeyForDate, nextMonth } from '@/domain/analytics';
import { isFuelMonthlyPlan } from '@/domain/groups';
import { formatMoney } from '@/domain/money';
import type { FuelMonthlyPlanV2, GroupFile, RemoteGroupSnapshot, SpendingPlan } from '@/domain/types';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { systemClock, systemLocalCalendar } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

import { buildFuelMonthlyPlan, fuelLimitDraftsFrom, type FuelLimitDraft } from './fuel-plan-model';

type PlanConflict = { latest: GroupFile; submitted: SpendingPlan | null };

export function FuelMonthlyPlanEditor({ snapshot, accountLogin }: { snapshot: RemoteGroupSnapshot; accountLogin: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { updateSpendingPlan, removeSpendingPlan, acceptSpendingPlanFile } = useGroup();
  const [drafts, setDrafts] = useState<FuelLimitDraft[]>(() => fuelLimitDraftsFrom(snapshot.group.spending_plan, snapshot.group.currency));
  const [base] = useState(() => snapshot.groupFile);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [conflict, setConflict] = useState<PlanConflict | null>(null);
  const currentMonth = monthKeyForDate(systemLocalCalendar.today());
  const canWrite = snapshot.repository.canWrite && Boolean(base);
  const hasStoredPlan = Boolean(base && Object.prototype.hasOwnProperty.call(base.sourceDocument, 'spending_plan'));

  const handleError = (cause: unknown) => {
    if (cause instanceof AppFailure && cause.detail.kind === 'spending_plan_conflict') {
      setConflict({ latest: cause.detail.latest, submitted: cause.detail.submitted });
      return;
    }
    setError({ message: cause instanceof Error ? cause.message : 'Unable to update this Fuel plan.', field: cause instanceof DomainValidationError ? cause.field : undefined });
  };
  const save = async () => {
    if (!base) return;
    setSaving(true); setError(null);
    try { await updateSpendingPlan(buildFuelMonthlyPlan(drafts, snapshot.group.currency, accountLogin, systemClock), base); router.back(); }
    catch (cause) { handleError(cause); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!base) return;
    setRemoving(true); setError(null);
    try { await removeSpendingPlan(base); setShowRemove(false); router.back(); }
    catch (cause) { setShowRemove(false); handleError(cause); }
    finally { setRemoving(false); }
  };
  const reapply = async () => {
    if (!conflict) return;
    setSaving(true);
    try { if (conflict.submitted) await updateSpendingPlan(conflict.submitted, conflict.latest); else await removeSpendingPlan(conflict.latest); router.back(); }
    catch (cause) { handleError(cause); }
    finally { setSaving(false); }
  };
  const discard = async () => {
    if (!conflict) return;
    setSaving(true);
    try { await acceptSpendingPlanFile(conflict.latest); router.back(); }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : 'Unable to accept the latest Fuel plan.' }); }
    finally { setSaving(false); }
  };
  const addLimit = () => {
    const latest = drafts.map((draft) => draft.effectiveMonth).filter((month) => /^\d{4}-\d{2}$/.test(month)).sort().at(-1) as `${number}-${string}` | undefined;
    setDrafts((current) => [...current, { effectiveMonth: latest && latest >= currentMonth ? nextMonth(latest) : currentMonth, amount: '' }]);
  };

  if (conflict) return <Screen><Title eyebrow={groupContextLabel('fuel', snapshot.group.name)}>Review spending-plan conflict</Title><Banner tone="warning">The monthly-limit schedule changed on GitHub. Review before reapplying your preserved values.</Banner><View style={styles.comparison}><FuelPlanCard title="Latest on GitHub" plan={conflict.latest.group.spending_plan} currency={snapshot.group.currency} /><FuelPlanCard title="Your submitted plan" plan={conflict.submitted} currency={snapshot.group.currency} /></View><Button loading={saving} onPress={() => void reapply()}>Reapply to latest version</Button><Button variant="secondary" disabled={saving} onPress={() => void discard()}>Discard my changes</Button></Screen>;

  return <Screen>
    <Title eyebrow={groupContextLabel('fuel', snapshot.group.name)}>Monthly fuel limits</Title>
    <Banner tone="info">Limits take effect from their month onward. Unused amounts never roll over and expenses are never blocked.</Banner>
    {!snapshot.repository.canWrite ? <Banner>You can review this schedule, but your GitHub permission does not allow updates.</Banner> : null}
    {drafts.map((draft, index) => <Card key={`${index}-${draft.effectiveMonth}`}>
      <Text style={[styles.heading, { color: colors.text }]}>Limit {index + 1}</Text>
      <Field label={`Effective month ${index + 1} (YYYY-MM)`} editable={canWrite} value={draft.effectiveMonth} onChangeText={(effectiveMonth) => setDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, effectiveMonth } : row))} placeholder="2026-08" error={error?.field === `month-${index}` ? error.message : undefined} />
      <Field label={`Monthly limit ${index + 1} (${snapshot.group.currency})`} editable={canWrite} keyboardType="decimal-pad" value={draft.amount} onChangeText={(amount) => setDrafts((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount } : row))} placeholder="0.00" error={error?.field === `amount-${index}` ? error.message : undefined} />
      <Button variant="ghost" disabled={!canWrite} onPress={() => setDrafts((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove this limit</Button>
    </Card>)}
    {!drafts.length ? <Card><Body>No monthly limit yet</Body><Body muted>Fuel spending and analytics still work without a limit.</Body></Card> : null}
    {error && (!error.field || error.field === 'monthlyLimits') ? <Banner tone="error">{error.message}</Banner> : null}
    <Button variant="secondary" disabled={!canWrite} onPress={addLimit}>Add effective-month limit</Button>
    <Button disabled={!canWrite || !drafts.length} loading={saving} onPress={() => void save()}>Save monthly limits</Button>
    {hasStoredPlan ? <Card><Text style={[styles.heading, { color: colors.negative }]}>Remove monthly limits</Text><Body muted>Expenses and Fuel analytics remain. Only the shared guidance schedule is removed.</Body><Button variant="danger" disabled={!canWrite} onPress={() => setShowRemove(true)}>Remove plan</Button></Card> : null}
    <ConfirmDialog visible={showRemove} title="Remove all monthly limits?" message="Fuel expenses and analytics stay intact. The complete shared limit schedule will be removed." confirmLabel="Remove plan" loading={removing} onCancel={() => setShowRemove(false)} onConfirm={() => void remove()} />
  </Screen>;
}

function FuelPlanCard({ title, plan, currency }: { title: string; plan: SpendingPlan | null | undefined; currency: 'EUR' | 'USD' | 'GBP' }) {
  const typed = isFuelMonthlyPlan(plan) ? plan as FuelMonthlyPlanV2 : null;
  const month = monthKeyForDate(systemLocalCalendar.today());
  return <Card style={styles.compareCard}><Body>{title}</Body>{typed ? <><Body>{typed.monthly_limits.length} effective {typed.monthly_limits.length === 1 ? 'limit' : 'limits'}</Body><Body muted>{month}: {applicableFuelLimit(typed, month) ? formatMoney(applicableFuelLimit(typed, month)!, currency) : 'No applicable limit'}</Body><Body muted>Updated by @{typed.updated_by}</Body></> : <Body muted>No Fuel monthly plan</Body>}</Card>;
}

const styles = StyleSheet.create({ heading: { fontSize: 18, fontWeight: '800' }, comparison: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, compareCard: { minWidth: '45%', flexGrow: 1 } });
