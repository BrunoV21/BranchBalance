import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { calculateBalances } from '@/domain/balances';
import { deriveSpendingSummary } from '@/domain/spending';
import type { Expense, Group, RemoteGroupSnapshot } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import SpendingScreen from '../../app/(app)/groups/[owner]/[repo]/(tabs)/spending';

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: () => ({ owner: 'owner', repo: 'branch-balance-trip' }) }));
jest.mock('@/features/groups/use-group-refresh', () => ({ useGroupRefresh: () => jest.fn() }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));

const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const expenses: Expense[] = [
  { schema_version: 1, id: '11111111-1111-4111-8111-111111111111', description: 'Dinner', amount_minor: 1000, currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 }, expense_date: '2026-07-16', created_by: 'owner', created_at: '2026-07-16T12:00:00.000Z', updated_by: null, updated_at: null },
  { schema_version: 1, id: '22222222-2222-4222-8222-222222222222', description: 'Taxi', amount_minor: 300, currency: 'EUR', category: 'transport', payment_method: 'cash', paid_by: 'owner', split_type: 'equal', participants: ['owner'], shares_minor: { owner: 300 }, expense_date: '2026-07-16', created_by: 'owner', created_at: '2026-07-16T13:00:00.000Z', updated_by: null, updated_at: null },
  { schema_version: 1, id: '33333333-3333-4333-8333-333333333333', description: 'Legacy toll', amount_minor: 200, currency: 'EUR', category: null, payment_method: null, paid_by: 'friend', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 100, friend: 100 }, expense_date: '2026-07-15', created_by: 'friend', created_at: '2026-07-15T12:00:00.000Z', updated_by: null, updated_at: null },
];
const plan = { budget_minor: 2000, category_budgets_minor: { food_drink: 800 }, starts_on: '2026-07-14', ends_on: '2026-07-20', updated_by: 'owner', updated_at: '2026-07-13T12:00:00.000Z' } as const;
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, spending_plan: plan, created_by: 'owner', created_at: '2026-07-13T12:00:00.000Z' };
const balances = calculateBalances(expenses, members);
const snapshot: RemoteGroupSnapshot = {
  key: 'owner/branch-balance-trip', repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
  group, groupFile: { group, blobSha: 'group-sha', path: 'group.json', sourceDocument: { ...group } }, members, pendingMembers: [],
  expenses: expenses.map((expense) => ({ expense, blobSha: `${expense.id}-sha`, path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } })),
  balances, settlements: [], spending: deriveSpendingSummary(expenses, plan, 'owner', '2026-07-17'), warnings: [], syncedAt: '2026-07-17T12:00:00.000Z',
};

describe('Spending screen', () => {
  beforeEach(() => {
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null } } as never);
  });

  it('renders accessible full-snapshot budget, category, payment, and legacy summaries', async () => {
    const view = await render(<ThemeProvider><SpendingScreen /></ThemeProvider>);
    expect(view.getByText('€15.00')).toBeTruthy();
    expect(view.getAllByText('Uncategorized').length).toBeGreaterThan(0);
    expect(view.getAllByText(/Unspecified/).length).toBeGreaterThan(0);
    expect(view.getByLabelText(/75% of the total budget used/i)).toBeTruthy();
    expect(view.getByLabelText('Category: Food & drinks')).toBeTruthy();
    expect(view.getByLabelText('Payment method: Card')).toBeTruthy();
    expect(view.getAllByLabelText('Paid by @owner').length).toBeGreaterThan(0);
    expect(view.getAllByTestId('lucide-icon').length).toBeGreaterThan(20);
    expect(view.getByText('€2.00 over category limit')).toBeTruthy();
  });

  it('combines category and Just me filters without changing aggregate cards', async () => {
    const view = await render(<ThemeProvider><SpendingScreen /></ThemeProvider>);
    await fireEvent.press(view.getByRole('radio', { name: 'Transport' }));
    await fireEvent.press(view.getByRole('radio', { name: 'Just me' }));
    expect(view.getByText('Taxi')).toBeTruthy();
    expect(view.queryByText('Dinner')).toBeNull();
    expect(view.getByText('Group spent')).toBeTruthy();
    expect(view.getByText('1 expense shown')).toBeTruthy();
  });

  it('shows explicit no-budget and no-expense states', async () => {
    const emptyGroup: Group = { ...group };
    delete emptyGroup.spending_plan;
    const emptySnapshot: RemoteGroupSnapshot = {
      ...snapshot,
      group: emptyGroup,
      groupFile: { ...snapshot.groupFile!, group: emptyGroup, sourceDocument: { ...emptyGroup } },
      expenses: [],
      balances: calculateBalances([], members),
      spending: deriveSpendingSummary([], undefined, 'owner', '2026-07-17'),
    };
    jest.mocked(useGroup).mockReturnValue({ state: { data: emptySnapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: emptySnapshot.syncedAt, error: null } } as never);

    const view = await render(<ThemeProvider><SpendingScreen /></ThemeProvider>);

    expect(view.getByText('No total budget yet')).toBeTruthy();
    expect(view.getByText('No expenses yet')).toBeTruthy();
  });
});
