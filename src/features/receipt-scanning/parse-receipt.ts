import { currencies } from '@/domain/money';
import { isCalendarDate } from '@/domain/spending';
import type { CalendarDate, CurrencyCode } from '@/domain/types';

import { GenericReceiptReviewDraftSchema, ReceiptDraftSchema, type GenericReceiptReviewDraft, type OcrBlock, type OcrResult, type ReceiptDraft, type ReceiptLineItemCandidate } from './receipt-types';

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
const excludedItemLabel = /\b(sub[ -]?total|total|tax|vat|iva|gst|tip|gorjeta|discount|desconto|change|troco|amount\s+(?:due|paid)|a\s+pagar|valor\s+(?:total|pago)|cash|card|multibanco|payment|pagamento)\b/i;

type AmountCandidate = { value: number; score: number; block: OcrBlock; confidence: number };

export function maxY(block: OcrBlock): number {
  return Math.max(...block.points.map((point) => point.y));
}

export function minY(block: OcrBlock): number {
  return Math.min(...block.points.map((point) => point.y));
}

export function minX(block: OcrBlock): number {
  return Math.min(...block.points.map((point) => point.x));
}

export function maxX(block: OcrBlock): number {
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

export function parseNonnegativeMinorAmount(text: string): number | undefined {
  const raw = [...text.matchAll(amountPattern)].at(-1)?.[0];
  if (!raw) return undefined;
  const separatorIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
  const major = raw.slice(0, separatorIndex).replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
  const value = Number(`${major}${raw.slice(separatorIndex + 1)}`);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseReceiptCurrency(blocks: OcrBlock[]): { value?: CurrencyCode; ambiguous: boolean } {
  const found = new Set<CurrencyCode>();
  for (const block of blocks) {
    if (/(?:€|\bEUR\b)/i.test(block.text)) found.add('EUR');
    if (/(?:\bUSD\b|US\$)/i.test(block.text)) found.add('USD');
    if (/(?:£|\bGBP\b)/i.test(block.text)) found.add('GBP');
    if (/\$/.test(block.text) && !/US\$/.test(block.text)) found.add('USD');
  }
  return { value: found.size === 1 ? [...found][0] : undefined, ambiguous: found.size > 1 };
}

export function parseReceiptDate(text: string, currency?: CurrencyCode): CalendarDate | undefined {
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
  const detectedCurrency = parseReceiptCurrency(blocks);
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
    .map((block) => ({ value: parseReceiptDate(block.text, detectedCurrency.value), score: block.confidence, block }))
    .filter((candidate): candidate is { value: CalendarDate; score: number; block: OcrBlock } => candidate.value !== undefined)
    .sort((left, right) => right.score - left.score);
  const date = dateCandidates[0];
  if (dateCandidates[1] && date && dateCandidates[1].value !== date.value && date.score - dateCandidates[1].score <= ambiguityWindow) warnings.push('Several dates were found; review the expense date.');

  const merchant = blocks
    .filter((block) => maxY(block) / result.height <= 0.36)
    .map((block) => ({ value: cleanMerchant(block.text), score: block.confidence + 0.08 * (1 - maxY(block) / result.height), block }))
    .filter((candidate) => candidate.value.length >= 2 && /\p{L}/u.test(candidate.value) && !totalLabel.test(candidate.value) && !parseReceiptDate(candidate.value, detectedCurrency.value) && parseMinorAmount(candidate.value) === undefined)
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
    lineItems: extractLineItems(blocks, result, total?.block),
    confidence: { merchant: merchant?.block.confidence, date: date?.block.confidence, total: total?.confidence },
    warnings,
  }) as ReceiptDraft;
}

export function minorToInput(amountMinor: number, currency: CurrencyCode): string {
  const digits = currencies[currency].minorDigits;
  return `${Math.floor(amountMinor / 10 ** digits)}.${String(amountMinor % 10 ** digits).padStart(digits, '0')}`;
}

export function buildReceiptExpensePrefill(result: OcrResult, groupCurrency: CurrencyCode, modelBundleVersion: string, profileVersion = 'generic-v1'): GenericReceiptReviewDraft {
  const receipt = parseReceipt(result, groupCurrency);
  const warnings = [...receipt.warnings];
  if (receipt.merchant && (receipt.confidence.merchant ?? 0) < merchantThreshold) warnings.push('Merchant confidence is low; review the description.');
  if (receipt.date && (receipt.confidence.date ?? 0) < dateThreshold) warnings.push('Date confidence is low; review the expense date.');
  if (receipt.totalMinor && (receipt.confidence.total ?? 0) < totalThreshold) warnings.push('Total confidence is low; enter the amount manually.');
  return GenericReceiptReviewDraftSchema.parse({
    profile: 'generic_v1',
    profileVersion,
    description: receipt.merchant && (receipt.confidence.merchant ?? 0) >= merchantThreshold ? receipt.merchant : undefined,
    amount: receipt.totalMinor && (receipt.confidence.total ?? 0) >= totalThreshold ? minorToInput(receipt.totalMinor, groupCurrency) : undefined,
    expenseDate: receipt.date && (receipt.confidence.date ?? 0) >= dateThreshold ? receipt.date : undefined,
    lineItems: receipt.lineItems?.map((item) => ({ description: item.description, quantity: item.quantity ?? '', unitPrice: item.unitPriceMinor === undefined ? '' : minorToInput(item.unitPriceMinor, groupCurrency), lineTotal: minorToInput(item.lineTotalMinor, groupCurrency) })),
    detectedCurrency: receipt.currency,
    confidence: receipt.confidence,
    warnings,
    modelBundleVersion,
  });
}

