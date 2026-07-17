import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppFailure, messageForError, type AppError } from '@/domain/errors';
import type { AccountProfile } from '@/domain/types';
import { githubConfigurationError } from '@/config/app';
import { DeviceFlowController, type DeviceFlowState } from '@/features/auth/device-flow';
import { realDelay } from '@/features/auth/contracts';
import { credentialStore, githubGateway, oauthTransport, snapshotStore, systemClock, tokenManager } from '@/infrastructure/runtime';

type SessionState =
  | { status: 'hydrating'; account: AccountProfile | null; error: string | null }
  | { status: 'authenticated'; account: AccountProfile; error: string | null }
  | { status: 'unauthenticated'; account: null; reason: 'missing' | 'refresh_expired' | 'revoked'; error: string | null };

type SessionContextValue = {
  session: SessionState;
  flow: DeviceFlowState;
  beginSignIn(): Promise<void>;
  retrySignIn(): Promise<void>;
  cancelSignIn(): void;
  signOut(): Promise<void>;
  expire(reason: 'refresh_expired' | 'revoked'): Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<SessionState>({ status: 'hydrating', account: null, error: null });
  const [flow, setFlow] = useState<DeviceFlowState>({ status: 'idle' });
  const controller = useRef<DeviceFlowController | null>(null);

  const completeAccount = useCallback(async () => {
    const account = await githubGateway.getCurrentAccount();
    await snapshotStore.writeAccount(account.id, account);
    await snapshotStore.writeActiveAccountId(account.id);
    setSession({ status: 'authenticated', account, error: null });
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const accountId = await snapshotStore.readActiveAccountId();
      const cachedAccount = accountId === null ? null : await snapshotStore.readAccount(accountId);
      if (active) setSession({ status: 'hydrating', account: cachedAccount, error: null });
      const credential = await credentialStore.read();
      if (!credential) {
        if (active) setSession({ status: 'unauthenticated', account: null, reason: 'missing', error: null });
        return;
      }
      try {
        await tokenManager.getValidAccessToken();
        const account = await githubGateway.getCurrentAccount();
        await snapshotStore.writeAccount(account.id, account);
        await snapshotStore.writeActiveAccountId(account.id);
        if (active) setSession({ status: 'authenticated', account, error: null });
      } catch (error) {
        const detail = error instanceof AppFailure ? error.detail : null;
        if (detail?.kind === 'auth_required') {
          if (accountId !== null) await snapshotStore.clearAccount(accountId);
          if (active) setSession({ status: 'unauthenticated', account: null, reason: detail.reason, error: messageForError(detail) });
        } else if (cachedAccount && active) {
          setSession({ status: 'authenticated', account: cachedAccount, error: 'GitHub could not be reached. Cached data is available.' });
        } else if (active) {
          setSession({ status: 'unauthenticated', account: null, reason: 'missing', error: 'GitHub could not be reached. Try again when you are online.' });
        }
      }
    })();
    return () => { active = false; controller.current?.cancel(); };
  }, []);

  const beginSignIn = useCallback(async () => {
    if (githubConfigurationError) {
      setFlow({ status: 'error', safeMessage: githubConfigurationError, retryable: false });
      return;
    }
    controller.current?.cancel();
    const next = new DeviceFlowController(oauthTransport, systemClock, realDelay, setFlow);
    controller.current = next;
    try {
      const tokens = await next.start();
      await tokenManager.install(tokens);
      await completeAccount();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (next.state.status === 'authorized') setFlow({ status: 'error', safeMessage: 'Authorization succeeded, but the GitHub profile could not be loaded. Try again.', retryable: true });
    }
  }, [completeAccount]);

  const retrySignIn = useCallback(async () => {
    const current = controller.current;
    if (!current) return beginSignIn();
    try {
      const tokens = await current.retry();
      await tokenManager.install(tokens);
      await completeAccount();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      if (current.state.status === 'authorized') setFlow({ status: 'error', safeMessage: 'Authorization succeeded, but the GitHub profile could not be loaded. Try again.', retryable: true });
    }
  }, [beginSignIn, completeAccount]);

  const expire = useCallback(async (reason: 'refresh_expired' | 'revoked') => {
    const accountId = session.account?.id ?? await snapshotStore.readActiveAccountId();
    await credentialStore.clear();
    if (accountId !== null) await snapshotStore.clearAccount(accountId);
    controller.current?.cancel();
    setSession({ status: 'unauthenticated', account: null, reason, error: messageForError({ kind: 'auth_required', reason }) });
  }, [session.account?.id]);

  const signOut = useCallback(async () => {
    const accountId = session.account?.id ?? await snapshotStore.readActiveAccountId();
    await credentialStore.clear();
    if (accountId !== null) await snapshotStore.clearAccount(accountId);
    controller.current?.cancel();
    setFlow({ status: 'idle' });
    setSession({ status: 'unauthenticated', account: null, reason: 'missing', error: null });
  }, [session.account?.id]);

  const value = useMemo<SessionContextValue>(() => ({ session, flow, beginSignIn, retrySignIn, cancelSignIn: () => controller.current?.cancel(), signOut, expire }), [beginSignIn, expire, flow, retrySignIn, session, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

export function isTerminalAuthError(error: unknown): error is AppFailure & { detail: Extract<AppError, { kind: 'auth_required' }> } {
  return error instanceof AppFailure && error.detail.kind === 'auth_required';
}
