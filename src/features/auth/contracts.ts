import type { StoredCredentialV1 } from '@/domain/types';

export interface Clock { now(): Date }
export interface Delay { wait(milliseconds: number, signal?: AbortSignal): Promise<void> }

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface RotatingTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresIn: number;
}

export type DevicePollResult =
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'authorized'; tokens: RotatingTokens };

export interface OAuthTransport {
  requestCode(signal?: AbortSignal): Promise<DeviceCode>;
  poll(deviceCode: string, signal?: AbortSignal): Promise<DevicePollResult>;
  refresh?(refreshToken: string, signal?: AbortSignal): Promise<RotatingTokens>;
}

export interface RefreshTransport {
  refresh(refreshToken: string, signal?: AbortSignal): Promise<RotatingTokens>;
}

export interface TokenSource {
  getValidAccessToken(): Promise<string>;
  forceRefresh(): Promise<string>;
  install(tokens: RotatingTokens): Promise<StoredCredentialV1>;
}

export const systemClock: Clock = { now: () => new Date() };

export const realDelay: Delay = {
  wait(milliseconds, signal) {
    return new Promise<void>((resolve, reject) => {
      const id = setTimeout(resolve, milliseconds);
      const abort = () => {
        clearTimeout(id);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
    });
  },
};
