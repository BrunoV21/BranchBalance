import { allocateEqual, allocateFull, formatMoney, parseAmountToMinor } from './money';

describe('money', () => {
  test.each([
    ['42', 4200],
    ['42.5', 4250],
    ['42,50', 4250],
    ['0.01', 1],
  ])('parses %s without floating point conversion', (input, expected) => {
    expect(parseAmountToMinor(input, 'EUR')).toBe(expected);
  });

  test.each(['', '0', '-1', '+1', '1.234', '1,234.50', '1e2'])('rejects %s', (input) => {
    expect(() => parseAmountToMinor(input, 'EUR')).toThrow();
  });

  it('allocates equal shares deterministically', () => {
    expect(allocateEqual(10, ['Zed', 'amy', 'Bob'])).toEqual({ amy: 4, Bob: 3, Zed: 3 });
  });

  it('allocates a full share', () => {
    expect(allocateFull(4250, 'octocat', 'monalisa')).toEqual({ monalisa: 4250 });
    expect(() => allocateFull(4250, 'octocat', 'OctoCat')).toThrow();
  });

  it('formats configured currencies', () => {
    expect(formatMoney(4250, 'EUR', 'en-IE')).toContain('42.50');
  });
});
