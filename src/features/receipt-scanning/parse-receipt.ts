import { currencies } from '@/domain/money';
import { isCalendarDate } from '@/domain/spending';
import type { CalendarDate, CurrencyCode } from '@/domain/types';

import { ReceiptDraftSchema, type OcrBlock, type OcrResult, type ReceiptDraft, type ReceiptExpensePrefill } from './receipt-types';

const merchantThreshold = 0.88;
const dateThreshold = 0.90;
const totalThreshold = 0.92;
const ambiguityWindow = 0.10;
const totalLabel = /\b(total|amount\s+due|a\s+pagar|valor\s+total|montante)\b/i;
const excludedTotalLabel = /\b(subtotal|sub-total|tax|vat|iva|gst|tip|gorjeta|troco|change)\b/i;
const taxLabel = /\b(tax|vat|iva|gst)\b/i;
const tipLabel = /\b(tip|gorjeta)\b/i;
const subtotalLabel = /\b(subtotal|sub-total)\b/i;
const amountPattern = /(?:\d{1,3}(?:[ .,'’]\d{3})+|\d+)(?:[,.]\d{2})/g;

type AmountCandidate = { value: number; score: number; block: OcrBlock; confidence: number };

function maxY(block: OcrBlock): number {
  return Math.max(...block.points.map((point) => point.y));
}

function minY(block: OcrBlock): number {
  return Math.min(...block.points.map((point) => point.y));
}

function minX(block: OcrBlock): number {
  return Math.min(...block.points.map((point) => point.x));
}

function maxX(block: OcrBlock): number {
  return Math.max(...block.points.map((point) => point.x));
}

function amountForLabel(label: OcrBlock, blocks: OcrBlock[]): { value: number; block: OcrBlock; confidence: number } | undefined {
  const inline = parseMinorAmount(label.text);
  if (inline !== undefined) return { value: inline, block: label, confidence: label.confidence };
  const labelHeight = Math.max(1, maxY(label) - minY(label));
  const labelCenterY = (minY(label) + maxY(label)) / 2;
  return blocks
    .filter((block) => block !== label && !totalLabel.test(block.text) && !subtotalLabel.test(block.text) && !taxLabel.test(block.text) && !tipLabel.test(block.text))
    .map((block) => {
      const value = parseMinorAmount(block.text);
      const blockHeight = Math.max(1, maxY(block) - minY(block));
      const centerDifference = Math.abs((minY(block) + maxY(block)) / 2 - labelCenterY);
      const sameLine = centerDifference <= Math.max(labelHeight, blockHeight) * 0.9;
      const immediatelyBelow = minY(block) >= minY(label) && minY(block) - maxY(label) <= Math.max(labelHeight, blockHeight) * 1.4;
      const horizontalGap = Math.max(0, minX(block) - maxX(label));
      return { value, block, sameLine, immediatelyBelow, horizontalGap, confidence: Math.min(label.confidence, block.confidence) };
    })
    .filter((candidate): candidate is { value: number; block: OcrBlock; sameLine: boolean; immediatelyBelow: boolean; horizontalGap: number; confidence: number } => candidate.value !== undefined && (candidate.sameLine || candidate.immediatelyBelow))
    .sort((left, right) => Number(right.sameLine) - Number(left.sameLine) || left.horizontalGap - right.horizontalGap || right.confidence - left.confidence)[0];
}

export function parseMinorAmount(text: string): number | undefined {
  const matches = [...text.matchAll(amountPattern)];
  const raw = matches.at(-1)?.[0];
  if (!raw) return undefined;
  const separatorIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
  const major = raw.slice(0, separatorIndex).replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
  const fraction = raw.slice(separatorIndex + 1);
  const value = Number(`${major}${fraction}`);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function parseCurrency(blocks: OcrBlock[]): { value?: CurrencyCode; mismatch: boolean; ambiguous: boolean } {
  const found = new Set<CurrencyCode>();
  for (const block of blocks) {
    if (/(?:€|\bEUR\b)/i.test(block.text)) found.add('EUR');
    if (/(?:\bUSD\b|US\$)/i.test(block.text)) found.add('USD');
    if (/(?:£|\bGBP\b)/i.test(block.text)) found.add('GBP');
    if (/\$/.test(block.text) && !/US\$/.test(block.text)) found.add('USD');
  }
  return { value: found.size === 1 ? [...found][0] : undefined, mismatch: false, ambiguous: found.size > 1 };
}

function parseDate(text: string, currency?: CurrencyCode): CalendarDate | undefined {
  const iso = /\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/.exec(text);
  if (iso) {
    const value = `${iso[1]}-${iso[2]!.padStart(2, '0')}-${iso[3]!.padStart(2, '0')}`;
    if (isCalendarDate(value)) return value;
  }
  const local = /\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|[12]\d|3[01])[-/.](20\d{2}|\d{2})\b/.exec(text);
  if (!local) return undefined;
  const year = local[3]!.length === 2 ? `20${local[3]}` : local[3]!;
  const first = Number(local[1]);
  const second = Number(local[2]);
  const order = first > 12 ? 'dmy' : second > 12 ? 'mdy' : currency === 'USD' ? 'mdy' : currency === 'EUR' || currency === 'GBP' ? 'dmy' : null;
  if (!order) return undefined;
  const month = order === 'dmy' ? local[2]! : local[1]!;
  const day = order === 'dmy' ? local[1]! : local[2]!;
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isCalendarDate(value) ? value : undefined;
}

function bestLabeledAmount(blocks: OcrBlock[], pattern: RegExp, imageHeight: number, exclude?: RegExp): AmountCandidate | undefined {
  return blocks
    .filter((block) => pattern.test(block.text) && !exclude?.test(block.text))
    .map((label) => {
      const amount = amountForLabel(label, blocks);
      return amount ? { ...amount, score: amount.confidence + 0.08 * Math.min(1, maxY(label) / imageHeight) } : undefined;
    })
    .filter((candidate): candidate is AmountCandidate => candidate !== undefined)
    .sort((left, right) => right.score - left.score)[0];
}

function cleanMerchant(text: string): string {
  return text.replace(/[^\p{L}\p{N}&' .-]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function parseReceipt(result: OcrResult, groupCurrency: CurrencyCode): ReceiptDraft {
  const blocks = [...result.blocks].sort((left, right) => maxY(left) - maxY(right));
  const warnings: string[] = [];
  const detectedCurrency = parseCurrency(blocks);
  if (detectedCurrency.ambiguous) warnings.push('Several currencies were detected; review the amount.');
  const currencyMismatch = Boolean(detectedCurrency.value && detectedCurrency.value !== groupCurrency);
  if (currencyMismatch) warnings.push(`Receipt currency ${detectedCurrency.value} does not match this ${groupCurrency} group.`);
  if (!detectedCurrency.value && !detectedCurrency.ambiguous) warnings.push(`No currency was detected; ${groupCurrency} is assumed.`);

  const totalCandidates = blocks
    .filter((block) => totalLabel.test(block.text) && !excludedTotalLabel.test(block.text))
    .map((label) => {
      const amount = amountForLabel(label, blocks);
      return amount ? { ...amount, score: amount.confidence + 0.08 * Math.min(1, maxY(label) / result.height) } : undefined;
    })
    .filter((candidate): candidate is AmountCandidate => candidate !== undefined)
    .sort((left, right) => right.score - left.score);
  const total = totalCandidates[0];
  const competingTotal = totalCandidates.find((candidate, index) => index > 0 && candidate.value !== total?.value && total && total.score - candidate.score <= ambiguityWindow);
  if (competingTotal) warnings.push('Several possible totals were found; enter the amount manually.');

  const dateCandidates = blocks
    .map((block) => ({ value: parseDate(block.text, detectedCurrency.value), score: block.confidence, block }))
    .filter((candidate): candidate is { value: CalendarDate; score: number; block: OcrBlock } => candidate.value !== undefined)
    .sort((left, right) => right.score - left.score);
  const date = dateCandidates[0];
  if (dateCandidates[1] && date && dateCandidates[1].value !== date.value && date.score - dateCandidates[1].score <= ambiguityWindow) warnings.push('Several dates were found; review the expense date.');

  const merchant = blocks
    .filter((block) => maxY(block) / result.height <= 0.36)
    .map((block) => ({ value: cleanMerchant(block.text), score: block.confidence + 0.08 * (1 - maxY(block) / result.height), block }))
    .filter((candidate) => candidate.value.length >= 2 && /\p{L}/u.test(candidate.value) && !totalLabel.test(candidate.value) && !parseDate(candidate.value, detectedCurrency.value) && parseMinorAmount(candidate.value) === undefined)
    .sort((left, right) => right.score - left.score)[0];

  const subtotal = bestLabeledAmount(blocks, subtotalLabel, result.height);
  const tax = bestLabeledAmount(blocks, taxLabel, result.height);
  const tip = bestLabeledAmount(blocks, tipLabel, result.height);
  let arithmeticInconsistent = false;
  if (total && subtotal) {
    const calculated = subtotal.value + (tax?.value ?? 0) + (tip?.value ?? 0);
    arithmeticInconsistent = Math.abs(calculated - total.value) > 2;
    if (arithmeticInconsistent) warnings.push('The subtotal, tax, tip, and total do not add up; enter the amount manually.');
  }
  if (!total) warnings.push('No reliable total was found; enter the amount manually.');

  return ReceiptDraftSchema.parse({
    merchant: merchant?.value,
    date: date?.value,
    currency: detectedCurrency.value,
    subtotalMinor: subtotal?.value,
    taxMinor: tax?.value,
    tipMinor: tip?.value,
    totalMinor: currencyMismatch || detectedCurrency.ambiguous || competingTotal || arithmeticInconsistent ? undefined : total?.value,
    confidence: { merchant: merchant?.block.confidence, date: date?.block.confidence, total: total?.confidence },
    warnings,
  }) as ReceiptDraft;
}

function minorToInput(amountMinor: number, currency: CurrencyCode): string {
  const digits = currencies[currency].minorDigits;
  return `${Math.floor(amountMinor / 10 ** digits)}.${String(amountMinor % 10 ** digits).padStart(digits, '0')}`;
}

export function buildReceiptExpensePrefill(result: OcrResult, groupCurrency: CurrencyCode, modelBundleVersion: string): ReceiptExpensePrefill {
  const receipt = parseReceipt(result, groupCurrency);
  const warnings = [...receipt.warnings];
  if (receipt.merchant && (receipt.confidence.merchant ?? 0) < merchantThreshold) warnings.push('Merchant confidence is low; review the description.');
  if (receipt.date && (receipt.confidence.date ?? 0) < dateThreshold) warnings.push('Date confidence is low; review the expense date.');
  if (receipt.totalMinor && (receipt.confidence.total ?? 0) < totalThreshold) warnings.push('Total confidence is low; enter the amount manually.');
  return {
    description: receipt.merchant && (receipt.confidence.merchant ?? 0) >= merchantThreshold ? receipt.merchant : undefined,
    amount: receipt.totalMinor && (receipt.confidence.total ?? 0) >= totalThreshold ? minorToInput(receipt.totalMinor, groupCurrency) : undefined,
    expenseDate: receipt.date && (receipt.confidence.date ?? 0) >= dateThreshold ? receipt.date : undefined,
    detectedCurrency: receipt.currency,
    confidence: receipt.confidence,
    warnings,
    modelBundleVersion,
  };
}
