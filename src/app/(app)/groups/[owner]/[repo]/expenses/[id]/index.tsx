import { useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from 'react-native';

import { Banner, Body, Button, Card, ConfirmDialog, EmptyState, Screen, Title } from '@/components/ui';
import { formatMoney } from '@/domain/money';
import { useGroup } from '@/providers/group-provider';
import { useTheme } from '@/providers/theme-provider';

export default function ExpenseDetailScreen() {
  const { owner, repo, id } = useLocalSearchParams<{ owner: string; repo: string; id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { state, deleteExpense, refresh } = useGroup();
  const [error, setError] = useState<string | null>(null);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const file = state.data?.expenses.find((item) => item.expense.id === id);
  if (!file) return <Screen><EmptyState title="Expense unavailable" body="It may have been deleted on another device." action={<Button onPress={() => void refresh().catch(() => undefined)}>Refresh group</Button>} /></Screen>;
  const expense = file.expense;
  const confirmDelete = async () => {
    setDeleting(true); setError(null);
    try { await deleteExpense(expense, file.blobSha); router.back(); }
    catch (cause) { setShowDelete(false); setError(cause instanceof Error ? cause.message : 'Unable to delete this expense.'); }
    finally { setDeleting(false); }
  };
  return <Screen>
    <Title eyebrow={state.data?.group.name}>Expense details</Title>
    <Card><Text style={{ color: colors.text, fontSize: 22, fontWeight: '800' }}>{expense.description}</Text><Text style={{ color: colors.text, fontSize: 28, fontWeight: '800' }}>{formatMoney(expense.amount_minor, expense.currency)}</Text><Body>Paid by @{expense.paid_by}</Body><Body muted>{expense.expense_date}</Body></Card>
    <Card><Body>{expense.split_type === 'equal' ? 'Equal split' : 'Full to one'}</Body>{Object.entries(expense.shares_minor).map(([login, share]) => <Body key={login}>@{login}: {formatMoney(share, expense.currency)}</Body>)}</Card>
    <Card><Body muted>Created by @{expense.created_by} on {new Date(expense.created_at).toLocaleString()}</Body>{expense.updated_at ? <Body muted>Updated by @{expense.updated_by} on {new Date(expense.updated_at).toLocaleString()}</Body> : null}<Body muted>Git blob {file.blobSha.slice(0, 10)}</Body></Card>
    {error ? <Banner tone="error" action={<Button variant="ghost" onPress={() => void refresh().catch(() => undefined)}>Review latest</Button>}>{error}</Banner> : null}
    <Button onPress={() => router.push({ pathname: '/groups/[owner]/[repo]/expenses/[id]/edit', params: { owner, repo, id } } as never)}>Edit expense</Button>
    <Button variant="danger" onPress={() => setShowDelete(true)}>Delete expense</Button>
    <ConfirmDialog visible={showDelete} title={`Delete “${expense.description}”?`} message={`${formatMoney(expense.amount_minor, expense.currency)} will be removed from balance calculations. Git history remains available.`} confirmLabel="Delete" loading={deleting} onCancel={() => setShowDelete(false)} onConfirm={() => void confirmDelete()} />
  </Screen>;
}
