import { parseExpenseFile, parseGroup } from './schemas';

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
    expect(parseExpenseFile(baseExpense, `expenses/${baseExpense.id}.json`, 'EUR').expense_date)
      .toBe('2026-07-16');
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
});
