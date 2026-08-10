import type { CurrencyCode, FuelType } from '@/domain/types';

import { FuelReceiptReviewDraftSchema, type FuelReceiptReviewDraft, type OcrBlock, type OcrResult } from './receipt-types';
import { maxX, maxY, minX, minY, minorToInput, parseNonnegativeMinorAmount, parseReceiptCurrency, parseReceiptDate } from './parse-receipt';

const paidLabel = /\b(amount\s+paid|total\s+paid|valor\s+pago|montante\s+pago|a\s+pagar|paid|pagou)\b/i;
const grossLabel = /\b(gross|bruto|pre[- ]?discount|antes\s+desconto|valor\s+total|total)\b/i;
const discountLabel = /\b(discount|desconto|poupan[cç]a|saving)\b/i;
const litreLabel = /\b(litres?|litros?|volume|qty|quantidade)\b|\bL\b/i;
const unitPriceLabel = /\b(price|pre[cç]o).*(?:litre|litro)|(?:€|EUR|USD|GBP)?\s*\/\s*[lL]\b|\bPPL\b/i;
const decimalPattern = /(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[,.]\d{1,6})/g;
const merchantNoise = /\b(receipt|recibo|invoice|fatura|posto|station|nif|tax|vat|iva|total|litres?|litros?|price|pre[cç]o)\b/i;
const threshold = 0.86;

type Candidate = { value: number; raw: string; confidence: number; y: number };

export function buildFuelReceiptExpensePrefill(result: OcrResult, groupCurrency: CurrencyCode, modelBundleVersion: string, profileVersion: string): FuelReceiptReviewDraft {
  const blocks = [...result.blocks].sort((left, right) => maxY(left) - maxY(right));
  const warnings: string[] = [];
  const currency = parseReceiptCurrency(blocks);
  if (currency.ambiguous) warnings.push('Several currencies were detected; Amount paid is blank.');
  const mismatch = Boolean(currency.value && currency.value !== groupCurrency);
  if (mismatch) warnings.push(`Receipt currency ${currency.value} does not match this ${groupCurrency} Fuel group.`);
  if (!currency.value && !currency.ambiguous) warnings.push(`No currency was detected; ${groupCurrency} is assumed for reviewed values.`);

  const paidCandidates = labeledMoneyCandidates(blocks, paidLabel, result.height);
  const paid = paidCandidates[0];
  const gross = labeledMoney(blocks.filter((block) => !paidLabel.test(block.text)), grossLabel, result.height);
  const discount = labeledMoney(blocks, discountLabel, result.height, true);
  const litres = labeledDecimal(blocks, litreLabel, 3);
  const unitPrice = labeledDecimal(blocks, unitPriceLabel, 6);
  const date = blocks.map((block) => ({ value: parseReceiptDate(block.text, currency.value), confidence: block.confidence })).filter((item): item is { value: string; confidence: number } => Boolean(item.value)).sort((left, right) => right.confidence - left.confidence)[0];
  const merchant = blocks.filter((block) => maxY(block) / result.height <= 0.34 && block.confidence >= 0.7)
    .map((block) => ({ value: clean(block.text), confidence: block.confidence, y: maxY(block) }))
    .filter((item) => item.value.length >= 2 && /\p{L}/u.test(item.value) && !merchantNoise.test(item.value) && !parseReceiptDate(item.value) && !/\d[,.]\d/.test(item.value))
    .sort((left, right) => right.confidence - left.confidence || left.y - right.y)[0];

  const paidMinor = paid?.value;
  const grossMinor = gross?.value;
  const discountMinor = discount?.value;
  let amountSafe = Boolean(paid && paid.confidence >= threshold && !mismatch && !currency.ambiguous);
  if (!paid) warnings.push('No reliable Amount paid was found; enter the amount manually.');
  if (paid && paidCandidates.some((candidate, index) => index > 0 && candidate.value !== paid.value && paid.confidence - candidate.confidence <= 0.10)) {
    amountSafe = false;
    warnings.push('Several possible paid totals were found; enter Amount paid manually.');
  }
  if (grossMinor !== undefined && discountMinor !== undefined && paidMinor !== undefined && grossMinor - discountMinor !== paidMinor) {
    amountSafe = false;
    warnings.push('Pre-discount total minus discount does not equal Amount paid; review all amount fields.');
  }
  if (grossMinor !== undefined && litres && unitPrice) {
    const expected = roundedPumpMinor(litres.value, unitPrice.value, groupCurrency);
    if (Math.abs(expected - grossMinor) > 2) warnings.push('Litres and printed price do not match the pre-discount total; review Fuel details.');
  }
  if (!litres) warnings.push('Litres were not reliably detected; volume and unit-price insights will be incomplete.');

  const fuelType = detectFuelType(blocks);
  return FuelReceiptReviewDraftSchema.parse({
    profile: 'fuel_v1', profileVersion,
    description: merchant && merchant.confidence >= threshold ? merchant.value : undefined,
    amount: amountSafe && paidMinor !== undefined ? minorToInput(paidMinor, groupCurrency) : undefined,
    expenseDate: date && date.confidence >= threshold ? date.value : undefined,
    litres: litres && litres.confidence >= threshold ? scaledInput(litres.value, 3) : undefined,
    unitPrice: unitPrice && unitPrice.confidence >= threshold ? scaledInput(unitPrice.value, 6) : undefined,
    gross: gross && gross.confidence >= threshold ? minorToInput(gross.value, groupCurrency) : undefined,
    discount: discount && discount.confidence >= threshold ? minorToInput(discount.value, groupCurrency) : undefined,
    fuelType,
    detectedCurrency: currency.value,
    confidence: { merchant: merchant?.confidence, date: date?.confidence, total: paid?.confidence, litres: litres?.confidence, unitPrice: unitPrice?.confidence, gross: gross?.confidence, discount: discount?.confidence },
    warnings, modelBundleVersion,
  });
}

