import { useEffect } from 'react';

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
  useEffect(() => {
    if (!focused || hasRequiredAccess || maxAttempts < 1) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts += 1;
      void refresh().catch(() => undefined);
      if (attempts >= maxAttempts) clearInterval(interval);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [focused, hasRequiredAccess, intervalMs, maxAttempts, refresh]);
}
