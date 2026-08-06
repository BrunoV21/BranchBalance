import type { ReactNode } from 'react';
import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { calculateBalances, simplifySettlements } from '@/domain/balances';
import { deriveSettlementReservations } from '@/domain/settlements';
import type { Expense, RemoteGroupSnapshot, SettlementPayment } from '@/domain/types';
import { useGroup } from '@/providers/group-provider';
import { useSession } from '@/providers/session-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import BalancesScreen from '../../app/(app)/groups/[owner]/[repo]/(tabs)/balances';
import NewSettlementPaymentScreen from '../../app/(app)/groups/[owner]/[repo]/settlements/new';

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'bf6cdb85-4677-44af-8d16-e6f70ea54b8a' }));
jest.mock('@/features/groups/use-group-refresh', () => ({ useGroupRefresh: () => jest.fn() }));
jest.mock('@/providers/group-provider', () => ({ useGroup: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/theme-provider', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
  useTheme: () => ({ colors: {
    background: '#000', surface: '#111', surfaceStrong: '#222', text: '#fff', muted: '#aaa', border: '#444',
    accent: '#05f', accentText: '#fff', positive: '#080', negative: '#b00', warning: '#850', overlay: 'rgba(0,0,0,.4)',
  } }),
}));
jest.mock('@/infrastructure/runtime', () => ({
  systemClock: { now: () => new Date('2026-07-19T15:00:00.000Z') },
  systemLocalCalendar: { today: () => '2026-07-19' },
}));

const members = [
  { login: 'owner', name: null, avatarUrl: null, role: 'owner' as const },
  { login: 'friend', name: null, avatarUrl: null, role: 'member' as const },
];
const expense: Expense = {
  schema_version: 1, id: '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234', description: 'Dinner', amount_minor: 1_000,
  currency: 'EUR', category: 'food_drink', payment_method: 'card', paid_by: 'owner', split_type: 'equal', participants: ['owner', 'friend'], shares_minor: { owner: 500, friend: 500 },
  expense_date: '2026-07-19', created_by: 'owner', created_at: '2026-07-19T10:00:00.000Z', updated_by: null, updated_at: null,
};
const payment: SettlementPayment = {
  id: '8f6cdb85-4677-44af-8d16-e6f70ea54b8a', from: 'friend', to: 'owner', amount_minor: 300, currency: 'EUR', paid_on: '2026-07-19',
  note: 'Receipt reference: shared-folder/42', status: 'pending', recorded_by: 'friend', recorded_at: '2026-07-19T12:00:00.000Z', confirmed_by: null, confirmed_at: null,
};

function snapshot(): RemoteGroupSnapshot {
  const balances = calculateBalances([expense], [payment], members);
  const settlements = simplifySettlements(balances.members);
  const sourceDocument = { schema_version: 1, payments: [payment] };
  return {
    key: 'owner/branch-balance-trip', repository: { id: 1, owner: 'owner', name: 'branch-balance-trip', defaultBranch: 'main', installationId: 10, private: true, canAdmin: true, canWrite: true },
    group: { schema_version: 1, name: 'Trip', currency: 'EUR', created_by: 'owner', created_at: '2026-07-19T09:00:00.000Z' }, groupFile: null,
    members, pendingMembers: [], expenses: [{ expense, blobSha: 'expense-sha', path: `expenses/${expense.id}.json`, sourceDocument: { ...expense } }],
    balances, settlements, settlementLedger: { kind: 'ready', file: { payments: [payment], blobSha: 'ledger-sha', path: 'settlements.json', sourceDocument, warnings: [] } },
    payments: [payment], reservations: deriveSettlementReservations(settlements, [payment]), spending: null, warnings: [], syncedAt: '2026-07-19T12:00:00.000Z',
  };
}

