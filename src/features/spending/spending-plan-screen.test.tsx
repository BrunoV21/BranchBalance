import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { AppFailure } from '@/domain/errors';
import { deriveSpendingSummary, expenseCategories } from '@/domain/spending';
import type { RemoteGroupSnapshot, SpendingPlan } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import SpendingPlanScreen from '../../app/(app)/groups/[owner]/[repo]/spending-plan/edit';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/features/groups/use-group-refresh', () => ({ useGroupRefresh: () => jest.fn() }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/infrastructure/runtime', () => ({
  systemClock: { now: () => new Date('2026-07-17T14:00:00.000Z') },
  systemLocalCalendar: { today: () => '2026-07-17' },
}));

const repository = { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true as const, canAdmin: true, canWrite: true };
const group = { schema_version: 1 as const, name: 'Trip', currency: 'EUR' as const, spending_plan: { starts_on: '2026-07-17', ends_on: '2026-07-24', updated_by: 'owner', updated_at: '2026-07-17T12:00:00.000Z' }, created_by: 'owner', created_at: '2026-07-13T12:00:00.000Z' };
const groupFile = { group, blobSha: 'group-sha', path: 'group.json' as const, sourceDocument: { ...group } };
const snapshot: RemoteGroupSnapshot = {
  key: 'owner/branch-balance-trip', repository, group, groupFile, members: [{ login: 'owner', name: null, avatarUrl: null, role: 'owner' }], pendingMembers: [], expenses: [],
  balances: { totalSpentMinor: 0, members: [], zeroSum: true }, settlements: [], spending: deriveSpendingSummary([], undefined, 'owner', '2026-07-17'), warnings: [], syncedAt: '2026-07-17T12:00:00.000Z',
};

describe('Spending plan screen', () => {
  const updateSpendingPlan = jest.fn().mockResolvedValue(undefined);
  const removeSpendingPlan = jest.fn().mockResolvedValue(undefined);
  const acceptSpendingPlanFile = jest.fn().mockResolvedValue(undefined);
  const back = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useRouter).mockReturnValue({ back } as never);
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'Owner', name: null, avatarUrl: null }, error: null } } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null }, updateSpendingPlan, removeSpendingPlan, acceptSpendingPlanFile } as never);
  });

  it('builds a canonical shared plan and navigates only after the provider confirms it', async () => {
    const view = await render(<ThemeProvider><SpendingPlanScreen /></ThemeProvider>);
    expect(view.getAllByTestId('lucide-icon')).toHaveLength(expenseCategories.length);
    await fireEvent.changeText(view.getByLabelText('Budget amount (EUR)'), '1000');
    await fireEvent.changeText(view.getByLabelText('Food & drinks (EUR)'), '125.50');
    await fireEvent.press(view.getByRole('button', { name: 'Save spending plan' }));
    await waitFor(() => expect(updateSpendingPlan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'trip', budget_minor: 100000, category_budgets_minor: { food_drink: 12550 }, starts_on: '2026-07-17', ends_on: '2026-07-24', updated_by: 'owner', updated_at: '2026-07-17T14:00:00.000Z' }), groupFile));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('preserves the submitted plan when GitHub reports a conflict', async () => {
    const latestPlan: SpendingPlan = { budget_minor: 120000, updated_by: 'friend', updated_at: '2026-07-17T14:01:00.000Z' };
    const latest = { group: { ...group, spending_plan: latestPlan }, blobSha: 'latest-sha', path: 'group.json' as const, sourceDocument: { ...group, spending_plan: latestPlan } };
    updateSpendingPlan.mockImplementationOnce(async (submitted: SpendingPlan) => { throw new AppFailure({ kind: 'spending_plan_conflict', latest, submitted }); });
    const view = await render(<ThemeProvider><SpendingPlanScreen /></ThemeProvider>);
    await fireEvent.changeText(view.getByLabelText('Budget amount (EUR)'), '1000');
    await fireEvent.press(view.getByRole('button', { name: 'Save spending plan' }));
    expect(await view.findByText('Review spending-plan conflict')).toBeTruthy();
    expect(view.getByText('€1,200.00')).toBeTruthy();
    expect(view.getByText('€1,000.00')).toBeTruthy();
    expect(back).not.toHaveBeenCalled();
  });

  it('builds a sorted Fuel monthly-limit plan without Trip fields', async () => {
    const fuelGroup = { schema_version: 2 as const, group_type: 'fuel' as const, name: 'Car', currency: 'EUR' as const, created_by: 'owner', created_at: '2026-07-13T12:00:00.000Z' };
    const fuelFile = { group: fuelGroup, blobSha: 'fuel-sha', path: 'group.json' as const, sourceDocument: { ...fuelGroup }, sourceVersion: 2 as const, effectiveType: 'fuel' as const };
    const fuelSnapshot: RemoteGroupSnapshot = { ...snapshot, group: fuelGroup, groupFile: fuelFile, effectiveType: 'fuel', spending: deriveSpendingSummary([], undefined, 'owner', '2026-07-17') };
    jest.mocked(useGroup).mockReturnValue({ state: { data: fuelSnapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null }, updateSpendingPlan, removeSpendingPlan, acceptSpendingPlanFile } as never);
    const view = await render(<ThemeProvider><SpendingPlanScreen /></ThemeProvider>);
    await fireEvent.press(view.getByRole('button', { name: 'Add effective-month limit' }));
    await fireEvent.changeText(view.getByLabelText('Effective month 1 (YYYY-MM)'), '2026-08');
    await fireEvent.changeText(view.getByLabelText('Monthly limit 1 (EUR)'), '250');
    await fireEvent.press(view.getByRole('button', { name: 'Save monthly limits' }));
    await waitFor(() => expect(updateSpendingPlan).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fuel_monthly', monthly_limits: [{ effective_month: '2026-08', limit_minor: 25000 }], updated_by: 'owner' }), fuelFile));
  });
});
