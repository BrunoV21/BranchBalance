import { useRef } from 'react';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';

import { Banner, Screen } from '@/components/ui';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { buildNewExpense } from '@/features/expenses/model';
import { systemClock } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';

export default function NewExpenseScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { state, createExpense } = useGroup();
  const id = useRef<string | null>(null);
  const snapshot = state.data;
  if (!snapshot || !session.account) return <Screen><Banner>Refresh the group before adding an expense.</Banner></Screen>;
  return <Screen><ExpenseForm currency={snapshot.group.currency} members={snapshot.members} submitLabel="Add expense" onSubmit={async (draft) => {
    id.current ??= Crypto.randomUUID();
    const expense = buildNewExpense(draft, id.current, snapshot.group.currency, snapshot.members, session.account!.login, systemClock);
    await createExpense(expense);
    router.back();
  }} /></Screen>;
}
