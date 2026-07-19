import { calculateBalances, simplifySettlements } from '@/domain/balances';
import { deriveSettlementReservations, sortSettlementPayments } from '@/domain/settlements';
import type { RemoteGroupSnapshot, SettlementLedgerState, SettlementPayment, SettlementReservation } from '@/domain/types';

export function settlementPayments(
  ledger: SettlementLedgerState | undefined,
  cached: readonly SettlementPayment[] = [],
): SettlementPayment[] {
  if (!ledger || ledger.kind === 'unverified') return sortSettlementPayments(cached);
  if (ledger.kind === 'ready') return sortSettlementPayments(ledger.file.payments);
  return [];
}

export function withSettlementLedger(
  snapshot: RemoteGroupSnapshot,
  ledger: SettlementLedgerState,
  syncedAt: string,
): RemoteGroupSnapshot {
  return rebuildSettlementData(snapshot, ledger, settlementPayments(ledger, snapshot.payments), syncedAt);
}

export function rebuildSettlementData(
  snapshot: RemoteGroupSnapshot,
  ledger: SettlementLedgerState = snapshot.settlementLedger ?? { kind: 'unverified' },
  payments: readonly SettlementPayment[] = settlementPayments(ledger, snapshot.payments),
  syncedAt: string = snapshot.syncedAt,
): RemoteGroupSnapshot {
  const orderedPayments = sortSettlementPayments(payments);
  const balances = calculateBalances(snapshot.expenses.map((file) => file.expense), orderedPayments, snapshot.members);
  const warnings = snapshot.warnings.filter((warning) => !warning.path.startsWith('settlements.json'));
  if (ledger.kind === 'ready') warnings.push(...ledger.file.warnings);
  if (ledger.kind === 'invalid') warnings.push(ledger.warning);
  const suggestions = balances.zeroSum && ledger.kind !== 'invalid' ? simplifySettlements(balances.members) : [];
  let reservations: SettlementReservation[] = [];
  try { reservations = ledger.kind === 'invalid' ? [] : deriveSettlementReservations(suggestions, orderedPayments); }
  catch (error) {
    warnings.push({ path: 'settlements.json', reason: error instanceof Error ? error.message : 'Unable to derive pending reservations.' });
  }
  return {
    ...snapshot,
    balances,
    settlements: suggestions,
    settlementLedger: ledger,
    payments: orderedPayments,
    reservations,
    warnings,
    syncedAt,
  };
}
