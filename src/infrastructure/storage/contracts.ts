import type { AccountProfile, DiscoveredGroup, GroupKey, PendingGroupCreation, RemoteGroupSnapshot, StoredCredentialV1 } from '@/domain/types';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface CredentialStore {
  read(): Promise<StoredCredentialV1 | null>;
  replace(value: StoredCredentialV1): Promise<void>;
  clear(): Promise<void>;
}

export interface SnapshotStore {
  readActiveAccountId(): Promise<number | null>;
  writeActiveAccountId(accountId: number): Promise<void>;
  readAccount(accountId: number): Promise<AccountProfile | null>;
  writeAccount(accountId: number, value: AccountProfile): Promise<void>;
  readGroups(accountId: number): Promise<DiscoveredGroup[] | null>;
  writeGroups(accountId: number, value: DiscoveredGroup[]): Promise<void>;
  readGroup(accountId: number, key: GroupKey): Promise<RemoteGroupSnapshot | null>;
  writeGroup(accountId: number, key: GroupKey, value: RemoteGroupSnapshot): Promise<void>;
  removeGroup(accountId: number, key: GroupKey): Promise<void>;
  readPendingGroup(accountId: number): Promise<PendingGroupCreation | null>;
  writePendingGroup(accountId: number, value: PendingGroupCreation | null): Promise<void>;
  clearAccount(accountId: number): Promise<void>;
  readTheme(): Promise<ThemePreference>;
  writeTheme(value: ThemePreference): Promise<void>;
}
