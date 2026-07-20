import { buildReceiptExpensePrefill, parseMinorAmount, parseReceipt } from './parse-receipt';
import type { OcrBlock, OcrResult } from './receipt-types';

function block(text: string, confidence: number, y: number): OcrBlock {
  return { text, confidence, points: [{ x: 20, y }, { x: 900, y }, { x: 900, y: y + 50 }, { x: 20, y: y + 50 }] };
}

function result(blocks: OcrBlock[]): OcrResult {
  return { width: 1000, height: 2000, blocks };
}

describe('receipt parser', () => {
  it('extracts Portuguese/European receipt fields as integer minor units', () => {
    const parsed = parseReceipt(result([
      block('SUPERMARKET LISBOA', 0.97, 70),
      block('20/07/2026 18:42', 0.94, 180),
      block('SUBTOTAL EUR 40,28', 0.97, 1600),
      block('IVA 2,99', 0.96, 1700),
      block('TOTAL EUR 43,27', 0.98, 1850),
    ]), 'EUR');

    expect(parsed).toMatchObject({ merchant: 'SUPERMARKET LISBOA', date: '2026-07-20', currency: 'EUR', subtotalMinor: 4028, taxMinor: 299, totalMinor: 4327 });
    expect(parsed.warnings).toEqual([]);
  });

  it('blocks an amount when the receipt currency conflicts with the group', () => {
    const prefill = buildReceiptExpensePrefill(result([
      block('CORNER SHOP', 0.98, 60),
      block('2026-07-20', 0.98, 150),
      block('TOTAL USD 12.50', 0.99, 1800),
    ]), 'EUR', 'test-bundle');

    expect(prefill.description).toBe('CORNER SHOP');
    expect(prefill.amount).toBeUndefined();
    expect(prefill.warnings).toContain('Receipt currency USD does not match this EUR group.');
  });

  it('does not silently choose between similarly scored competing totals', () => {
    const parsed = parseReceipt(result([
      block('CAFE CENTRAL', 0.98, 50),
      block('TOTAL EUR 18,40', 0.97, 1700),
      block('VALOR TOTAL EUR 19,40', 0.96, 1800),
    ]), 'EUR');

    expect(parsed.totalMinor).toBeUndefined();
    expect(parsed.warnings).toContain('Several possible totals were found; enter the amount manually.');
  });

  it('associates a total label with a separately detected amount on the same row', () => {
    const parsed = parseReceipt(result([
      block('CAFE CENTRAL', 0.99, 50),
      { text: 'TOTAL EUR', confidence: 0.97, points: [{ x: 40, y: 1750 }, { x: 420, y: 1750 }, { x: 420, y: 1810 }, { x: 40, y: 1810 }] },
      { text: '43,27', confidence: 0.98, points: [{ x: 700, y: 1750 }, { x: 920, y: 1750 }, { x: 920, y: 1810 }, { x: 700, y: 1810 }] },
    ]), 'EUR');

    expect(parsed.totalMinor).toBe(4327);
    expect(parsed.confidence.total).toBe(0.97);
  });

  it.each([
    ['43,27', 4327],
    ['1 234,56', 123456],
    ['1,234.56', 123456],
    ['TOTAL £ 9.10', 910],
  ])('parses %s without floating-point arithmetic', (text, expected) => {
    expect(parseMinorAmount(text)).toBe(expected);
  });
});
