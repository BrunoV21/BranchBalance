import { calculateBalances, simplifySettlements, sortExpenses } from '@/domain/balances';
import type { ExpenseFile, RemoteGroupSnapshot } from '@/domain/types';

export type ConfirmedExpenseMutation =
  | { kind: 'upsert'; file: ExpenseFile }
  | { kind: 'delete'; expenseId: string };

const balanceWarning = 'Balances do not sum to zero.';

export function withExpenses(snapshot: RemoteGroupSnapshot, files: ExpenseFile[], syncedAt: string): RemoteGroupSnapshot {
  const expenses = sortExpenses(files);
  const balances = calculateBalances(expenses.map((file) => file.expense), snapshot.members);
  const warnings = snapshot.warnings.filter((warning) => warning.path !== 'expenses/' || warning.reason !== balanceWarning);
  if (!balances.zeroSum) warnings.push({ path: 'expenses/', reason: balanceWarning });
  return {
    ...snapshot,
    expenses,
    balances,
    settlements: balances.zeroSum ? simplifySettlements(balances.members) : [],
    warnings,
    syncedAt,
  };
}

export function reconcileConfirmedExpenseMutations(remote: RemoteGroupSnapshot, mutations: Map<string, ConfirmedExpenseMutation>) {
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
  return withExpenses(remote, [...files.values()], remote.syncedAt);
}
