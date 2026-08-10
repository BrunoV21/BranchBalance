import type { Expense, FuelMonthlyPlanV2 } from '@/domain/types';

import { applicableFuelLimit, deriveFuelAnalytics, normalizeStation } from './fuel-analytics';

const plan: FuelMonthlyPlanV2 = { kind: 'fuel_monthly', monthly_limits: [{ effective_month: '2026-07', limit_minor: 10000 }, { effective_month: '2026-09', limit_minor: 12000 }], updated_by: 'alice', updated_at: '2026-07-01T00:00:00.000Z' };
const expense = (id: string, date: string, description: string, amount: number, volume?: number, discount?: number): Expense => ({ schema_version: 1, id, description, amount_minor: amount, currency: 'EUR', category: 'transport', payment_method: 'card', paid_by: 'alice', split_type: 'equal', participants: ['alice'], shares_minor: { alice: amount }, expense_date: date, created_by: 'alice', created_at: `${date}T12:00:00.000Z`, updated_by: null, updated_at: null, ...(volume === undefined ? {} : { type_data: { schema_version: 1, type: 'fuel', volume_millilitres: volume, ...(discount === undefined ? {} : { discount_minor: discount }) } }) });

describe('Fuel analytics', () => {
  it('applies historical limits without rollover', () => {
    expect(applicableFuelLimit(plan, '2026-06')).toBeNull();
    expect(applicableFuelLimit(plan, '2026-08')).toBe(10000);
    expect(applicableFuelLimit(plan, '2026-09')).toBe(12000);
  });

  it('includes amount-only expenses in spend while disclosing metric coverage', () => {
    const rows = [expense('00000000-0000-4000-8000-000000000001', '2026-08-02', 'Shell Norte', 4000, 20000, 200), expense('00000000-0000-4000-8000-000000000002', '2026-08-12', 'shell  norte', 3000)];
    const result = deriveFuelAnalytics(rows, plan, '2026-08-20', '2026-08');
    expect(result.selectedMonth).toMatchObject({ paidMinor: 7000, applicableLimitMinor: 10000, remainingMinor: 3000, expenseCount: 2, representedVolumeMl: 20000, expensesWithVolume: 1, explicitDiscountMinor: 200 });
    expect(result.coverage).toMatchObject({ expenseCount: 2, withVolume: 1, withExplicitDiscount: 1 });
    expect(result.stationRows).toEqual([expect.objectContaining({ key: 'shell norte', paidMinor: 7000, expenseCount: 2 })]);
  });

  it('uses aggregate paid/volume for a weighted effective price', () => {
    const rows = [expense('00000000-0000-4000-8000-000000000001', '2026-08-02', 'A', 1000, 10000), expense('00000000-0000-4000-8000-000000000002', '2026-08-12', 'B', 6000, 30000)];
    expect(deriveFuelAnalytics(rows, undefined, '2026-08-20', '2026-08').selectedMonth.weightedPaidPrice).toEqual({ numerator: 7000, denominator: 40000 });
  });

  it('normalizes station identity without stripping accents', () => {
    expect(normalizeStation('  GALP   São João ')).toBe('galp são joão');
    expect(normalizeStation('GALP Sao Joao')).not.toBe(normalizeStation('GALP São João'));
  });
});
