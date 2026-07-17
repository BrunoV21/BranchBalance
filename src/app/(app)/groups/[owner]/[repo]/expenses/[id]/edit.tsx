import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Banner, Body, Button, Card, EmptyState, Screen } from '@/components/ui';
import { AppFailure } from '@/domain/errors';
import type { ExpenseFile } from '@/domain/types';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { buildUpdatedExpense, type ExpenseDraft } from '@/features/expenses/model';
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
  const initial: ExpenseDraft = { description: file.expense.description, amount: (file.expense.amount_minor / 100).toFixed(2), paidBy: file.expense.paid_by, splitType: file.expense.split_type, participants: file.expense.participants, expenseDate: file.expense.expense_date };
  const save = async (draft: ExpenseDraft, target = file) => {
    try {
      const expense = buildUpdatedExpense(target.expense, draft, state.data!.members, session.account!.login, systemClock);
      await updateExpense(expense, target.blobSha);
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
    {conflict ? <Card><Banner tone="warning">This expense changed on GitHub. Your unsaved values are still preserved.</Banner><Body>Latest remote description: {conflict.latest.expense.description}</Body><Button onPress={() => void save(conflict.draft, conflict.latest)}>Reapply to latest version</Button><Button variant="secondary" onPress={() => router.back()}>Discard my changes</Button></Card> : <ExpenseForm initial={initial} currency={file.expense.currency} members={state.data.members} submitLabel="Save changes" onSubmit={save} />}
  </Screen>;
}
