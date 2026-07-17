import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Appearance } from 'react-native';

import { snapshotStore } from '@/infrastructure/storage/snapshot-store';

import { ThemeProvider, useTheme } from './theme-provider';

jest.mock('@/infrastructure/storage/snapshot-store', () => ({
  snapshotStore: { readTheme: jest.fn(), writeTheme: jest.fn() },
}));

describe('ThemeProvider native appearance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(snapshotStore.readTheme).mockResolvedValue('dark');
    jest.mocked(snapshotStore.writeTheme).mockResolvedValue(undefined);
    jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('applies the persisted preference to native Android dialogs after hydration', async () => {
    const wrapper = ({ children }: PropsWithChildren) => <ThemeProvider>{children}</ThemeProvider>;
    const view = await renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(view.result.current.mode).toBe('dark'));
    expect(Appearance.setColorScheme).toHaveBeenCalledWith('dark');

    await act(() => view.result.current.setPreference('system'));
    expect(snapshotStore.writeTheme).toHaveBeenCalledWith('system');
    expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('unspecified');
  });
});
