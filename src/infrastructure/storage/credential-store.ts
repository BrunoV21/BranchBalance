import * as SecureStore from 'expo-secure-store';

import { parseCredential } from '@/domain/schemas';
import type { StoredCredentialV1 } from '@/domain/types';

import type { CredentialStore } from './contracts';

// SecureStore keys may contain only alphanumeric characters, `.`, `-`, and `_`.
const CREDENTIAL_KEY = 'bb.v1.github-credential';

export class SecureCredentialStore implements CredentialStore {
  async read(): Promise<StoredCredentialV1 | null> {
    const value = await SecureStore.getItemAsync(CREDENTIAL_KEY);
    if (!value) return null;
    try {
      return parseCredential(JSON.parse(value));
    } catch {
      await this.clear();
      return null;
    }
  }

  replace(value: StoredCredentialV1): Promise<void> {
    return SecureStore.setItemAsync(CREDENTIAL_KEY, JSON.stringify(value));
  }

  clear(): Promise<void> {
    return SecureStore.deleteItemAsync(CREDENTIAL_KEY);
  }
}

export class MemoryCredentialStore implements CredentialStore {
  value: StoredCredentialV1 | null = null;
  async read() { return this.value; }
  async replace(value: StoredCredentialV1) { this.value = structuredClone(value); }
  async clear() { this.value = null; }
}

/** Web is a UI preview only. Never downgrade rotating GitHub tokens to browser storage. */
export class UnsupportedCredentialStore implements CredentialStore {
  async read() { return null; }
  async replace(_value: StoredCredentialV1): Promise<void> {
    throw new Error('GitHub sign-in is only supported on Android builds.');
  }
  async clear() { /* No credentials can be stored by this adapter. */ }
}
