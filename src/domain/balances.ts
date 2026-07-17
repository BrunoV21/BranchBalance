import type { BalanceResult, Expense, Member, MemberBalance, Settlement } from './types';

export function calculateBalances(expenses: Expense[], currentMembers: Member[]): BalanceResult {
  const rows = new Map<string, MemberBalance>();
  const ensure = (login: string, currentMember = false) => {
    const key = login.toLowerCase();
    const existing = rows.get(key);
    if (existing) {
      if (currentMember) existing.currentMember = true;
      return existing;
    }
    const row = { login, totalPaidMinor: 0, totalShareMinor: 0, netMinor: 0, currentMember };
    rows.set(key, row);
    return row;
  };
  for (const member of currentMembers) ensure(member.login, true);
  let totalSpentMinor = 0;
  for (const expense of expenses) {
    totalSpentMinor += expense.amount_minor;
    const payer = ensure(expense.paid_by);
    payer.totalPaidMinor += expense.amount_minor;
    payer.netMinor += expense.amount_minor;
    for (const [login, share] of Object.entries(expense.shares_minor)) {
      const participant = ensure(login);
      participant.totalShareMinor += share;
      participant.netMinor -= share;
    }
  }
  const members = [...rows.values()].sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()) || a.login.localeCompare(b.login));
  return { totalSpentMinor, members, zeroSum: members.reduce((sum, member) => sum + member.netMinor, 0) === 0 };
}

export function simplifySettlements(balances: MemberBalance[]): Settlement[] {
  if (balances.reduce((sum, row) => sum + row.netMinor, 0) !== 0) return [];
  const debtors = balances.filter((row) => row.netMinor < 0).map((row) => ({ login: row.login, amount: -row.netMinor }))
    .sort((a, b) => b.amount - a.amount || a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
  const creditors = balances.filter((row) => row.netMinor > 0).map((row) => ({ login: row.login, amount: row.netMinor }))
    .sort((a, b) => b.amount - a.amount || a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
  const result: Settlement[] = [];
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
