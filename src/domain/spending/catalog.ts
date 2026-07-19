export const expenseCategories = [
  'accommodation',
  'food_drink',
  'groceries',
  'transport',
  'activities',
  'shopping',
  'fees',
  'other',
] as const;

export type ExpenseCategory = (typeof expenseCategories)[number];

export const paymentMethods = ['card', 'cash', 'other'] as const;

export type PaymentMethod = (typeof paymentMethods)[number];
export type CategoryBucket = ExpenseCategory | 'uncategorized';
export type PaymentMethodBucket = PaymentMethod | 'unspecified';

export const categoryBuckets = [...expenseCategories, 'uncategorized'] as const;
export const paymentMethodBuckets = [...paymentMethods, 'unspecified'] as const;

export const expenseCategoryLabels: Record<ExpenseCategory, string> = {
  accommodation: 'Accommodation',
  food_drink: 'Food & drinks',
  groceries: 'Groceries',
  transport: 'Transport',
  activities: 'Activities',
  shopping: 'Shopping',
  fees: 'Fees',
  other: 'Other',
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  card: 'Card',
  cash: 'Cash',
  other: 'Other',
};

export function categoryLabel(value: CategoryBucket): string {
  return value === 'uncategorized' ? 'Uncategorized' : expenseCategoryLabels[value];
}

export function paymentMethodLabel(value: PaymentMethodBucket): string {
  return value === 'unspecified' ? 'Unspecified' : paymentMethodLabels[value];
}
