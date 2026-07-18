import { act, renderHook } from '@testing-library/react-native';

import { useInstallationRecheck } from './use-installation-recheck';

describe('useInstallationRecheck', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('rechecks missing installation access on a bounded interval', async () => {
    const refresh = jest.fn().mockResolvedValue([]);
    const view = await renderHook<ReturnType<typeof useInstallationRecheck>, { hasRequiredAccess: boolean }>(
      ({ hasRequiredAccess }) => useInstallationRecheck({ focused: true, hasRequiredAccess, refresh, intervalMs: 100, maxAttempts: 3 }),
      { initialProps: { hasRequiredAccess: false } },
    );

    await act(() => { jest.advanceTimersByTime(300); });
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(view.result.current).toMatchObject({ attempts: 3, maxAttempts: 3, checking: false, exhausted: true });
    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).toHaveBeenCalledTimes(3);

    await act(() => view.result.current.restart());
    expect(view.result.current).toMatchObject({ attempts: 0, checking: true, exhausted: false });
    await act(() => { jest.advanceTimersByTime(100); });
    expect(refresh).toHaveBeenCalledTimes(4);

    await view.rerender({ hasRequiredAccess: true });
    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).toHaveBeenCalledTimes(4);
    expect(view.result.current).toMatchObject({ attempts: 0, checking: false, exhausted: false });
  });

  it('does not poll while the groups screen is unfocused', async () => {
    const refresh = jest.fn().mockResolvedValue([]);
    await renderHook(() => useInstallationRecheck({ focused: false, hasRequiredAccess: false, refresh, intervalMs: 100, maxAttempts: 3 }));

    await act(() => { jest.advanceTimersByTime(500); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