function labeledMoney(blocks: OcrBlock[], pattern: RegExp, imageHeight: number, allowZero = false): Candidate | undefined {
  return labeledMoneyCandidates(blocks, pattern, imageHeight, allowZero)[0];
}

function labeledMoneyCandidates(blocks: OcrBlock[], pattern: RegExp, imageHeight: number, allowZero = false): Candidate[] {
  return blocks.filter((block) => pattern.test(block.text)).flatMap((label) => {
    const direct = lastMoney(label.text);
    if (direct && (allowZero || direct.value > 0)) return [{ ...direct, confidence: label.confidence, y: maxY(label) }];
    const labelCenter = (minY(label) + maxY(label)) / 2;
    const labelHeight = Math.max(1, maxY(label) - minY(label));
    const nearby = blocks.filter((block) => block !== label).flatMap((block) => {
      const amount = lastMoney(block.text);
      if (!amount || (!allowZero && amount.value === 0)) return [];
      const height = Math.max(1, maxY(block) - minY(block));
      const center = (minY(block) + maxY(block)) / 2;
      const sameLine = Math.abs(center - labelCenter) <= Math.max(labelHeight, height) * 0.9;
      const below = minY(block) >= minY(label) && minY(block) - maxY(label) <= Math.max(labelHeight, height) * 1.4;
      if (!sameLine && !below) return [];
      const horizontalPenalty = Math.max(0, minX(block) - maxX(label)) / 10_000;
      return [{ ...amount, confidence: Math.min(label.confidence, block.confidence) - horizontalPenalty, y: maxY(label) }];
    }).sort((left, right) => right.confidence - left.confidence);
    return nearby.slice(0, 1);
  }).sort((left, right) => (right.confidence + right.y / imageHeight * 0.06) - (left.confidence + left.y / imageHeight * 0.06));
}

function labeledDecimal(blocks: OcrBlock[], pattern: RegExp, scale: number): Candidate | undefined {
  return blocks.filter((block) => pattern.test(block.text)).flatMap((label) => {
    const candidates = [label, ...blocks.filter((block) => block !== label && Math.abs((minY(block) + maxY(block)) / 2 - (minY(label) + maxY(label)) / 2) <= Math.max(maxY(block) - minY(block), maxY(label) - minY(label), 1))];
    return candidates.map((block) => {
    const raws = [...block.text.matchAll(decimalPattern)].map((match) => match[0]);
    const raw = raws.at(-1);
    const value = raw ? parseScaled(raw, scale) : undefined;
      return value ? { value, raw: raw!, confidence: Math.min(label.confidence, block.confidence), y: maxY(label) } : undefined;
    });
  }).filter((item): item is Candidate => Boolean(item)).sort((left, right) => right.confidence - left.confidence)[0];
}

function lastMoney(text: string): { value: number; raw: string } | undefined {
  const raw = [...text.matchAll(/(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[,.]\d{2})/g)].at(-1)?.[0];
  const value = raw ? parseNonnegativeMinorAmount(raw) : undefined;
  return value === undefined ? undefined : { value, raw: raw! };
}

function parseScaled(raw: string, scale: number): number | undefined {
  const compact = raw.trim().replace(/\s/g, '');
  const separator = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
  if (separator < 0) return undefined;
  const whole = compact.slice(0, separator).replace(/\D/g, '') || '0';
  const fraction = compact.slice(separator + 1).replace(/\D/g, '');
  if (!fraction || fraction.length > scale) return undefined;
  const value = Number(`${whole}${fraction.padEnd(scale, '0')}`);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function scaledInput(value: number, scale: number): string {
  const raw = String(value).padStart(scale + 1, '0');
  return `${raw.slice(0, -scale)}.${raw.slice(-scale)}`.replace(/0+$/, '').replace(/\.$/, '');
}

function roundedPumpMinor(volumeMl: number, priceMicros: number, currency: CurrencyCode): number {
  const digits = groupCurrencyDigits(currency);
  return Number((BigInt(volumeMl) * BigInt(priceMicros) * BigInt(10 ** digits) + 500_000_000n) / 1_000_000_000n);
}

function groupCurrencyDigits(_currency: CurrencyCode): number { return 2; }

function detectFuelType(blocks: OcrBlock[]): FuelType | undefined {
  const text = blocks.map((block) => block.text).join(' ');
  if (/\b(diesel|gasoleo|gasóleo|gasoil)\b/i.test(text)) return 'diesel';
  if (/\b(petrol|gasolina|unleaded|sem\s+chumbo)\b/i.test(text)) return 'petrol';
  if (/\b(lpg|glp|autogas)\b/i.test(text)) return 'lpg';
  return undefined;
}

function clean(text: string): string {
  return text.replace(/[^\p{L}\p{N}&' .-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
