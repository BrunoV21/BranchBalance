import { act, renderHook } from '@testing-library/react-native';

import { useInstallationRecheck } from './use-installation-recheck';

describe('useInstallationRecheck', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('rechecks missing installation access on a bounded interval', async () => {
    const refresh = jest.fn().mockResolvedValue([]);
    const view = await renderHook<void, { hasRequiredAccess: boolean }>(
      ({ hasRequiredAccess }) => useInstallationRecheck({ focused: true, hasRequiredAccess, refresh, intervalMs: 100, maxAttempts: 3 }),
      { initialProps: { hasRequiredAccess: false } },
    );

    await act(() => { jest.advanceTimersByTime(300); });
    expect(refresh).toHaveBeenCalledTimes(3);
    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).toHaveBeenCalledTimes(3);

    await view.rerender({ hasRequiredAccess: true });
    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('does not poll while the groups screen is unfocused', async () => {
    const refresh = jest.fn().mockResolvedValue([]);
    await renderHook(() => useInstallationRecheck({ focused: false, hasRequiredAccess: false, refresh, intervalMs: 100, maxAttempts: 3 }));

    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
