import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { calculateBalances } from '@/domain/balances';
import { deriveSpendingSummary } from '@/domain/spending';
import type { Expense, RemoteGroupSnapshot } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import GroupOverviewScreen from '../../app/(app)/groups/[owner]/[repo]/(tabs)/index';

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: () => ({ owner: 'owner', repo: 'branch-balance-trip' }) }));
jest.mock('@/features/groups/use-group-refresh', () => ({ useGroupRefresh: () => jest.fn() }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));

const members = [{ login: 'owner', name: null, avatarUrl: null, role: 'owner' as const }];
const expense: Expense = {
  schema_version: 1, id: '11111111-1111-4111-8111-111111111111', description: 'Mega tips', amount_minor: 7000,
  currency: 'EUR', category: 'activities', payment_method: 'cash', paid_by: 'owner', split_type: 'equal',
  participants: ['owner'], shares_minor: { owner: 7000 }, expense_date: '2026-07-18', created_by: 'owner',
  created_at: '2026-07-18T12:00:00.000Z', updated_by: 'owner', updated_at: '2026-07-18T12:35:22.000Z',
};
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-17T12:00:00.000Z' };
const balances = calculateBalances([expense], members);
const snapshot: RemoteGroupSnapshot = {
  key: 'owner/branch-balance-trip', repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
  group, groupFile: { group, blobSha: 'group-sha', path: 'group.json', sourceDocument: { ...group } }, members, pendingMembers: [],
  expenses: [{ expense, blobSha: 'expense-sha', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } }],
  balances, settlements: [], spending: deriveSpendingSummary([expense], undefined, 'owner', '2026-07-18'), warnings: [], syncedAt: '2026-07-18T13:00:00.000Z',
};

describe('Group overview expense metadata', () => {
  it('uses a concise icon grid and leaves audit metadata to the detail screen', async () => {
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null } } as never);

    const view = await render(<ThemeProvider><GroupOverviewScreen /></ThemeProvider>);

    expect(view.getByLabelText('Category: Activities')).toBeTruthy();
    expect(view.getByLabelText('Payment method: Cash')).toBeTruthy();
    expect(view.getByLabelText('Paid by @owner; Just me expense')).toBeTruthy();
    expect(view.queryByLabelText('Created by @owner')).toBeNull();
    expect(view.queryByLabelText('Updated by @owner')).toBeNull();
    expect(view.getAllByTestId('lucide-icon').length).toBe(5);
    expect(view.queryByText(/Activities · Cash · paid by/)).toBeNull();
  });

  it('opens receipt scanning from the camera segment of the add-expense control', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null } } as never);
    const view = await render(<ThemeProvider><GroupOverviewScreen /></ThemeProvider>);

    await fireEvent.press(view.getByRole('button', { name: 'Scan receipt on this device' }));

    expect(push).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]/expenses/scan', params: { owner: 'owner', repo: 'branch-balance-trip' } });
  });

  it('summarizes active pace and opens the Spending analytics screen', async () => {
    const push = jest.fn();
    const spendingPlan = { budget_minor: 10_000, starts_on: '2026-07-17', ends_on: '2026-07-20', updated_by: 'owner', updated_at: '2026-07-17T12:00:00.000Z' } as const;
    const plannedGroup = { ...group, spending_plan: spendingPlan };
    const plannedSnapshot: RemoteGroupSnapshot = {
      ...snapshot,
      group: plannedGroup,
      groupFile: { ...snapshot.groupFile!, group: plannedGroup, sourceDocument: { ...plannedGroup } },
      spending: deriveSpendingSummary([expense], spendingPlan, 'owner', '2026-07-18'),
    };
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: plannedSnapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: plannedSnapshot.syncedAt, error: null } } as never);

    const view = await render(<ThemeProvider><GroupOverviewScreen /></ThemeProvider>);

    expect(view.getByText('€20.00 above even pace')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: /Open spending analytics.*€20.00 above even budget pace/i }));
    expect(push).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]/spending', params: { owner: 'owner', repo: 'branch-balance-trip' } });
  });
});
