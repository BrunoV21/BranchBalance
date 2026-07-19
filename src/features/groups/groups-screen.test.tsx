import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { useInstallationRecheck } from '@/features/groups/use-installation-recheck';
import { useGroups } from '@/providers/groups-provider';
import { useSession } from '@/providers/session-provider';
import { ThemeProvider } from '@/providers/theme-provider';
import type { PendingGroupInvitation } from '@/domain/types';

import GroupsScreen from '../../app/(app)/groups/index';

jest.mock('expo-router', () => ({ useRouter: jest.fn(), useIsFocused: () => true, useFocusEffect: jest.fn() }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/features/groups/use-installation-recheck', () => ({ useInstallationRecheck: jest.fn() }));
jest.mock('@/providers/groups-provider', () => ({ useGroups: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));

describe('Groups screen installation recovery', () => {
  it('shows live recheck progress instead of a disabled empty state', async () => {
    const refresh = jest.fn().mockResolvedValue([]);
    const restart = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: 'Owner', avatarUrl: null }, error: null } } as never);
    jest.mocked(useGroups).mockReturnValue(groupsValue({ state: { data: [], status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null }, hasInstallation: false, canCreateGroups: false, refresh }) as never);
    jest.mocked(useInstallationRecheck).mockReturnValue({ attempts: 10, maxAttempts: 20, checking: true, exhausted: false, restart });

    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);

    expect(view.getByText('Connecting your GitHub App')).toBeTruthy();
    expect(view.getByText('Automatic recheck 10 of 20')).toBeTruthy();
    expect(view.getByLabelText('Checking GitHub App access')).toBeTruthy();
    expect(view.getByLabelText('GitHub access rechecks: 10 of 20').props.accessibilityValue).toEqual({ min: 0, max: 20, now: 10 });
    expect(view.queryByText('No groups yet')).toBeNull();
    expect(view.queryByRole('button', { name: 'Create a group' })).toBeNull();

    await fireEvent.press(view.getByRole('button', { name: 'Recheck GitHub access' }));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

const invitation = {
  id: 50,
  repository: { id: 2, owner: 'maya', ownerType: 'User' as const, name: 'branch-balance-lisbon-weekend', fullName: 'maya/branch-balance-lisbon-weekend', private: true as const },
  invitee: 'owner', inviter: 'maya', permission: 'write' as const, createdAt: '2026-07-19T12:00:00.000Z', provisionalName: 'Lisbon Weekend',
} satisfies PendingGroupInvitation;

describe('Groups screen invitations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useRouter).mockReturnValue({ push: jest.fn() } as never);
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: 'Owner', avatarUrl: null }, error: null } } as never);
    jest.mocked(useInstallationRecheck).mockReturnValue({ attempts: 0, maxAttempts: 20, checking: false, exhausted: false, restart: jest.fn() });
  });

  it('places invitation details below Create a group and before Active groups', async () => {
    jest.mocked(useGroups).mockReturnValue(groupsValue({ invitationState: { data: [invitation], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: null } }) as never);
    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);
    const headerChildren = (view.getByTestId('groups-list-header').props.children as ({ props?: { testID?: string } } | null)[]);
    const createIndex = headerChildren.findIndex((child) => child?.props?.testID === 'groups-create-action');
    const invitationsIndex = headerChildren.findIndex((child) => child?.props?.testID === 'groups-invitations-slot');
    const activeIndex = headerChildren.findIndex((child) => child?.props?.testID === 'groups-active-heading');

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeLessThan(invitationsIndex);
    expect(invitationsIndex).toBeLessThan(activeIndex);
    expect(view.getByText('Repository: maya/branch-balance-lisbon-weekend')).toBeTruthy();
    expect(view.getByText('Invited by @maya')).toBeTruthy();
    expect(view.getByText('Requested access: Write')).toBeTruthy();
    expect(view.getByLabelText('Accept invitation to Lisbon Weekend')).toBeTruthy();
    expect(view.getByLabelText('Decline invitation to Lisbon Weekend')).toBeTruthy();
  });

  it('accepts directly and requires confirmation before declining', async () => {
    const acceptInvitation = jest.fn().mockResolvedValue(undefined);
    const declineInvitation = jest.fn().mockResolvedValue(undefined);
    jest.mocked(useGroups).mockReturnValue(groupsValue({ invitationState: { data: [invitation], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: null }, acceptInvitation, declineInvitation }) as never);
    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);

    await fireEvent.press(view.getByLabelText('Accept invitation to Lisbon Weekend'));
    expect(acceptInvitation).toHaveBeenCalledWith(50);

    await fireEvent.press(view.getByLabelText('Decline invitation to Lisbon Weekend'));
    expect(view.getByText('Decline “Lisbon Weekend”?')).toBeTruthy();
    expect(view.getByText(/new invitation from the owner/)).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
    expect(declineInvitation).not.toHaveBeenCalled();

    await fireEvent.press(view.getByLabelText('Decline invitation to Lisbon Weekend'));
    await fireEvent.press(view.getByRole('button', { name: 'Decline invitation' }));
    expect(declineInvitation).toHaveBeenCalledWith(50);
  });

  it('hides the invitation section for an authoritative empty result', async () => {
    jest.mocked(useGroups).mockReturnValue(groupsValue() as never);
    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);
    expect(view.queryByText('Invited groups')).toBeNull();
  });

  it('disables stale invitations and limits busy state to the selected card', async () => {
    const second = { ...invitation, id: 51, repository: { ...invitation.repository, id: 3, name: 'branch-balance-porto', fullName: 'maya/branch-balance-porto' }, provisionalName: 'Porto' };
    jest.mocked(useGroups).mockReturnValue(groupsValue({
      invitationState: { data: [invitation, second], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: null },
      invitationMutations: new Map([[50, 'accepting']]),
    }) as never);
    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);

    expect(view.getByLabelText('Accept invitation to Lisbon Weekend').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(view.getByLabelText('Decline invitation to Lisbon Weekend').props.accessibilityState).toMatchObject({ disabled: true });
    expect(view.getByLabelText('Accept invitation to Porto').props.accessibilityState).toMatchObject({ disabled: false, busy: false });

    jest.mocked(useGroups).mockReturnValue(groupsValue({
      invitationState: { data: [invitation], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: 'Refresh invitations.' },
    }) as never);
    await view.rerender(<ThemeProvider><GroupsScreen /></ThemeProvider>);
    expect(view.getByLabelText('Accept invitation to Lisbon Weekend').props.accessibilityState).toMatchObject({ disabled: true });
    expect(view.getByText('Refresh these invitations before accepting or declining.')).toBeTruthy();
  });
});

