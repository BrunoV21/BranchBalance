import { useCallback, useEffect, useState } from 'react';

const DEFAULT_INTERVAL_MS = 3_000;
const DEFAULT_MAX_ATTEMPTS = 20;

export function useInstallationRecheck({
  focused,
  hasRequiredAccess,
  refresh,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: {
  focused: boolean;
  hasRequiredAccess: boolean;
  refresh(): Promise<unknown>;
  intervalMs?: number;
  maxAttempts?: number;
}) {
  const [cycle, setCycle] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const restart = useCallback(() => {
    setAttempts(0);
    setExhausted(false);
    setCycle((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!focused || hasRequiredAccess || maxAttempts < 1) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      setAttempts(attempts);
      void refresh().catch(() => undefined);
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        setExhausted(true);
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [cycle, focused, hasRequiredAccess, intervalMs, maxAttempts, refresh]);

  useEffect(() => {
    if (!hasRequiredAccess) return;
    queueMicrotask(() => {
      setAttempts(0);
      setExhausted(false);
    });
  }, [hasRequiredAccess]);

  return {
    attempts: hasRequiredAccess ? 0 : attempts,
    maxAttempts,
    checking: focused && !hasRequiredAccess && !exhausted && maxAttempts > 0,
    exhausted: focused && !hasRequiredAccess && exhausted,
    restart,
  };
}
