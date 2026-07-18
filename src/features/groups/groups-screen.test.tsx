import { fireEvent, render } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { useInstallationRecheck } from '@/features/groups/use-installation-recheck';
import { useGroups } from '@/providers/groups-provider';
import { useSession } from '@/providers/session-provider';
import { ThemeProvider } from '@/providers/theme-provider';

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
    jest.mocked(useGroups).mockReturnValue({ state: { data: [], status: 'ready', isRefreshing: false, lastSuccessfulAt: null, error: null }, aggregates: [], hasInstallation: false, canCreateGroups: false, pendingCreation: null, refresh, retryPendingCreation: jest.fn() } as never);
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
