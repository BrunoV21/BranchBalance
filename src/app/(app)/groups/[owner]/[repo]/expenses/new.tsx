import { useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';

import { Banner, Screen } from '@/components/ui';
import { effectiveGroupType } from '@/domain/groups';
import type { Member } from '@/domain/types';
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
  const snapshot = state.data;
  const groupType = snapshot ? effectiveGroupType(snapshot.group) : null;
  const [receiptPrefill] = useState(() => snapshot && groupType && session.account ? consumeReceiptDraft({ accountId: session.account.id, groupKey: snapshot.key, groupType }) : null);
  const id = useRef<string | null>(null);
  if (!snapshot || !session.account || !groupType) return <Screen><Banner>Refresh the group before adding an expense.</Banner></Screen>;
  const members = currentUserFirst(snapshot.members, session.account.login);
  const initial: ExpenseDraft | undefined = receiptPrefill ? { description: receiptPrefill.description ?? '', amount: receiptPrefill.amount ?? '', category: groupType === 'fuel' ? 'transport' : null, paymentMethod: null, paidBy: members[0]?.login ?? '', splitType: 'equal', participants: members.map((member) => member.login), expenseDate: receiptPrefill.expenseDate ?? localCalendarDate(), lineItems: receiptPrefill.profile === 'generic_v1' ? receiptPrefill.lineItems : undefined, fuelDetails: receiptPrefill.profile === 'fuel_v1' ? { litres: receiptPrefill.litres ?? '', unitPrice: receiptPrefill.unitPrice ?? '', gross: receiptPrefill.gross ?? '', discount: receiptPrefill.discount ?? '', fuelType: receiptPrefill.fuelType ?? null } : undefined } : undefined;
  return <Screen><ExpenseForm groupType={groupType} currency={snapshot.group.currency} members={members} initial={initial} receiptPrefill={receiptPrefill} onRetakeReceipt={() => router.replace({ pathname: '/groups/[owner]/[repo]/expenses/scan', params: { owner: snapshot.repository.owner, repo: snapshot.repository.name } } as never)} submitLabel="Add expense" onSubmit={async (draft) => {
    id.current ??= Crypto.randomUUID();
    const expense = buildNewExpense(draft, id.current, snapshot.group.currency, snapshot.members, session.account!.login, systemClock, groupType);
    await createExpense(expense);
    router.back();
  }} /></Screen>;
}

function currentUserFirst(members: Member[], currentLogin: string): Member[] {
  const index = members.findIndex((member) => member.login.toLowerCase() === currentLogin.toLowerCase());
  if (index <= 0) return members;
  return [members[index]!, ...members.slice(0, index), ...members.slice(index + 1)];
}
