import { DomainValidationError } from '@/domain/errors';
import { allocateEqual, allocateFull, currencies, parseAmountToMinor } from '@/domain/money';
import { validateFuelTypeData } from '@/domain/schemas';
import { calendarDateFromLocalDate, isCalendarDate } from '@/domain/spending';
import type { ExpenseCategory, PaymentMethod } from '@/domain/spending';
import type { Clock } from '@/features/auth/contracts';
import type { CalendarDate, CurrencyCode, Expense, ExpenseLineItem, FuelExpenseDataV1, FuelType, KnownGroupType, Member, SplitType, WritableExpense } from '@/domain/types';

export type ExpenseSplitMode = SplitType | 'just_me';

export interface ExpenseDraft {
  description: string;
  amount: string;
  category: ExpenseCategory | null;
  paymentMethod: PaymentMethod | null;
  paidBy: string;
  splitType: ExpenseSplitMode;
  participants: string[];
  expenseDate: CalendarDate;
  lineItems?: ExpenseLineItemDraft[] | null;
  fuelDetails?: FuelExpenseDraft | null;
}

export interface ExpenseLineItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface FuelExpenseDraft {
  litres: string;
  unitPrice: string;
  gross: string;
  discount: string;
  fuelType: FuelType | null;
  receiptDateTime?: string;
}

function validateDraft(draft: ExpenseDraft, currency: CurrencyCode, members: Member[], groupType: KnownGroupType = 'trip') {
  const description = draft.description.trim();
  if (!description || description.length > 120) throw new DomainValidationError('Description must be between 1 and 120 characters.', 'description');
  const accepted = new Set(members.map((member) => member.login.toLowerCase()));
  if (groupType === 'trip' && !draft.category) throw new DomainValidationError('Select an expense category.', 'category');
  if (!draft.paymentMethod) throw new DomainValidationError('Select a payment method.', 'paymentMethod');
  if (!accepted.has(draft.paidBy.toLowerCase())) throw new DomainValidationError('Select an accepted member as payer.', 'paidBy');
  if (!isCalendarDate(draft.expenseDate)) throw new DomainValidationError('Select a valid expense date.', 'expenseDate');
  const participants = draft.splitType === 'just_me' ? [draft.paidBy] : draft.participants;
  if (!participants.length || participants.some((login) => !accepted.has(login.toLowerCase()))) throw new DomainValidationError('Select accepted group members.', 'participants');
  const amountMinor = parseAmountToMinor(draft.amount, currency);
  const shares = draft.splitType === 'equal' || draft.splitType === 'just_me' ? allocateEqual(amountMinor, participants) : allocateFull(amountMinor, draft.paidBy, participants[0] ?? '');
  return { description, amountMinor, shares, participants: Object.keys(shares) };
}

export function buildNewExpense(draft: ExpenseDraft, id: string, currency: CurrencyCode, members: Member[], actor: string, clock: Clock, groupType: KnownGroupType = 'trip'): WritableExpense {
  const valid = validateDraft(draft, currency, members, groupType);
  const enrichment = buildEnrichment(draft, currency, valid.amountMinor, groupType);
  return {
    schema_version: 1, id: id.toLowerCase(), description: valid.description, amount_minor: valid.amountMinor,
    currency, category: groupType === 'fuel' ? 'transport' : draft.category!, payment_method: draft.paymentMethod!, paid_by: draft.paidBy,
    split_type: draft.splitType === 'just_me' ? 'equal' : draft.splitType, participants: valid.participants,
    shares_minor: valid.shares, expense_date: draft.expenseDate, created_by: actor,
    created_at: clock.now().toISOString(), updated_by: null, updated_at: null, ...enrichment,
  };
}