function extractLineItems(blocks: OcrBlock[], result: OcrResult, totalBlock?: OcrBlock): ReceiptLineItemCandidate[] | undefined {
  const body = blocks.filter((block) => {
    const center = (minY(block) + maxY(block)) / 2;
    const beforeSummary = totalBlock ? center < minY(totalBlock) : center < result.height * 0.82;
    return center > result.height * 0.12 && beforeSummary && !excludedItemLabel.test(block.text) && !parseReceiptDate(block.text);
  }).sort((left, right) => ((minY(left) + maxY(left)) / 2) - ((minY(right) + maxY(right)) / 2) || minX(left) - minX(right));
  const rows: OcrBlock[][] = [];
  for (const block of body) {
    const center = (minY(block) + maxY(block)) / 2;
    const height = Math.max(1, maxY(block) - minY(block));
    const row = rows.at(-1);
    const rowCenter = row ? row.reduce((sum, item) => sum + (minY(item) + maxY(item)) / 2, 0) / row.length : 0;
    const rowHeight = row ? Math.max(...row.map((item) => Math.max(1, maxY(item) - minY(item)))) : 0;
    if (row && Math.abs(center - rowCenter) <= Math.max(height, rowHeight) * 0.72) row.push(block);
    else rows.push([block]);
  }
  const items: ReceiptLineItemCandidate[] = [];
  for (const row of rows) {
    row.sort((left, right) => minX(left) - minX(right));
    const text = row.map((block) => block.text.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const amounts = [...text.matchAll(amountPattern)];
    const lastAmount = amounts.at(-1);
    const lineTotalMinor = parseNonnegativeMinorAmount(lastAmount?.[0] ?? '');
    if (!lastAmount || lineTotalMinor === undefined) continue;
    let prefix = text.slice(0, lastAmount.index).trim().replace(/[·:;-]+$/, '').trim();
    let quantity: string | undefined;
    let unitPriceMinor: number | undefined;
    const quantityPrice = /(?:^|\s)(\d+(?:[,.]\d+)?)\s*[xX@]\s*(\d+[,.]\d{2})(?:\s|$)/.exec(prefix);
    if (quantityPrice) {
      quantity = normalizeQuantity(quantityPrice[1]!);
      unitPriceMinor = parseNonnegativeMinorAmount(quantityPrice[2]!);
      prefix = `${prefix.slice(0, quantityPrice.index)} ${prefix.slice(quantityPrice.index + quantityPrice[0].length)}`.replace(/\s+/g, ' ').trim();
    } else if (amounts.length >= 2) {
      const possibleUnit = amounts.at(-2)!;
      const between = text.slice((possibleUnit.index ?? 0) + possibleUnit[0].length, lastAmount.index).trim();
      if (!between || /^[xX@]?$/.test(between)) {
        unitPriceMinor = parseNonnegativeMinorAmount(possibleUnit[0]);
        prefix = text.slice(0, possibleUnit.index).trim();
      }
    }
    const leadingQuantity = /^(\d+(?:[,.]\d+)?)\s*[xX]\s+/.exec(prefix);
    if (leadingQuantity) {
      quantity ??= normalizeQuantity(leadingQuantity[1]!);
      prefix = prefix.slice(leadingQuantity[0].length).trim();
    }
    const description = cleanMerchant(prefix);
    const confidence = Math.min(...row.map((block) => block.confidence));
    if (description.length < 2 || !/\p{L}/u.test(description) || excludedItemLabel.test(description) || confidence < 0.86 || items.length >= 80) continue;
    items.push({ description, ...(quantity ? { quantity } : {}), ...(unitPriceMinor === undefined ? {} : { unitPriceMinor }), lineTotalMinor, confidence });
  }
  return items.length ? items : undefined;
}

function normalizeQuantity(value: string): string | undefined {
  const normalized = value.replace(',', '.').replace(/^0+(?=\d)/, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  return /^\d+(?:\.\d+)?$/.test(normalized) && Number(normalized) > 0 ? normalized : undefined;
}
