import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { Animated, PanResponder } from 'react-native';

import type { ActivityItem } from '@/domain/types';
import { useGroups } from '@/providers/groups-provider';
import { ThemeProvider } from '@/providers/theme-provider';

import ActivityScreen from '../../app/(app)/activity';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('@/providers/groups-provider', () => ({ useGroups: jest.fn() }));

const expenseId = '6f2c1a3e-2b1d-4a3a-9c3e-9d2f9a0b1234';
const item: ActivityItem = {
  id: `commit:owner/branch-balance-trip:${'a'.repeat(40)}`,
  source: 'commit',
  sourceId: 'a'.repeat(40),
  repositoryId: 1,
  groupKey: 'owner/branch-balance-trip',
  groupName: 'Trip',
  kind: 'expense_updated',
  destination: { kind: 'expense', expenseId },
  actorLogin: 'friend',
  eventAt: '2026-07-19T11:00:00.000Z',
  observedAt: '2026-07-19T12:00:00.000Z',
  readAt: null,
};

describe('Activity screen', () => {
  it('marks only rendered unread items, routes safely, dismisses one, and confirms clear all', async () => {
    const push = jest.fn();
    const markActivityRead = jest.fn().mockResolvedValue(undefined);
    const dismissActivity = jest.fn().mockResolvedValue(undefined);
    const clearActivity = jest.fn().mockResolvedValue(undefined);
    const responder = jest.spyOn(PanResponder, 'create').mockImplementation((config) => ({ panHandlers: {
      onMoveShouldSetResponder: config.onMoveShouldSetPanResponder,
      onResponderMove: config.onPanResponderMove,
      onResponderRelease: config.onPanResponderRelease,
      onResponderTerminate: config.onPanResponderTerminate,
    } } as never));
    jest.mocked(useRouter).mockReturnValue({ push, replace: jest.fn() } as never);
    jest.mocked(useGroups).mockReturnValue({
      activityState: { data: [item], status: 'ready', isRefreshing: false, lastSuccessfulAt: '2026-07-19T12:00:00.000Z', error: null },
      activityWarning: null,
      markActivityRead,
      dismissActivity,
      clearActivity,
    } as never);

    const view = await render(<ThemeProvider><ActivityScreen /></ThemeProvider>);
    await waitFor(() => expect(markActivityRead).toHaveBeenCalledWith([item.id]));

    await fireEvent.press(view.getByLabelText(/^Expense updated in Trip,/));
    expect(push).toHaveBeenCalledWith({ pathname: '/groups/[owner]/[repo]/expenses/[id]', params: { owner: 'owner', repo: 'branch-balance-trip', id: expenseId } });

    await fireEvent.press(view.getByRole('button', { name: 'Dismiss Expense updated in Trip' }));
    expect(dismissActivity).toHaveBeenCalledWith(item.id);

    const spring = jest.spyOn(Animated, 'spring').mockReturnValue({ start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) } as never);
    const shortGesture = { stateID: 1, moveX: 40, moveY: 0, x0: 0, y0: 0, dx: 40, dy: 0, vx: 0.1, vy: 0, numberActiveTouches: 1 };
    await act(() => view.getByTestId(`activity-swipe-${item.id}`).props.onResponderRelease({}, shortGesture));
    expect(spring).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 0 }));
    expect(dismissActivity).toHaveBeenCalledTimes(1);
    spring.mockRestore();

    const timing = jest.spyOn(Animated, 'timing').mockReturnValue({ start: (callback?: (result: { finished: boolean }) => void) => callback?.({ finished: true }) } as never);
    const gesture = { stateID: 1, moveX: 100, moveY: 0, x0: 0, y0: 0, dx: 100, dy: 0, vx: 0.5, vy: 0, numberActiveTouches: 1 };
    await act(() => view.getByTestId(`activity-swipe-${item.id}`).props.onResponderRelease({}, gesture));
    await waitFor(() => expect(dismissActivity).toHaveBeenCalledTimes(2));
    timing.mockRestore();

    await fireEvent.press(view.getByRole('button', { name: 'Clear all activity' }));
    expect(view.getByText('Clear all activity?')).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(clearActivity).toHaveBeenCalledTimes(1));
    responder.mockRestore();
  });
});
