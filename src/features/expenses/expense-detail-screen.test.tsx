import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { calculateBalances } from '@/domain/balances';
import { deriveSpendingSummary } from '@/domain/spending';
import type { Expense, RemoteGroupSnapshot } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import ExpenseDetailScreen from '../../app/(app)/groups/[owner]/[repo]/expenses/[id]/index';

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: () => ({ owner: 'owner', repo: 'branch-balance-trip', id: '11111111-1111-4111-8111-111111111111' }) }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));

const members = [{ login: 'owner', name: null, avatarUrl: null, role: 'owner' as const }];
const expense: Expense = {
  schema_version: 1, id: '11111111-1111-4111-8111-111111111111', description: 'Mega tips', amount_minor: 7000,
  currency: 'EUR', category: 'activities', payment_method: 'cash', paid_by: 'owner', split_type: 'equal',
  participants: ['owner'], shares_minor: { owner: 7000 }, expense_date: '2026-07-17', created_by: 'owner',
  created_at: '2026-07-17T20:42:01.000Z', updated_by: 'owner', updated_at: '2026-07-18T13:35:22.000Z',
};
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-17T12:00:00.000Z' };
const balances = calculateBalances([expense], members);
const snapshot: RemoteGroupSnapshot = {
  key: 'owner/branch-balance-trip', repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
  group, groupFile: { group, blobSha: 'group-sha', path: 'group.json', sourceDocument: { ...group } }, members, pendingMembers: [],
  expenses: [{ expense, blobSha: '7ef06cde4abc123', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } }],
  balances, settlements: [], spending: deriveSpendingSummary([expense], undefined, 'owner', '2026-07-18'), warnings: [], syncedAt: '2026-07-18T14:00:00.000Z',
};

describe('Expense detail screen', () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn(), back: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null }, deleteExpense: jest.fn(), refresh: jest.fn() } as never);
  });

  it('uses icon metadata and keeps repository history collapsed by default', async () => {
    const view = await render(<ThemeProvider><ExpenseDetailScreen /></ThemeProvider>);

    expect(view.getByLabelText('Category: Activities')).toBeTruthy();
    expect(view.getByLabelText('Payment method: Cash')).toBeTruthy();
    expect(view.getByLabelText('Paid by @owner')).toBeTruthy();
    expect(view.getByLabelText('Expense date 2026-07-17')).toBeTruthy();
    expect(view.getByLabelText('Share assigned to @owner')).toBeTruthy();
    expect(view.queryByText('Repository revision')).toBeNull();
    expect(view.queryByText(/Blob 7ef06cde4a/)).toBeNull();

    const activityLog = view.getByRole('button', { name: 'Activity log' });
    expect(activityLog.props.accessibilityState).toEqual({ expanded: false });
    await fireEvent.press(activityLog);

    expect(view.getByRole('button', { name: 'Activity log' }).props.accessibilityState).toEqual({ expanded: true });
    expect(view.getByText('Created')).toBeTruthy();
    expect(view.getByText('Updated')).toBeTruthy();
    expect(view.getByText('Repository revision')).toBeTruthy();
    expect(view.getByText('Blob 7ef06cde4a')).toBeTruthy();
  });
});
