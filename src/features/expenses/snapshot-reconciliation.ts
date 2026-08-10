import { calculateBalances, simplifySettlements, sortExpenses } from '@/domain/balances';
import { parseExpenseDocument, parseGroupDocument } from '@/domain/schemas';
import { deriveSpendingSummary } from '@/domain/spending';
import { deriveFuelAnalytics } from '@/domain/analytics';
import { effectiveGroupType } from '@/domain/groups';
import type { CalendarDate, ExpenseFile, GroupFile, RemoteGroupSnapshot } from '@/domain/types';
import { rebuildSettlementData, settlementPayments } from '@/features/settlements/snapshot-reconciliation';

export type ConfirmedExpenseMutation =
  | { kind: 'upsert'; file: ExpenseFile }
  | { kind: 'delete'; expenseId: string };

const balanceWarning = 'Balances do not sum to zero.';
const spendingWarningPrefix = 'Spending summary unavailable:';

export function withExpenses(snapshot: RemoteGroupSnapshot, files: ExpenseFile[], currentUser: string, today: CalendarDate, syncedAt: string): RemoteGroupSnapshot {
  return rebuildSnapshot(snapshot, files, snapshot.groupFile, currentUser, today, syncedAt);
}

export function withGroupFile(snapshot: RemoteGroupSnapshot, groupFile: GroupFile, currentUser: string, today: CalendarDate, syncedAt: string): RemoteGroupSnapshot {
  return rebuildSnapshot(snapshot, snapshot.expenses, groupFile, currentUser, today, syncedAt);
}

export function rebuildSnapshot(snapshot: RemoteGroupSnapshot, files: ExpenseFile[], groupFile: GroupFile | null, currentUser: string, today: CalendarDate, syncedAt: string): RemoteGroupSnapshot {
  const expenses = sortExpenses(files);
  const ledger = snapshot.settlementLedger ?? { kind: 'unverified' as const };
  const payments = settlementPayments(ledger, snapshot.payments);
  const balances = calculateBalances(expenses.map((file) => file.expense), payments, snapshot.members);
  const warnings = snapshot.warnings.filter((warning) => warning.path !== 'expenses/' || (warning.reason !== balanceWarning && !warning.reason.startsWith(spendingWarningPrefix)));
  if (!balances.zeroSum) warnings.push({ path: 'expenses/', reason: balanceWarning });
  const group = groupFile?.group ?? snapshot.group;
  const effectiveType = groupFile?.effectiveType ?? snapshot.effectiveType ?? effectiveGroupType(group);
  let spending = null;
  try { spending = effectiveType ? deriveSpendingSummary(expenses.map((file) => file.expense), effectiveType === 'trip' ? group.spending_plan : undefined, currentUser, today) : null; }
  catch (error) { warnings.push({ path: 'expenses/', reason: `${spendingWarningPrefix} ${error instanceof Error ? error.message : 'data integrity error'}` }); }
  let analytics: RemoteGroupSnapshot['analytics'] = null;
  if (spending) {
    try {
      analytics = effectiveType === 'trip'
        ? { type: 'trip' as const, spending }
        : effectiveType === 'fuel'
          ? { type: 'fuel' as const, common: spending, fuel: deriveFuelAnalytics(expenses.map((file) => file.expense), group.spending_plan, today, undefined, warnings.filter((warning) => warning.path.includes('#type_data'))) }
          : null;
    } catch (error) {
      warnings.push({ path: 'expenses/#analytics', reason: error instanceof Error ? error.message : 'Unable to derive type-specific analytics.' });
    }
  }
  return rebuildSettlementData({
    ...snapshot,
    group,
    groupFile,
    expenses,
    balances,
    settlements: balances.zeroSum && ledger.kind !== 'invalid' ? simplifySettlements(balances.members) : [],
    spending,
    effectiveType,
    analytics,
    cacheVersion: 2,
    warnings,
    syncedAt,
  }, ledger, payments, syncedAt);
}

export function hydrateCachedSnapshot(snapshot: RemoteGroupSnapshot, currentUser: string, today: CalendarDate): RemoteGroupSnapshot {
  const groupSource = snapshot.groupFile?.sourceDocument ?? snapshot.group;
  const parsedGroup = parseGroupDocument(groupSource);
  const groupFile = snapshot.groupFile?.blobSha
    ? { group: parsedGroup.group, blobSha: snapshot.groupFile.blobSha, path: 'group.json' as const, sourceDocument: parsedGroup.sourceDocument, sourceVersion: parsedGroup.sourceVersion, effectiveType: parsedGroup.effectiveType }
    : null;
  const warnings = snapshot.warnings.filter((warning) => warning.path !== 'group.json#spending_plan');
  if (parsedGroup.spendingPlanWarning) warnings.push({ path: 'group.json#spending_plan', reason: parsedGroup.spendingPlanWarning });
  const expenses: ExpenseFile[] = [];
  for (const file of snapshot.expenses) {
    try {
      const fallbackSource = { ...file.expense } as Record<string, unknown>;
      if (fallbackSource.category === null || fallbackSource.category === undefined) delete fallbackSource.category;
      if (fallbackSource.payment_method === null || fallbackSource.payment_method === undefined) delete fallbackSource.payment_method;
      if (!parsedGroup.effectiveType) continue;
      const parsed = parseExpenseDocument(file.sourceDocument ?? fallbackSource, file.path, parsedGroup.group.currency, parsedGroup.effectiveType);
      expenses.push({ expense: parsed.expense, blobSha: file.blobSha, path: file.path, sourceDocument: parsed.sourceDocument });
      for (const reason of parsed.enrichmentWarnings) warnings.push({ path: `${file.path}#${parsedGroup.effectiveType === 'fuel' ? 'type_data' : 'line_items'}`, reason });
    } catch (error) {
      warnings.push({ path: file.path, reason: error instanceof Error ? error.message : 'Invalid cached expense file.' });
    }
  }
  return rebuildSnapshot({ ...snapshot, group: parsedGroup.group, groupFile, settlementLedger: { kind: 'unverified' }, payments: snapshot.payments ?? [], warnings }, expenses, groupFile, currentUser, today, snapshot.syncedAt);
}

export function reconcileConfirmedExpenseMutations(remote: RemoteGroupSnapshot, mutations: Map<string, ConfirmedExpenseMutation>, currentUser: string, today: CalendarDate) {
  if (!mutations.size) return remote;
  const files = new Map(remote.expenses.map((file) => [file.expense.id, file]));
  for (const [expenseId, mutation] of mutations) {
    const remoteFile = files.get(expenseId);
    if (mutation.kind === 'upsert') {
      if (remoteFile?.blobSha === mutation.file.blobSha) mutations.delete(expenseId);
      else files.set(expenseId, mutation.file);
    } else if (!remoteFile) mutations.delete(expenseId);
    else files.delete(expenseId);
  }
  return withExpenses(remote, [...files.values()], currentUser, today, remote.syncedAt);
}
