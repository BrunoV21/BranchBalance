import { OcrResultSchema } from './receipt-types';

describe('OCR boundary schema', () => {
  it('accepts a bounded native result', () => {
    expect(OcrResultSchema.safeParse({ width: 100, height: 200, blocks: [{ text: 'TOTAL 4,20', confidence: 0.98, points: [{ x: 0, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 30 }, { x: 0, y: 30 }] }] }).success).toBe(true);
  });

  it('rejects oversized text and coordinates outside the image contract', () => {
    expect(OcrResultSchema.safeParse({ width: 100, height: 200, blocks: [{ text: 'x'.repeat(257), confidence: 0.98, points: [{ x: -20, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 30 }, { x: 0, y: 30 }] }] }).success).toBe(false);
  });
});
