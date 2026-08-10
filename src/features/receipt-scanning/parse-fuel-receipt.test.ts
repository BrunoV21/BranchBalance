import { buildFuelReceiptExpensePrefill } from './parse-fuel-receipt';
import type { OcrBlock, OcrResult } from './receipt-types';

const block = (text: string, y: number, confidence = 0.98): OcrBlock => ({ text, confidence, points: [{ x: 20, y }, { x: 900, y }, { x: 900, y: y + 45 }, { x: 20, y: y + 45 }] });
const result = (blocks: OcrBlock[]): OcrResult => ({ width: 1000, height: 1600, blocks });

describe('Fuel receipt parser', () => {
  it('keeps paid, gross, discount, litres, and pump price distinct', () => {
    const parsed = buildFuelReceiptExpensePrefill(result([
      block('PINGO DOCE', 50), block('10/08/2026 12:14', 180), block('DIESEL', 500),
      block('LITROS 24,500', 900), block('PRECO/L EUR 1,633', 960),
      block('TOTAL EUR 40,01', 1180), block('DESCONTO EUR 4,00', 1240), block('AMOUNT PAID EUR 36,01', 1320),
    ]), 'EUR', 'bundle', 'fuel-profile');

    expect(parsed).toMatchObject({ profile: 'fuel_v1', description: 'PINGO DOCE', expenseDate: '2026-08-10', receiptDateTime: '2026-08-10T12:14', amount: '36.01', gross: '40.01', discount: '4.00', litres: '24.5', unitPrice: '1.633', fuelType: 'diesel' });
    expect(parsed.warnings).not.toEqual(expect.arrayContaining([expect.stringMatching(/does not equal|do not match/i)]));
  });

  it('preserves an explicit zero discount', () => {
    const parsed = buildFuelReceiptExpensePrefill(result([block('FUEL STATION', 50), block('TOTAL EUR 40,01', 1100), block('DISCOUNT EUR 0,00', 1200), block('AMOUNT PAID EUR 40,01', 1300)]), 'EUR', 'bundle', 'fuel-profile');
    expect(parsed.discount).toBe('0.00');
    expect(parsed.amount).toBe('40.01');
  });

  it('leaves paid amount blank after failed discount arithmetic', () => {
    const parsed = buildFuelReceiptExpensePrefill(result([block('FUEL STATION', 50), block('TOTAL EUR 40,01', 1100), block('DISCOUNT EUR 2,00', 1200), block('AMOUNT PAID EUR 36,01', 1300)]), 'EUR', 'bundle', 'fuel-profile');
    expect(parsed.amount).toBeUndefined();
    expect(parsed.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/does not equal/i)]));
  });
});
