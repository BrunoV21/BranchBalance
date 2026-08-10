import { parseExpenseDocument, parseExpenseFile, parseGroup, parseGroupDocument, parseSpendingPlan } from './schemas';

const baseExpense = {
  schema_version: 1,
  id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234',
  description: 'Dinner',
  amount_minor: 4250,
  currency: 'EUR',
  paid_by: 'octocat',
  split_type: 'equal',
  participants: ['monalisa', 'octocat'],
  shares_minor: { monalisa: 2125, octocat: 2125 },
  created_by: 'octocat',
  created_at: '2026-07-16T18:32:00.000Z',
  updated_by: null,
  updated_at: null,
};

describe('GitHub document schemas', () => {
  it('parses a valid group and strips unknown fields', () => {
    expect(parseGroup({
      schema_version: 1,
      name: 'Road trip',
      currency: 'EUR',
      created_by: 'octocat',
      created_at: '2026-07-16T12:00:00.000Z',
      future: true,
    })).not.toHaveProperty('future');
  });

  it('derives a legacy expense date from created_at', () => {
    const expense = parseExpenseFile(baseExpense, `expenses/${baseExpense.id}.json`, 'EUR');
    expect(expense.expense_date).toBe('2026-07-16');
    expect(expense.category).toBeNull();
    expect(expense.payment_method).toBeNull();
  });

  it('accepts the CR-001 metadata taxonomy and preserves passthrough fields', () => {
    const parsed = parseExpenseDocument({ ...baseExpense, category: 'food_drink', payment_method: 'card', future: { retained: true } }, `expenses/${baseExpense.id}.json`, 'EUR');
    expect(parsed.expense).toMatchObject({ category: 'food_drink', payment_method: 'card' });
    expect(parsed.sourceDocument.future).toEqual({ retained: true });
  });

  it.each([
    { category: null, payment_method: 'card' },
    { category: 'uncategorized', payment_method: 'card' },
    { category: 'food_drink', payment_method: null },
    { category: 'food_drink', payment_method: 'unspecified' },
  ])('rejects present invalid or legacy metadata %#', (metadata) => {
    expect(() => parseExpenseFile({ ...baseExpense, ...metadata }, `expenses/${baseExpense.id}.json`, 'EUR')).toThrow();
  });

  it('rejects a path/id mismatch and invalid totals', () => {
    expect(() => parseExpenseFile(baseExpense, 'expenses/00000000-0000-4000-8000-000000000000.json', 'EUR')).toThrow();
    expect(() => parseExpenseFile({ ...baseExpense, shares_minor: { monalisa: 1, octocat: 1 } }, `expenses/${baseExpense.id}.json`, 'EUR')).toThrow();
  });

  it('enforces full-to-one constraints', () => {
    const full = {
      ...baseExpense,
      split_type: 'full',
      participants: ['monalisa'],
      shares_minor: { monalisa: 4250 },
      expense_date: '2026-07-15',
    };
    expect(parseExpenseFile(full, `expenses/${baseExpense.id}.json`, 'EUR').split_type).toBe('full');
    expect(() => parseExpenseFile({ ...full, participants: ['octocat'], shares_minor: { octocat: 4250 } }, `expenses/${baseExpense.id}.json`, 'EUR')).toThrow();
  });

  it('parses valid budget/date plans and reports an invalid plan without rejecting the base group', () => {
    const input = {
      schema_version: 1, name: 'Road trip', currency: 'EUR', created_by: 'octocat', created_at: '2026-07-16T12:00:00.000Z',
      spending_plan: { budget_minor: 100_000, category_budgets_minor: { food_drink: 20_000 }, starts_on: '2026-08-10', ends_on: '2026-08-16', updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z' },
    };
    expect(parseGroup(input).spending_plan?.budget_minor).toBe(100_000);
    const invalid = parseGroupDocument({ ...input, spending_plan: { ...input.spending_plan, ends_on: '2026-08-09' } });
    expect(invalid.group.spending_plan).toBeUndefined();
    expect(invalid.spendingPlanWarning).toMatch(/end date/i);
  });

  it('allows a date-only plan and rejects partial dates, empty category limits, and non-calendar dates', () => {
    expect(parseSpendingPlan({ starts_on: '2028-02-29', ends_on: '2028-03-01', updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z' })).toMatchObject({ starts_on: '2028-02-29' });
    expect(() => parseSpendingPlan({ starts_on: '2026-08-10', updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z' })).toThrow();
    expect(() => parseSpendingPlan({ budget_minor: 100, category_budgets_minor: {}, updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z' })).toThrow();
    expect(() => parseSpendingPlan({ starts_on: '2026-02-30', ends_on: '2026-03-01', updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z' })).toThrow();
  });

  it('maps schema-v1 to effective Trip and validates typed v2 envelopes', () => {
    const legacy = parseGroupDocument({ schema_version: 1, name: 'Legacy', currency: 'EUR', created_by: 'octocat', created_at: '2026-07-16T12:00:00.000Z' });
    expect(legacy).toMatchObject({ sourceVersion: 1, effectiveType: 'trip', unsupportedType: null });
    expect(legacy.sourceDocument).not.toHaveProperty('group_type');
    const fuel = parseGroupDocument({ schema_version: 2, group_type: 'fuel', name: 'Car', currency: 'EUR', spending_plan: { kind: 'fuel_monthly', monthly_limits: [{ effective_month: '2026-08', limit_minor: 25000 }], updated_by: 'octocat', updated_at: '2026-08-01T09:00:00.000Z' }, created_by: 'octocat', created_at: '2026-07-16T12:00:00.000Z' });
    expect(fuel).toMatchObject({ sourceVersion: 2, effectiveType: 'fuel', group: { group_type: 'fuel', spending_plan: { kind: 'fuel_monthly' } } });
    expect(() => parseGroupDocument({ ...fuel.sourceDocument, spending_plan: { kind: 'trip', starts_on: '2026-08-01', ends_on: '2026-08-02', updated_by: 'octocat', updated_at: '2026-08-01T09:00:00.000Z' } })).toThrow(/Fuel monthly/i);
  });

  it('keeps an unknown v2 type discoverable but unsupported', () => {
    const parsed = parseGroupDocument({ schema_version: 2, group_type: 'household_future', name: 'Home', currency: 'GBP', created_by: 'octocat', created_at: '2026-07-16T12:00:00.000Z' });
    expect(parsed).toMatchObject({ effectiveType: null, unsupportedType: 'household_future', group: { name: 'Home', currency: 'GBP' } });
  });

  it('enforces sorted duplicate-free Fuel monthly limits', () => {
    const base = { kind: 'fuel_monthly', updated_by: 'octocat', updated_at: '2026-08-01T09:00:00.000Z' };
    expect(() => parseSpendingPlan({ ...base, monthly_limits: [{ effective_month: '2026-09', limit_minor: 100 }, { effective_month: '2026-08', limit_minor: 200 }] }, 'fuel', 2)).toThrow(/sorted/i);
    expect(() => parseSpendingPlan({ ...base, monthly_limits: [{ effective_month: '2026-08', limit_minor: 100 }, { effective_month: '2026-08', limit_minor: 200 }] }, 'fuel', 2)).toThrow(/duplicate/i);
  });

  it('isolates generic and Fuel enrichment from otherwise valid common expenses', () => {
    const trip = parseExpenseDocument({ ...baseExpense, line_items: [{ description: 'Coffee', quantity: '1', unit_price_minor: 4250, line_total_minor: 4250 }] }, `expenses/${baseExpense.id}.json`, 'EUR', 'trip');
    expect(trip.expense.line_items).toHaveLength(1);
    const fuelData = { schema_version: 1, type: 'fuel', volume_millilitres: 24500, unit_price_micros_per_litre: 1633000, gross_amount_minor: 4001, discount_minor: 400 };
    const fuel = parseExpenseDocument({ ...baseExpense, amount_minor: 3601, shares_minor: { monalisa: 1801, octocat: 1800 }, category: 'transport', payment_method: 'card', type_data: fuelData }, `expenses/${baseExpense.id}.json`, 'EUR', 'fuel');
    expect(fuel.expense.type_data).toEqual(fuelData);
    const invalid = parseExpenseDocument({ ...baseExpense, category: 'transport', payment_method: 'card', type_data: { ...fuelData, discount_minor: 100 } }, `expenses/${baseExpense.id}.json`, 'EUR', 'fuel');
    expect(invalid.expense.amount_minor).toBe(baseExpense.amount_minor);
    expect(invalid.expense.type_data).toBeUndefined();
    expect(invalid.enrichmentWarnings[0]).toMatch(/Amount paid/i);
  });
});
