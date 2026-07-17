import { createContext, type PropsWithChildren, useContext, useEffect, useMemo, useState } from 'react';
import { Appearance, useColorScheme } from 'react-native';

import type { ThemePreference } from '@/infrastructure/storage/contracts';
import { snapshotStore } from '@/infrastructure/storage/snapshot-store';

const palettes = {
  light: {
    background: '#F5F1E8', surface: '#FFFCF6', surfaceStrong: '#FFFFFF', text: '#292522', muted: '#706A64',
    border: '#DDD5CA', accent: '#B94F42', accentText: '#FFFFFF', positive: '#32745B', negative: '#A33E36', warning: '#9A681F', overlay: 'rgba(20,18,16,0.46)',
  },
  dark: {
    background: '#201F1D', surface: '#292826', surfaceStrong: '#33312E', text: '#F2EEE7', muted: '#B4ADA4',
    border: '#48443F', accent: '#E77B6F', accentText: '#201F1D', positive: '#72B89A', negative: '#F08D82', warning: '#E3B365', overlay: 'rgba(0,0,0,0.7)',
  },
} as const;

export type ThemeColors = (typeof palettes)[keyof typeof palettes];
type ThemeContextValue = { preference: ThemePreference; mode: 'light' | 'dark'; colors: ThemeColors; setPreference(value: ThemePreference): Promise<void>; toggle(): Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemValue = useColorScheme();
  const system: 'light' | 'dark' = systemValue === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  useEffect(() => { snapshotStore.readTheme().then(setPreferenceState); }, []);
  useEffect(() => { Appearance.setColorScheme(preference === 'system' ? null : preference); }, [preference]);
  const mode = preference === 'system' ? system : preference;
  const value = useMemo<ThemeContextValue>(() => ({
    preference, mode, colors: palettes[mode],
    async setPreference(next) { await snapshotStore.writeTheme(next); setPreferenceState(next); },
    async toggle() { const next = mode === 'dark' ? 'light' : 'dark'; await snapshotStore.writeTheme(next); setPreferenceState(next); },
  }), [mode, preference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider.');
  return value;
}
