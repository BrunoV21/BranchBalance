import type { ActivityDestination, ActivityKind } from '@/domain/types';

export const activityKinds = [
  'expense_added',
  'expense_updated',
  'expense_deleted',
  'spending_plan_updated',
  'spending_plan_removed',
  'settlement_recorded',
  'settlement_confirmed',
  'settlement_deleted',
  'group_created',
  'group_updated',
  'group_invitation_received',
  'group_added',
  'additional_activity',
] as const satisfies readonly ActivityKind[];

export const activitySources = ['commit', 'invitation', 'group', 'summary'] as const;
export const activityDestinationKinds = ['groups', 'overview', 'expense', 'spending', 'balances'] as const;

export const activityLabels: Record<ActivityKind, string> = {
  expense_added: 'Expense added',
  expense_updated: 'Expense updated',
  expense_deleted: 'Expense deleted',
  spending_plan_updated: 'Spending plan updated',
  spending_plan_removed: 'Spending plan removed',
  settlement_recorded: 'Payment recorded; awaiting confirmation',
  settlement_confirmed: 'Payment confirmed',
  settlement_deleted: 'Payment record removed',
  group_created: 'Group created',
  group_updated: 'Group data updated',
  group_invitation_received: 'Group invitation received',
  group_added: 'Group added to Your groups',
  additional_activity: 'Additional group activity was detected',
};

export function destinationForActivity(kind: ActivityKind, resourceId?: string): ActivityDestination {
  if ((kind === 'expense_added' || kind === 'expense_updated') && resourceId) return { kind: 'expense', expenseId: resourceId };
  if (kind === 'spending_plan_updated' || kind === 'spending_plan_removed') return { kind: 'spending' };
  if (kind === 'settlement_recorded' || kind === 'settlement_confirmed' || kind === 'settlement_deleted') return { kind: 'balances' };
  if (kind === 'group_invitation_received') return { kind: 'groups' };
  return { kind: 'overview' };
}