describe('Groups screen activity entry point', () => {
  it('announces unread activity and opens the inbox from the account heading', async () => {
    const push = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ push } as never);
    jest.mocked(useSession).mockReturnValue({ session: { status: 'authenticated', account: { id: 7, login: 'owner', name: 'Owner', avatarUrl: null }, error: null } } as never);
    jest.mocked(useInstallationRecheck).mockReturnValue({ attempts: 0, maxAttempts: 20, checking: false, exhausted: false, restart: jest.fn() });
    jest.mocked(useGroups).mockReturnValue(groupsValue({ hasUnreadActivity: true }) as never);

    const view = await render(<ThemeProvider><GroupsScreen /></ThemeProvider>);
    await fireEvent.press(view.getByRole('button', { name: 'Activity inbox, new activity' }));

    expect(push).toHaveBeenCalledWith('/activity');
  });
});

function groupsValue(overrides: Record<string, unknown> = {}) {
  return {
    state: { data: [], status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null },
    groupWarningCount: 0,
    aggregates: [],
    hasInstallation: true,
    canCreateGroups: true,
    pendingCreation: null,
    invitationState: { data: [], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: null },
    invitationWarningCount: 0,
    invitationMutations: new Map(),
    acceptedPendingDiscovery: [],
    invitationNotice: null,
    activityState: { data: [], status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null },
    activityWarning: null,
    hasUnreadActivity: false,
    refresh: jest.fn().mockResolvedValue(undefined),
    acceptInvitation: jest.fn().mockResolvedValue(undefined),
    declineInvitation: jest.fn().mockResolvedValue(undefined),
    retryPendingCreation: jest.fn(),
    markActivityRead: jest.fn().mockResolvedValue(undefined),
    dismissActivity: jest.fn().mockResolvedValue(undefined),
    clearActivity: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
