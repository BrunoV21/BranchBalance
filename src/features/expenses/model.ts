import { DomainValidationError } from '@/domain/errors';
import { allocateEqual, allocateFull, parseAmountToMinor } from '@/domain/money';
import { calendarDateFromLocalDate, isCalendarDate } from '@/domain/spending';
import type { ExpenseCategory, PaymentMethod } from '@/domain/spending';
import type { Clock } from '@/features/auth/contracts';
import type { CalendarDate, CurrencyCode, Expense, Member, SplitType, WritableExpense } from '@/domain/types';

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
}

function validateDraft(draft: ExpenseDraft, currency: CurrencyCode, members: Member[]) {
  const description = draft.description.trim();
  if (!description || description.length > 120) throw new DomainValidationError('Description must be between 1 and 120 characters.', 'description');
  const accepted = new Set(members.map((member) => member.login.toLowerCase()));
  if (!draft.category) throw new DomainValidationError('Select an expense category.', 'category');
  if (!draft.paymentMethod) throw new DomainValidationError('Select a payment method.', 'paymentMethod');
  if (!accepted.has(draft.paidBy.toLowerCase())) throw new DomainValidationError('Select an accepted member as payer.', 'paidBy');
  if (!isCalendarDate(draft.expenseDate)) throw new DomainValidationError('Select a valid expense date.', 'expenseDate');
  const participants = draft.splitType === 'just_me' ? [draft.paidBy] : draft.participants;
  if (!participants.length || participants.some((login) => !accepted.has(login.toLowerCase()))) throw new DomainValidationError('Select accepted group members.', 'participants');
  const amountMinor = parseAmountToMinor(draft.amount, currency);
  const shares = draft.splitType === 'equal' || draft.splitType === 'just_me' ? allocateEqual(amountMinor, participants) : allocateFull(amountMinor, draft.paidBy, participants[0] ?? '');
  return { description, amountMinor, shares, participants: Object.keys(shares) };
}

export function buildNewExpense(draft: ExpenseDraft, id: string, currency: CurrencyCode, members: Member[], actor: string, clock: Clock): WritableExpense {
  const valid = validateDraft(draft, currency, members);
  return {
    schema_version: 1, id: id.toLowerCase(), description: valid.description, amount_minor: valid.amountMinor,
    currency, category: draft.category!, payment_method: draft.paymentMethod!, paid_by: draft.paidBy,
    split_type: draft.splitType === 'just_me' ? 'equal' : draft.splitType, participants: valid.participants,
    shares_minor: valid.shares, expense_date: draft.expenseDate, created_by: actor,
    created_at: clock.now().toISOString(), updated_by: null, updated_at: null,
  };
}

export function buildUpdatedExpense(original: Expense, draft: ExpenseDraft, members: Member[], actor: string, clock: Clock): WritableExpense {
  const valid = validateDraft(draft, original.currency, members);
  return {
    ...original, description: valid.description, amount_minor: valid.amountMinor, category: draft.category!, payment_method: draft.paymentMethod!, paid_by: draft.paidBy,
    split_type: draft.splitType === 'just_me' ? 'equal' : draft.splitType, participants: valid.participants, shares_minor: valid.shares,
    expense_date: draft.expenseDate, updated_by: actor, updated_at: clock.now().toISOString(),
  };
}

export function localCalendarDate(date = new Date()): CalendarDate {
  return calendarDateFromLocalDate(date);
}

export function applyJustMe(draft: ExpenseDraft, payer: string): ExpenseDraft {
  return { ...draft, paidBy: payer, splitType: 'just_me', participants: [payer] };
}
