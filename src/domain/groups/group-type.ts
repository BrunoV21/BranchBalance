import { DomainValidationError } from '@/domain/errors';
import type { FuelMonthlyPlanV2, Group, KnownGroupType, ReceiptProfileId, SpendingPlan, TripPlanV2 } from '@/domain/types';

export function effectiveGroupType(group: Group): KnownGroupType | null {
  if (group.schema_version === 1) return 'trip';
  return group.group_type === 'trip' || group.group_type === 'fuel' ? group.group_type : null;
}

export function requireEffectiveGroupType(group: Group): KnownGroupType {
  const type = effectiveGroupType(group);
  if (!type) throw new DomainValidationError('This group type requires a newer BranchBalance version.');
  return type;
}

export function receiptProfileFor(type: KnownGroupType): ReceiptProfileId {
  return type === 'trip' ? 'generic_v1' : 'fuel_v1';
}

export function isTripPlan(plan: SpendingPlan | null | undefined): plan is Exclude<SpendingPlan, FuelMonthlyPlanV2> {
  return Boolean(plan && (!('kind' in plan) || plan.kind === 'trip'));
}

export function isTripPlanV2(plan: SpendingPlan | null | undefined): plan is TripPlanV2 {
  return Boolean(plan && 'kind' in plan && plan.kind === 'trip');
}

export function isFuelMonthlyPlan(plan: SpendingPlan | null | undefined): plan is FuelMonthlyPlanV2 {
  return Boolean(plan && 'kind' in plan && plan.kind === 'fuel_monthly');
}

export const groupTypeDefinition = {
  trip: {
    type: 'trip',
    label: 'Trip',
    description: 'A dated trip with a total budget and daily pace.',
    receiptProfile: 'generic_v1',
  },
  fuel: {
    type: 'fuel',
    label: 'Fuel',
    description: 'Ongoing fuel purchases with monthly limits and fuel insights.',
    receiptProfile: 'fuel_v1',
  },
} as const satisfies Record<KnownGroupType, { type: KnownGroupType; label: string; description: string; receiptProfile: ReceiptProfileId }>;
