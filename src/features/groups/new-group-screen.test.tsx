import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';

import { useGroups } from '@/providers/groups-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import NewGroupScreen from '../../app/(app)/groups/new';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/providers/groups-provider', () => ({ useGroups: jest.fn() }));

describe('New group screen', () => {
  it('defaults to Trip and confirms immutable Fuel selection before creation', async () => {
    const createGroup = jest.fn().mockResolvedValue({ repository: { owner: 'alice', name: 'branch-balance-car' } });
    const replace = jest.fn();
    jest.mocked(useRouter).mockReturnValue({ replace } as never);
    jest.mocked(useGroups).mockReturnValue({ canCreateGroups: true, createGroup, refresh: jest.fn() } as never);
    const view = await render(<ThemeProvider><NewGroupScreen /></ThemeProvider>);

    expect(view.getByRole('radio', { name: /Trip\./ }).props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(view.getByRole('radio', { name: /Fuel\./ }));
    await fireEvent.changeText(view.getByLabelText('Group name'), 'Family car');
    await fireEvent.press(view.getByRole('button', { name: 'Create Fuel group' }));
    expect(view.getByText('Create this Fuel group?')).toBeTruthy();
    expect(view.getByText(/permanent Fuel group using EUR/i)).toBeTruthy();
    await fireEvent.press(view.getAllByRole('button', { name: 'Create Fuel group' }).at(-1)!);

    await waitFor(() => expect(createGroup).toHaveBeenCalledWith('Family car', 'EUR', 'fuel'));
    expect(replace).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]', params: { owner: 'alice', repo: 'branch-balance-car' } });
  });
});
