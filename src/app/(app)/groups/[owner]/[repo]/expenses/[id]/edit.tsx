import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Banner, Body, Button, Card, EmptyState, Screen } from '@/components/ui';
import { AppFailure } from '@/domain/errors';
import { effectiveGroupType } from '@/domain/groups';
import { isJustMeExpense } from '@/domain/spending';
import type { ExpenseFile } from '@/domain/types';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { buildUpdatedExpense, fuelDraftFromData, lineItemDraftsFrom, type ExpenseDraft } from '@/features/expenses/model';
import { minorUnitsForInput } from '@/features/spending/model';
import { systemClock } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';

export default function EditExpenseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useSession();
  const { state, updateExpense } = useGroup();
  const [conflict, setConflict] = useState<{ latest: ExpenseFile; draft: ExpenseDraft } | null>(null);
  const file = state.data?.expenses.find((item) => item.expense.id === id);
  if (!file || !state.data || !session.account) return <Screen><EmptyState title="Expense unavailable" body="Return to the group and refresh before editing." /></Screen>;
  const groupType = effectiveGroupType(state.data.group);
  if (!groupType) return <Screen><Banner tone="warning">Update BranchBalance before editing this group type.</Banner></Screen>;
  const initial: ExpenseDraft = { description: file.expense.description, amount: minorUnitsForInput(file.expense.amount_minor, file.expense.currency), category: file.expense.category, paymentMethod: file.expense.payment_method, paidBy: file.expense.paid_by, splitType: isJustMeExpense(file.expense) ? 'just_me' : file.expense.split_type, participants: file.expense.participants, expenseDate: file.expense.expense_date, lineItems: groupType === 'trip' ? lineItemDraftsFrom(file.expense.line_items, file.expense.currency) : undefined, fuelDetails: groupType === 'fuel' ? fuelDraftFromData(file.expense.type_data, file.expense.currency) : undefined };
  const save = async (draft: ExpenseDraft, target = file) => {
    try {
      const expense = buildUpdatedExpense(target.expense, draft, state.data!.members, session.account!.login, systemClock, groupType);
      await updateExpense(expense, target);
      router.back();
    } catch (cause) {
      if (cause instanceof AppFailure && cause.detail.kind === 'expense_conflict' && cause.detail.latest) {
        setConflict({ latest: cause.detail.latest, draft });
        return;
      }
      throw cause;
    }
  };
  return <Screen>
    {conflict ? <Card><Banner tone="warning">This expense changed on GitHub. Your unsaved values are still preserved.</Banner><Body>Latest remote description: {conflict.latest.expense.description}</Body><Button onPress={() => void save(conflict.draft, conflict.latest)}>Reapply to latest version</Button><Button variant="secondary" onPress={() => router.back()}>Discard my changes</Button></Card> : <ExpenseForm groupType={groupType} initial={initial} currency={file.expense.currency} members={state.data.members} submitLabel="Save changes" onSubmit={save} />}
  </Screen>;
}
