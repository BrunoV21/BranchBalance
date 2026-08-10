import { useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Banner, Body, Button, Card, ConfirmDialog, EmptyState, Field, Screen, Title } from '@/components/ui';
import { AppFailure, DomainValidationError } from '@/domain/errors';
import { formatMoney } from '@/domain/money';
import { effectiveGroupType, isTripPlan } from '@/domain/groups';
import { expenseCategories, expenseCategoryLabels } from '@/domain/spending';
import type { GroupFile, RemoteGroupSnapshot, SpendingPlan } from '@/domain/types';
import { DatePickerDialog } from '@/features/expenses/date-picker-dialog';
import { CategoryIcon } from '@/features/expenses/metadata-icons';
import { useGroupRefresh } from '@/features/groups/use-group-refresh';
import { groupContextLabel } from '@/features/groups/group-type-ui';
import { FuelMonthlyPlanEditor } from '@/features/spending/fuel-plan-form';
import { buildSpendingPlan, spendingPlanDraftFrom, type SpendingPlanDraft } from '@/features/spending/model';
import { systemClock, systemLocalCalendar } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

type PlanConflict = { latest: GroupFile; submitted: SpendingPlan | null };

export default function SpendingPlanScreen() {
  const { state } = useGroup();
  const { session } = useSession();
  const refresh = useGroupRefresh();
  const snapshot = state.data;
  if (!snapshot || !session.account) return <Screen><EmptyState title="Spending plan unavailable" body="Return to the group and refresh before editing its plan." /></Screen>;
  if (!snapshot.groupFile) return <Screen><Title eyebrow={snapshot.group.name}>Spending plan</Title><EmptyState title="Refresh required" body="The latest group file and SHA are required before the shared plan can be changed." action={<Button onPress={refresh}>Refresh group</Button>} /></Screen>;
  if (effectiveGroupType(snapshot.group) === 'fuel') return <FuelMonthlyPlanEditor snapshot={snapshot} accountLogin={session.account.login} />;
  return <SpendingPlanEditor initialSnapshot={snapshot} accountLogin={session.account.login} />;
}

