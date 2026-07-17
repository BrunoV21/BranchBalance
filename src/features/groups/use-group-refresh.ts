import { useCallback, useEffect } from 'react';
import { useFocusEffect, useIsFocused } from 'expo-router';
import { AppState } from 'react-native';

import { useGroup } from '@/providers/group-provider';

export function useGroupRefresh() {
  const { refresh } = useGroup();
  const focused = useIsFocused();
  const run = useCallback(() => { void refresh().catch(() => undefined); }, [refresh]);
  useFocusEffect(useCallback(() => { run(); }, [run]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', (next) => { if (next === 'active' && focused) run(); });
    return () => listener.remove();
  }, [focused, run]);
  return run;
}
