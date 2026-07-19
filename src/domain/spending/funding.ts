import { normalizeLogin, type ExpenseFundingAnalytics, type MemberBalance } from '@/domain/types';

export function deriveExpenseFundingAnalytics(members: readonly MemberBalance[], currentLogin: string): ExpenseFundingAnalytics {
  const current = normalizeLogin(currentLogin);
  const rows = members.map((member) => ({
    login: member.login,
    paidMinor: member.totalPaidMinor,
    shareMinor: member.totalShareMinor,
    gapMinor: member.totalPaidMinor - member.totalShareMinor,
    currentMember: member.currentMember,
  })).sort((left, right) => {
    const leftCurrent = normalizeLogin(left.login) === current;
    const rightCurrent = normalizeLogin(right.login) === current;
    if (leftCurrent !== rightCurrent) return leftCurrent ? -1 : 1;
    return normalizeLogin(left.login).localeCompare(normalizeLogin(right.login)) || left.login.localeCompare(right.login);
  });
  const scaleMaxMinor = Math.max(1, ...rows.flatMap((row) => [row.paidMinor, row.shareMinor]));
  return { scaleMaxMinor, rows };
}