function SpendingPlanEditor({ initialSnapshot: snapshot, accountLogin }: { initialSnapshot: RemoteGroupSnapshot; accountLogin: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { updateSpendingPlan, removeSpendingPlan, acceptSpendingPlanFile } = useGroup();
  const [draft, setDraft] = useState<SpendingPlanDraft>(() => spendingPlanDraftFrom(snapshot.group.spending_plan, snapshot.group.currency));
  const [base] = useState<GroupFile | null>(() => snapshot.groupFile);
  const [dateTarget, setDateTarget] = useState<'startsOn' | 'endsOn' | null>(null);
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [conflict, setConflict] = useState<PlanConflict | null>(null);

  const canWrite = snapshot.repository.canWrite && Boolean(base);
  const hasStoredPlan = Boolean(base && Object.prototype.hasOwnProperty.call(base.sourceDocument, 'spending_plan'));
  const patch = (next: Partial<SpendingPlanDraft>) => setDraft((current) => ({ ...current, ...next }));

  const handleError = (cause: unknown) => {
    if (cause instanceof AppFailure && cause.detail.kind === 'spending_plan_conflict') {
      setConflict({ latest: cause.detail.latest, submitted: cause.detail.submitted });
      return;
    }
    setError({ message: cause instanceof Error ? cause.message : 'Unable to update this spending plan.', field: cause instanceof DomainValidationError ? cause.field : undefined });
  };

  const save = async () => {
    if (!base) return;
    setSaving(true); setError(null);
    try {
      const intended = buildSpendingPlan(draft, snapshot.group.currency, accountLogin, systemClock);
      await updateSpendingPlan(intended, base);
      router.back();
    } catch (cause) { handleError(cause); }
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
    setSaving(true); setError(null);
    try {
      if (conflict.submitted) await updateSpendingPlan(conflict.submitted, conflict.latest);
      else await removeSpendingPlan(conflict.latest);
      router.back();
    } catch (cause) { handleError(cause); }
    finally { setSaving(false); }
  };

  const discard = async () => {
    if (!conflict) return;
    setSaving(true);
    try { await acceptSpendingPlanFile(conflict.latest); router.back(); }
    catch (cause) { setError({ message: cause instanceof Error ? cause.message : 'Unable to accept the latest spending plan.' }); }
    finally { setSaving(false); }
  };

  if (conflict) return <Screen>
    <Title eyebrow={groupContextLabel('trip', snapshot.group.name)}>Review spending-plan conflict</Title>
    <Banner tone="warning">The plan changed on GitHub. Your submitted values are preserved and will not overwrite the latest version without review.</Banner>
    <View style={styles.comparison}><PlanCard title="Latest on GitHub" plan={conflict.latest.group.spending_plan} currency={snapshot.group.currency} /><PlanCard title="Your submitted plan" plan={conflict.submitted} currency={snapshot.group.currency} /></View>
    <Button loading={saving} onPress={() => void reapply()}>Reapply to latest version</Button>
    <Button variant="secondary" disabled={saving} onPress={() => void discard()}>Discard my changes</Button>
  </Screen>;

  return <Screen>
    <Title eyebrow={groupContextLabel('trip', snapshot.group.name)}>Trip spending plan</Title>
    {!snapshot.repository.canWrite ? <Banner>You can review this plan, but your GitHub repository permission does not allow updates.</Banner> : !base ? <Banner tone="warning">Refresh must finish before this plan can be changed.</Banner> : null}
    <Card>
      <Text style={[styles.heading, { color: colors.text }]}>Total budget</Text>
      <Body muted>One optional, one-time target for every valid expense, including Just me spending.</Body>
      <Field label={`Budget amount (${snapshot.group.currency})`} editable={canWrite} value={draft.budget} onChangeText={(budget) => patch({ budget })} keyboardType="decimal-pad" placeholder="No total budget" error={error?.field === 'budget' ? error.message : undefined} />
      <Body muted>Informational only. Going over budget never blocks an expense.</Body>
    </Card>
    <Card>
      <Text style={[styles.heading, { color: colors.text }]}>Trip dates</Text>
      <Body muted>Both inclusive dates are required when this plan is saved. Existing legacy plans remain readable until edited.</Body>
      <DateField label="Budget starts" value={draft.startsOn} enabled={canWrite} onOpen={() => setDateTarget('startsOn')} onClear={() => patch({ startsOn: '' })} />
      <DateField label="Budget ends" value={draft.endsOn} enabled={canWrite} onOpen={() => setDateTarget('endsOn')} onClear={() => patch({ endsOn: '' })} />
      {error?.field === 'dates' || error?.field === 'startsOn' || error?.field === 'endsOn' ? <Banner tone="error">{error.message}</Banner> : null}
    </Card>
    <Card>
      <Text style={[styles.heading, { color: colors.text }]}>Category limits</Text>
      <Body muted>Optional guardrails inside the total budget. They do not need to add up to the total.</Body>
      {expenseCategories.map((category) => <Field key={category} label={`${expenseCategoryLabels[category]} (${snapshot.group.currency})`} labelIcon={<CategoryIcon category={category} size={19} />} editable={canWrite} value={draft.categoryBudgets[category]} onChangeText={(value) => setDraft((current) => ({ ...current, categoryBudgets: { ...current.categoryBudgets, [category]: value } }))} keyboardType="decimal-pad" placeholder="No limit" error={error?.field === category ? error.message : undefined} />)}
    </Card>
    {snapshot.group.spending_plan ? <Banner tone="info">Last updated by @{snapshot.group.spending_plan.updated_by} on {new Date(snapshot.group.spending_plan.updated_at).toLocaleString()}. All accepted members with write access can edit this shared plan.</Banner> : null}
    {error && !error.field ? <Banner tone="error">{error.message}</Banner> : null}
    <Button disabled={!canWrite} loading={saving} onPress={() => void save()}>Save spending plan</Button>
    {hasStoredPlan ? <Card><Text style={[styles.heading, { color: colors.negative }]}>Remove spending plan</Text><Body muted>Expenses and balances stay intact. Budget progress, category limits, dates, and daily guidance disappear.</Body><Button variant="danger" disabled={!canWrite} onPress={() => setShowRemove(true)}>Remove plan</Button></Card> : null}
    {dateTarget ? <DatePickerDialog value={(draft[dateTarget] || systemLocalCalendar.today()) as `${string}-${string}-${string}`} onCancel={() => setDateTarget(null)} onConfirm={(value) => { patch({ [dateTarget]: value }); setDateTarget(null); }} /> : null}
    <ConfirmDialog visible={showRemove} title="Remove this spending plan?" message="Expenses and balances will remain unchanged, but all shared budget guidance will be removed." confirmLabel="Remove plan" loading={removing} onCancel={() => setShowRemove(false)} onConfirm={() => void remove()} />
  </Screen>;
}

function DateField({ label, value, enabled, onOpen, onClear }: { label: string; value: string; enabled: boolean; onOpen(): void; onClear(): void }) {
  return <View style={styles.dateField}><Body>{label}</Body><View style={styles.dateActions}><View style={{ flex: 1 }}><Button variant="secondary" disabled={!enabled} onPress={onOpen}>{value || 'Select date'}</Button></View>{value ? <Button variant="ghost" disabled={!enabled} onPress={onClear}>Clear</Button> : null}</View></View>;
}

function PlanCard({ title, plan, currency }: { title: string; plan: SpendingPlan | null | undefined; currency: 'EUR' | 'USD' | 'GBP' }) {
  const trip = isTripPlan(plan) ? plan : null;
  return <Card style={styles.compareCard}><Body>{title}</Body>{trip ? <><Body>{trip.budget_minor ? formatMoney(trip.budget_minor, currency) : 'No total budget'}</Body><Body muted>{trip.starts_on && trip.ends_on ? `${trip.starts_on} → ${trip.ends_on}` : 'Legacy plan needs dates before saving'}</Body><Body muted>{Object.keys(trip.category_budgets_minor ?? {}).length} category limits</Body><Body muted>Updated by @{trip.updated_by}</Body></> : <Body muted>No Trip spending plan</Body>}</Card>;
}

const styles = StyleSheet.create({ heading: { fontSize: 18, fontWeight: '800' }, dateField: { gap: 7 }, dateActions: { flexDirection: 'row', gap: 8, alignItems: 'center' }, comparison: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, compareCard: { minWidth: '45%', flexGrow: 1 } });
