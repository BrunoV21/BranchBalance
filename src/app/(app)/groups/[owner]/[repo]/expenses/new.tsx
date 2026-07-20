import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';

import { Banner, Screen } from '@/components/ui';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { buildNewExpense } from '@/features/expenses/model';
import { localCalendarDate, type ExpenseDraft } from '@/features/expenses/model';
import { useReceiptDraft } from '@/features/receipt-scanning/receipt-draft-provider';
import { systemClock } from '@/infrastructure/runtime';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';

export default function NewExpenseScreen() {
  const router = useRouter();
  const { session } = useSession();
  const { state, createExpense } = useGroup();
  const { consumeReceiptDraft } = useReceiptDraft();
  const [receiptPrefill] = useState(() => consumeReceiptDraft());
  const id = useRef<string | null>(null);
  const snapshot = state.data;
  if (!snapshot || !session.account) return <Screen><Banner>Refresh the group before adding an expense.</Banner></Screen>;
  const initial: ExpenseDraft | undefined = receiptPrefill ? { description: receiptPrefill.description ?? '', amount: receiptPrefill.amount ?? '', category: null, paymentMethod: null, paidBy: snapshot.members[0]?.login ?? '', splitType: 'equal', participants: snapshot.members.map((member) => member.login), expenseDate: receiptPrefill.expenseDate ?? localCalendarDate() } : undefined;
  return <Screen><ExpenseForm currency={snapshot.group.currency} members={snapshot.members} initial={initial} receiptPrefill={receiptPrefill} onRetakeReceipt={() => router.replace({ pathname: '/groups/[owner]/[repo]/expenses/scan', params: { owner: snapshot.repository.owner, repo: snapshot.repository.name } } as never)} submitLabel="Add expense" onSubmit={async (draft) => {
    id.current ??= Crypto.randomUUID();
    const expense = buildNewExpense(draft, id.current, snapshot.group.currency, snapshot.members, session.account!.login, systemClock);
    await createExpense(expense);
    router.back();
  }} /></Screen>;
}
