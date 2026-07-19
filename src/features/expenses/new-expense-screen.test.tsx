import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { deriveSpendingSummary } from '@/domain/spending';
import type { RemoteGroupSnapshot } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';

import NewExpenseScreen from '../../app/(app)/groups/[owner]/[repo]/expenses/new';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '7a3d2c4b-1e5f-4a8b-9c6d-2f0e1a3b4c5d' }));
jest.mock('@/infrastructure/runtime', () => ({ systemClock: { now: () => new Date('2026-07-17T12:00:00.000Z') } }));
jest.mock('@/features/expenses/expense-form', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    ExpenseForm: ({ onSubmit }: { onSubmit(draft: unknown): Promise<void> }) => React.createElement(
      Pressable,
      { accessibilityRole: 'button', accessibilityLabel: 'Add expense', onPress: () => { void onSubmit({ description: 'Train tickets', amount: '30.00', category: 'transport', paymentMethod: 'card', paidBy: 'owner', splitType: 'equal', participants: ['owner', 'friend'], expenseDate: '2026-07-17' }); } },
      React.createElement(Text, null, 'Add expense'),
    ),
  };
});
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/theme-provider', () => ({
  useTheme: () => ({ colors: {
    background: '#fff', surface: '#fff', surfaceStrong: '#eee', text: '#111', muted: '#666', border: '#ccc',
    accent: '#05f', accentText: '#fff', positive: '#080', negative: '#b00', warning: '#850',
  } }),
}));

const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const snapshot = {
  key: 'owner/branch-balance-trip',
  repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
  group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' },
  groupFile: { group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' }, blobSha: 'group-sha', path: 'group.json', sourceDocument: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-17T09:00:00.000Z' } },
  members, pendingMembers: [], expenses: [],
  balances: { totalSpentMinor: 0, members: members.map((member) => ({ login: member.login, totalPaidMinor: 0, totalShareMinor: 0, settlementSentMinor: 0, settlementReceivedMinor: 0, netMinor: 0, currentMember: true })), zeroSum: true },
  settlements: [], spending: deriveSpendingSummary([], undefined, 'owner', '2026-07-17'), warnings: [], syncedAt: '2026-07-17T11:00:00.000Z',
} satisfies RemoteGroupSnapshot;

describe('NewExpenseScreen', () => {
  it('navigates back only after the confirmed provider commit resolves', async () => {
    let finishSave!: () => void;
    const createExpense = jest.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const back = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ back } as never);
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: null, avatarUrl: null }, error: null } } as never);
    jest.mocked(useGroup).mockReturnValue({
      state: { data: snapshot, status: 'ready', isRefreshing: false, lastSuccessfulAt: snapshot.syncedAt, error: null }, createExpense,
    } as never);
    const view = await render(<NewExpenseScreen />);

    fireEvent.press(view.getByRole('button', { name: 'Add expense' }));

    await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    expect(back).not.toHaveBeenCalled();
    await act(async () => { finishSave(); });
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });
});
