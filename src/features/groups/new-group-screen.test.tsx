import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

import { githubGroupTypeRequestUrl } from '@/config/app';
import { useGroups } from '@/providers/groups-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import NewGroupScreen from '../../app/(app)/groups/new';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/providers/groups-provider', () => ({ useGroups: jest.fn() }));

describe('New group screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(Linking.openURL).mockResolvedValue(true);
    jest.mocked(Clipboard.setStringAsync).mockResolvedValue(true);
  });

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

  it('opens the dedicated public Issue Form without changing Create group state', async () => {
    jest.mocked(useRouter).mockReturnValue({ replace: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({ canCreateGroups: true, createGroup: jest.fn(), refresh: jest.fn() } as never);
    const view = await render(<ThemeProvider><NewGroupScreen /></ThemeProvider>);

    await fireEvent.changeText(view.getByLabelText('Group name'), 'Family car');
    await fireEvent.press(view.getByRole('radio', { name: /Fuel\./ }));
    await fireEvent.press(view.getByRole('link', { name: /Request another group type on GitHub/i }));

    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(githubGroupTypeRequestUrl));
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    expect(view.getByLabelText('Group name').props.value).toBe('Family car');
    expect(view.getByRole('radio', { name: /Fuel\./ }).props.accessibilityState).toEqual({ selected: true });
    expect(view.getByRole('button', { name: 'Create Fuel group' })).toBeTruthy();
  });

  it('offers retry and an exact copyable link when the browser cannot open', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('No browser'));
    jest.mocked(useRouter).mockReturnValue({ replace: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({ canCreateGroups: true, createGroup: jest.fn(), refresh: jest.fn() } as never);
    const view = await render(<ThemeProvider><NewGroupScreen /></ThemeProvider>);

    await fireEvent.press(view.getByRole('link', { name: /Request another group type on GitHub/i }));
    await waitFor(() => expect(view.getByText(/couldn't open GitHub/i)).toBeTruthy());
    expect(view.getByText(githubGroupTypeRequestUrl).props.selectable).toBe(true);

    await fireEvent.press(view.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(Clipboard.setStringAsync).toHaveBeenCalledWith(githubGroupTypeRequestUrl));
    expect(view.getByText('GitHub request link copied.')).toBeTruthy();

    await fireEvent.press(view.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(Linking.openURL).toHaveBeenCalledTimes(2));
  });

  it('prevents duplicate browser handoffs while opening', async () => {
    let finishOpening!: (value: true) => void;
    jest.mocked(Linking.openURL).mockImplementation(() => new Promise<true>((resolve) => { finishOpening = resolve; }));
    jest.mocked(useRouter).mockReturnValue({ replace: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({ canCreateGroups: false, createGroup: jest.fn(), refresh: jest.fn() } as never);
    const view = await render(<ThemeProvider><NewGroupScreen /></ThemeProvider>);
    const requestLink = view.getByRole('link', { name: /Request another group type on GitHub/i });

    await fireEvent.press(requestLink);
    await fireEvent.press(requestLink);

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(view.getByRole('link', { name: /Request another group type on GitHub/i }).props.accessibilityState).toMatchObject({ busy: true, disabled: true }));
    finishOpening(true);
    await waitFor(() => expect(view.getByRole('link', { name: /Request another group type on GitHub/i }).props.accessibilityState).toMatchObject({ busy: false, disabled: false }));
  });

  it('keeps the manual URL visible when clipboard access fails', async () => {
    jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('No browser'));
    jest.mocked(Clipboard.setStringAsync).mockRejectedValueOnce(new Error('Clipboard unavailable'));
    jest.mocked(useRouter).mockReturnValue({ replace: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({ canCreateGroups: true, createGroup: jest.fn(), refresh: jest.fn() } as never);
    const view = await render(<ThemeProvider><NewGroupScreen /></ThemeProvider>);

    await fireEvent.press(view.getByRole('link', { name: /Request another group type on GitHub/i }));
    await waitFor(() => expect(view.getByText(/couldn't open GitHub/i)).toBeTruthy());
    await fireEvent.press(view.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => expect(view.getByText(/Select the URL below to copy it manually/i)).toBeTruthy());
    expect(view.getByText(githubGroupTypeRequestUrl).props.selectable).toBe(true);
  });
});
