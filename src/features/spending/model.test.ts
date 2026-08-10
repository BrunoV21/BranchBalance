import { buildSpendingPlan, emptySpendingPlanDraft, minorUnitsForInput, spendingPlanDraftFrom } from './model';

const clock = { now: () => new Date('2026-07-17T14:00:00.000Z') };

describe('spending plan form model', () => {
  it('builds a canonical plan with once-generated audit values', () => {
    const draft = emptySpendingPlanDraft();
    draft.budget = '1000';
    draft.categoryBudgets.food_drink = '125.50';
    draft.startsOn = '2026-08-10';
    draft.endsOn = '2026-08-16';
    expect(buildSpendingPlan(draft, 'EUR', ' OctoCat ', clock)).toEqual({
      kind: 'trip',
      budget_minor: 100000,
      category_budgets_minor: { food_drink: 12550 },
      starts_on: '2026-08-10', ends_on: '2026-08-16',
      updated_by: 'octocat', updated_at: '2026-07-17T14:00:00.000Z',
    });
  });

  it('supports date-only plans and rejects partial/empty/limit-without-budget drafts', () => {
    const dates = emptySpendingPlanDraft();
    dates.startsOn = '2026-08-10'; dates.endsOn = '2026-08-10';
    expect(buildSpendingPlan(dates, 'EUR', 'octocat', clock)).toMatchObject({ starts_on: '2026-08-10' });
    const partial = { ...dates, endsOn: '' as const };
    expect(() => buildSpendingPlan(partial, 'EUR', 'octocat', clock)).toThrow(/both/i);
    expect(() => buildSpendingPlan(emptySpendingPlanDraft(), 'EUR', 'octocat', clock)).toThrow(/dates/i);
    const limits = emptySpendingPlanDraft(); limits.categoryBudgets.food_drink = '10';
    expect(() => buildSpendingPlan(limits, 'EUR', 'octocat', clock)).toThrow(/total budget/i);
  });

  it('round-trips safe minor units into unformatted inputs', () => {
    expect(minorUnitsForInput(100001, 'EUR')).toBe('1000.01');
    expect(spendingPlanDraftFrom({ budget_minor: 100001, updated_by: 'a', updated_at: '2026-07-17T14:00:00.000Z' }, 'EUR').budget).toBe('1000.01');
  });
});
