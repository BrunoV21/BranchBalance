import { DomainValidationError } from '@/domain/errors';
import { allocateEqual, allocateFull, parseAmountToMinor } from '@/domain/money';
import type { Clock } from '@/features/auth/contracts';
import type { CurrencyCode, Expense, Member, SplitType } from '@/domain/types';

export interface ExpenseDraft {
  description: string;
  amount: string;
  paidBy: string;
  splitType: SplitType;
  participants: string[];
  expenseDate: string;
}

function validateDraft(draft: ExpenseDraft, currency: CurrencyCode, members: Member[]) {
  const description = draft.description.trim();
  if (!description || description.length > 120) throw new DomainValidationError('Description must be between 1 and 120 characters.', 'description');
  const accepted = new Set(members.map((member) => member.login.toLowerCase()));
  if (!accepted.has(draft.paidBy.toLowerCase())) throw new DomainValidationError('Select an accepted member as payer.', 'paidBy');
  const parsedDate = new Date(`${draft.expenseDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expenseDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== draft.expenseDate) throw new DomainValidationError('Select a valid expense date.', 'expenseDate');
  if (!draft.participants.length || draft.participants.some((login) => !accepted.has(login.toLowerCase()))) throw new DomainValidationError('Select accepted group members.', 'participants');
  const amountMinor = parseAmountToMinor(draft.amount, currency);
  const shares = draft.splitType === 'equal' ? allocateEqual(amountMinor, draft.participants) : allocateFull(amountMinor, draft.paidBy, draft.participants[0] ?? '');
  return { description, amountMinor, shares, participants: Object.keys(shares) };
}

export function buildNewExpense(draft: ExpenseDraft, id: string, currency: CurrencyCode, members: Member[], actor: string, clock: Clock): Expense {
  const valid = validateDraft(draft, currency, members);
  return {
    schema_version: 1, id: id.toLowerCase(), description: valid.description, amount_minor: valid.amountMinor,
    currency, paid_by: draft.paidBy, split_type: draft.splitType, participants: valid.participants,
    shares_minor: valid.shares, expense_date: draft.expenseDate, created_by: actor,
    created_at: clock.now().toISOString(), updated_by: null, updated_at: null,
  };
}

export function buildUpdatedExpense(original: Expense, draft: ExpenseDraft, members: Member[], actor: string, clock: Clock): Expense {
  const valid = validateDraft(draft, original.currency, members);
  return {
    ...original, description: valid.description, amount_minor: valid.amountMinor, paid_by: draft.paidBy,
    split_type: draft.splitType, participants: valid.participants, shares_minor: valid.shares,
    expense_date: draft.expenseDate, updated_by: actor, updated_at: clock.now().toISOString(),
  };
}

export function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
