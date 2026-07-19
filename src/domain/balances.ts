import { normalizeLogin, type BalanceResult, type Expense, type Member, type MemberBalance, type SettlementPayment, type SuggestedSettlement } from './types';

export function calculateBalances(expenses: readonly Expense[], currentMembers: readonly Member[]): BalanceResult;
export function calculateBalances(expenses: readonly Expense[], payments: readonly SettlementPayment[], currentMembers: readonly Member[]): BalanceResult;
export function calculateBalances(
  expenses: readonly Expense[],
  paymentsOrMembers: readonly SettlementPayment[] | readonly Member[],
  suppliedMembers?: readonly Member[],
): BalanceResult {
  const payments = suppliedMembers ? paymentsOrMembers as readonly SettlementPayment[] : [];
  const currentMembers = suppliedMembers ?? paymentsOrMembers as readonly Member[];
  const rows = new Map<string, MemberBalance>();
  let safe = true;
  const ensure = (login: string, currentMember = false) => {
    const key = normalizeLogin(login);
    const existing = rows.get(key);
    if (existing) {
      if (currentMember) existing.currentMember = true;
      return existing;
    }
    const row = { login: login.trim(), totalPaidMinor: 0, totalShareMinor: 0, settlementSentMinor: 0, settlementReceivedMinor: 0, netMinor: 0, currentMember };
    rows.set(key, row);
    return row;
  };
  const add = (row: MemberBalance, field: 'totalPaidMinor' | 'totalShareMinor' | 'settlementSentMinor' | 'settlementReceivedMinor' | 'netMinor', amount: number) => {
    const next = row[field] + amount;
    if (!Number.isSafeInteger(next)) { safe = false; return; }
    row[field] = next;
  };
  for (const member of currentMembers) ensure(member.login, true);
  let totalSpentMinor = 0;
  for (const expense of expenses) {
    const nextTotal = totalSpentMinor + expense.amount_minor;
    if (Number.isSafeInteger(nextTotal)) totalSpentMinor = nextTotal;
    else safe = false;
    const payer = ensure(expense.paid_by);
    add(payer, 'totalPaidMinor', expense.amount_minor);
    add(payer, 'netMinor', expense.amount_minor);
    for (const [login, share] of Object.entries(expense.shares_minor)) {
      const participant = ensure(login);
      add(participant, 'totalShareMinor', share);
      add(participant, 'netMinor', -share);
    }
  }
  for (const payment of payments) {
    const sender = ensure(payment.from);
    const recipient = ensure(payment.to);
    if (payment.status !== 'confirmed') continue;
    add(sender, 'settlementSentMinor', payment.amount_minor);
    add(sender, 'netMinor', payment.amount_minor);
    add(recipient, 'settlementReceivedMinor', payment.amount_minor);
    add(recipient, 'netMinor', -payment.amount_minor);
  }
  const members = [...rows.values()].sort((a, b) => normalizeLogin(a.login).localeCompare(normalizeLogin(b.login)) || a.login.localeCompare(b.login));
  let netTotal = 0;
  for (const member of members) {
    netTotal += member.netMinor;
    if (!Number.isSafeInteger(netTotal)) safe = false;
  }
  return { totalSpentMinor, members, zeroSum: safe && netTotal === 0 };
}

export function simplifySettlements(balances: readonly MemberBalance[]): SuggestedSettlement[] {
  let total = 0;
  for (const row of balances) {
    total += row.netMinor;
    if (!Number.isSafeInteger(total)) return [];
  }
  if (total !== 0) return [];
  const debtors = balances.filter((row) => row.netMinor < 0).map((row) => ({ login: row.login, amount: -row.netMinor }))
    .sort((a, b) => b.amount - a.amount || normalizeLogin(a.login).localeCompare(normalizeLogin(b.login)));
  const creditors = balances.filter((row) => row.netMinor > 0).map((row) => ({ login: row.login, amount: row.netMinor }))
    .sort((a, b) => b.amount - a.amount || normalizeLogin(a.login).localeCompare(normalizeLogin(b.login)));
  const result: SuggestedSettlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex]!;
    const creditor = creditors[creditorIndex]!;
    const amountMinor = Math.min(debtor.amount, creditor.amount);
    if (amountMinor > 0) result.push({ from: debtor.login, to: creditor.login, amountMinor });
    debtor.amount -= amountMinor;
    creditor.amount -= amountMinor;
    if (debtor.amount === 0) debtorIndex += 1;
    if (creditor.amount === 0) creditorIndex += 1;
  }
  return result;
}

export function sortExpenses<T extends { expense: Expense }>(expenses: T[]): T[] {
  return [...expenses].sort((a, b) => b.expense.expense_date.localeCompare(a.expense.expense_date)
    || b.expense.created_at.localeCompare(a.expense.created_at)
    || a.expense.id.localeCompare(b.expense.id));
}