describe('settlement screens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: null, avatarUrl: null }, error: null } } as never);
  });

  it('shows reservations, shared note history, and recipient-only confirmation', async () => {
    const data = snapshot();
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data, status: 'ready', isRefreshing: false, lastSuccessfulAt: data.syncedAt, error: null }, confirmSettlementPayment: jest.fn(), deleteSettlementPayment: jest.fn() } as never);
    const view = await render(<ThemeProvider><BalancesScreen /></ThemeProvider>);
    expect(view.getByText('Expense funding')).toBeTruthy();
    expect(view.getByText('Who fronted the group?')).toBeTruthy();
    expect(view.getByLabelText(/You, @owner: paid €10.00, share €5.00, expense funding gap \+€5.00/i)).toBeTruthy();
    expect(view.getByText(/Confirmed settlement payments affect the net balances below, not this chart/i)).toBeTruthy();
    expect(view.getByText(/Awaiting confirmation €3.00/)).toBeTruthy();
    expect(view.getByText(payment.note!)).toBeTruthy();
    const confirmButton = view.getByRole('button', { name: 'Confirm received' });
    expect(within(confirmButton).getByText('Confirm received').props.numberOfLines).toBe(1);
    expect(view.getAllByTestId('lucide-icon').length).toBeGreaterThan(10);
  });

  it('shows a loading state while cached payment data is verified', async () => {
    const data = snapshot();
    data.settlementLedger = { kind: 'unverified' };
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data, status: 'ready', isRefreshing: false, lastSuccessfulAt: data.syncedAt, error: null }, confirmSettlementPayment: jest.fn(), deleteSettlementPayment: jest.fn() } as never);

    const view = await render(<ThemeProvider><BalancesScreen /></ThemeProvider>);

    expect(view.getByLabelText('Refreshing balances from GitHub')).toBeTruthy();
    expect(view.getByText('Loading latest balances…')).toBeTruthy();
    expect(view.queryByText(/Cached payment totals are provisional/i)).toBeNull();
    expect(view.queryByText('Suggested settlements')).toBeNull();
  });

  it('celebrates when every balance is settled', async () => {
    const data = snapshot();
    data.expenses = [];
    data.balances = calculateBalances([], [], members);
    data.settlements = simplifySettlements(data.balances.members);
    data.settlementLedger = { kind: 'missing', payments: [] };
    data.payments = [];
    data.reservations = [];
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useGroup).mockReturnValue({ state: { data, status: 'ready', isRefreshing: false, lastSuccessfulAt: data.syncedAt, error: null }, confirmSettlementPayment: jest.fn(), deleteSettlementPayment: jest.fn() } as never);
    const view = await render(<ThemeProvider><BalancesScreen /></ThemeProvider>);
    expect(view.getByText('All settled')).toBeTruthy();
    expect(view.getByLabelText('Everything is settled')).toBeTruthy();
  });

  it('reviews and records a partial pending payment with a trimmed note', async () => {
    const data = snapshot();
    const recordSettlementPayment = jest.fn().mockResolvedValue(undefined);
    const back = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ back } as never);
    jest.mocked(useLocalSearchParams).mockReturnValue({ from: 'friend', to: 'owner' });
    jest.mocked(useGroup).mockReturnValue({ state: { data, status: 'ready', isRefreshing: false, lastSuccessfulAt: data.syncedAt, error: null }, recordSettlementPayment } as never);
    const view = await render(<ThemeProvider><NewSettlementPaymentScreen /></ThemeProvider>);
    await waitFor(() => expect(view.getByLabelText('Amount (EUR)').props.value).toBe('2.00'));
    expect(StyleSheet.flatten(view.getByLabelText('Shared note (optional)').props.style)).toMatchObject({ backgroundColor: '#222', color: '#fff', minHeight: 112 });
    await fireEvent.changeText(view.getByLabelText('Amount (EUR)'), '1.25');
    await fireEvent.changeText(view.getByLabelText('Shared note (optional)'), '  External transaction ID TX-42  ');
    await waitFor(() => expect(view.getByLabelText('Shared note (optional)').props.value).toContain('TX-42'));
    await fireEvent.press(view.getByRole('button', { name: 'Review payment' }));
    await waitFor(() => expect(view.getByText(/Record €1.25.+The recipient must confirm receipt/i)).toBeTruthy());
    expect(view.queryByText(/shared note will be stored/i)).toBeNull();
    const recordButton = view.getByRole('button', { name: 'Record payment' });
    expect(within(recordButton).getByText('Record payment').props).toMatchObject({ adjustsFontSizeToFit: true, numberOfLines: 1 });
    await fireEvent.press(recordButton);
    await waitFor(() => expect(recordSettlementPayment).toHaveBeenCalledWith(expect.objectContaining({ amount_minor: 125, note: 'External transaction ID TX-42', status: 'pending', confirmed_by: null })));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