export function buildUpdatedExpense(original: Expense, draft: ExpenseDraft, members: Member[], actor: string, clock: Clock, groupType: KnownGroupType = 'trip'): WritableExpense {
  const valid = validateDraft(draft, original.currency, members, groupType);
  const enrichment = buildEnrichment(draft, original.currency, valid.amountMinor, groupType, original);
  return {
    ...withoutEnrichment(original), ...enrichment, description: valid.description, amount_minor: valid.amountMinor, category: groupType === 'fuel' ? 'transport' : draft.category!, payment_method: draft.paymentMethod!, paid_by: draft.paidBy,
    split_type: draft.splitType === 'just_me' ? 'equal' : draft.splitType, participants: valid.participants, shares_minor: valid.shares,
    expense_date: draft.expenseDate, updated_by: actor, updated_at: clock.now().toISOString(),
  };
}

function buildEnrichment(draft: ExpenseDraft, currency: CurrencyCode, amountMinor: number, groupType: KnownGroupType, original?: Expense): Pick<WritableExpense, 'line_items' | 'type_data'> {
  if (groupType === 'trip') {
    const lineItems = draft.lineItems === undefined ? original?.line_items : draft.lineItems ? buildLineItems(draft.lineItems, currency) : undefined;
    return lineItems?.length ? { line_items: lineItems } : {};
  }
  const source = draft.fuelDetails === undefined ? fuelDraftFromData(original?.type_data, currency) : draft.fuelDetails;
  const typeData = source ? buildFuelTypeData(source, currency, amountMinor) : undefined;
  return typeData ? { type_data: typeData } : {};
}

export function buildLineItems(rows: readonly ExpenseLineItemDraft[], currency: CurrencyCode): ExpenseLineItem[] {
  if (rows.length > 80) throw new DomainValidationError('A receipt can contain at most 80 line items.', 'lineItems');
  return rows.map((row, index) => {
    const description = row.description.trim();
    if (!description || description.length > 120) throw new DomainValidationError(`Line item ${index + 1} needs a description of at most 120 characters.`, 'lineItems');
    const quantity = row.quantity.trim() ? normalizePositiveDecimal(row.quantity, `Line item ${index + 1} quantity`) : undefined;
    const unitPrice = row.unitPrice.trim() ? parseNonnegativeMinor(row.unitPrice, currency, `Line item ${index + 1} unit price`) : undefined;
    const lineTotal = parseNonnegativeMinor(row.lineTotal, currency, `Line item ${index + 1} total`);
    return { description, ...(quantity ? { quantity } : {}), ...(unitPrice === undefined ? {} : { unit_price_minor: unitPrice }), line_total_minor: lineTotal };
  });
}

export function buildFuelTypeData(draft: FuelExpenseDraft, currency: CurrencyCode, amountMinor: number): FuelExpenseDataV1 | undefined {
  const hasDetails = [draft.litres, draft.unitPrice, draft.gross, draft.discount].some((value) => value.trim()) || draft.fuelType !== null || Boolean(draft.receiptDateTime);
  if (!hasDetails) return undefined;
  if (!draft.litres.trim()) throw new DomainValidationError('Enter litres or clear all optional Fuel details.', 'litres');
  const data: FuelExpenseDataV1 = {
    schema_version: 1,
    type: 'fuel',
    volume_millilitres: parseScaledPositiveDecimal(draft.litres, 3, 'Litres'),
    ...(draft.receiptDateTime ? { receipt_datetime: validateReceiptDateTime(draft.receiptDateTime) } : {}),
    ...(draft.unitPrice.trim() ? { unit_price_micros_per_litre: parseScaledPositiveDecimal(draft.unitPrice, 6, 'Printed price per litre') } : {}),
    ...(draft.gross.trim() ? { gross_amount_minor: parseAmountToMinor(draft.gross, currency) } : {}),
    ...(draft.discount.trim() ? { discount_minor: parseNonnegativeMinor(draft.discount, currency, 'Discount') } : {}),
    ...(draft.fuelType ? { fuel_type: draft.fuelType } : {}),
  };
  const error = validateFuelTypeData(data, amountMinor, currency);
  if (error) throw new DomainValidationError(error, error.startsWith('Litres') ? 'unitPrice' : error.startsWith('Pre-discount') ? 'gross' : 'discount');
  return data;
}

export function fuelDraftFromData(data: FuelExpenseDataV1 | undefined, currency: CurrencyCode): FuelExpenseDraft | null {
  if (!data) return null;
  return {
    litres: scaledIntegerForInput(data.volume_millilitres, 3),
    unitPrice: data.unit_price_micros_per_litre === undefined ? '' : scaledIntegerForInput(data.unit_price_micros_per_litre, 6),
    gross: data.gross_amount_minor === undefined ? '' : minorForInput(data.gross_amount_minor, currency),
    discount: data.discount_minor === undefined ? '' : minorForInput(data.discount_minor, currency),
    fuelType: data.fuel_type ?? null,
    ...(data.receipt_datetime ? { receiptDateTime: data.receipt_datetime } : {}),
  };
}

function validateReceiptDateTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new DomainValidationError('Receipt date and time must use YYYY-MM-DDTHH:mm.', 'receiptDateTime');
  if (!isCalendarDate(value.slice(0, 10))) throw new DomainValidationError('Receipt date and time must contain a real date.', 'receiptDateTime');
  return value;
}

export function lineItemDraftsFrom(items: readonly ExpenseLineItem[] | undefined, currency: CurrencyCode): ExpenseLineItemDraft[] | undefined {
  return items?.map((item) => ({ description: item.description, quantity: item.quantity ?? '', unitPrice: item.unit_price_minor === undefined ? '' : minorForInput(item.unit_price_minor, currency), lineTotal: minorForInput(item.line_total_minor, currency) }));
}

function withoutEnrichment(expense: Expense): Omit<Expense, 'line_items' | 'type_data'> {
  const { line_items: _lineItems, type_data: _typeData, ...common } = expense;
  return common;
}

function normalizePositiveDecimal(value: string, label: string): string {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new DomainValidationError(`${label} must be a positive decimal.`, 'lineItems');
  const [wholeRaw, fractionRaw = ''] = normalized.split('.');
  const whole = wholeRaw!.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  const canonical = fraction ? `${whole}.${fraction}` : whole;
  if (canonical === '0') throw new DomainValidationError(`${label} must be greater than zero.`, 'lineItems');
  return canonical;
}

function parseScaledPositiveDecimal(value: string, scale: number, label: string): number {
  const normalized = value.trim().replace(',', '.');
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match || (match[2]?.length ?? 0) > scale) throw new DomainValidationError(`${label} supports at most ${scale} decimal places.`, label === 'Litres' ? 'litres' : 'unitPrice');
  const digits = `${match[1]!.replace(/^0+(?=\d)/, '') || '0'}${(match[2] ?? '').padEnd(scale, '0')}`;
  const result = Number(digits);
  if (!Number.isSafeInteger(result) || result <= 0) throw new DomainValidationError(`${label} must be greater than zero.`, label === 'Litres' ? 'litres' : 'unitPrice');
  return result;
}

function parseNonnegativeMinor(value: string, currency: CurrencyCode, label: string): number {
  const normalized = value.trim().replace(',', '.');
  const digits = currencies[currency].minorDigits;
  const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${digits}}))?$`).exec(normalized);
  if (!match) throw new DomainValidationError(`${label} must be a valid non-negative ${currency} amount.`, 'lineItems');
  const result = Number(`${match[1]!.replace(/^0+(?=\d)/, '') || '0'}${(match[2] ?? '').padEnd(digits, '0')}`);
  if (!Number.isSafeInteger(result)) throw new DomainValidationError(`${label} exceeds the supported range.`, 'lineItems');
  return result;
}

function scaledIntegerForInput(value: number, scale: number): string {
  const base = 10 ** scale;
  const whole = Math.floor(value / base);
  const fraction = String(value % base).padStart(scale, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function minorForInput(value: number, currency: CurrencyCode): string {
  const digits = currencies[currency].minorDigits;
  const base = 10 ** digits;
  return `${Math.floor(value / base)}.${String(value % base).padStart(digits, '0')}`;
}

export function localCalendarDate(date = new Date()): CalendarDate {
  return calendarDateFromLocalDate(date);
}

export function applyJustMe(draft: ExpenseDraft, payer: string): ExpenseDraft {
  return { ...draft, paidBy: payer, splitType: 'just_me', participants: [payer] };
}
