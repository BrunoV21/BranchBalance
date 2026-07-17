import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

import type { AccountProfile, DiscoveredGroup, GroupKey, PendingGroupCreation, RemoteGroupSnapshot } from '@/domain/types';

import type { SnapshotStore, ThemePreference } from './contracts';

interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
}

class AsyncKeyValueStore implements KeyValueStore {
  get(key: string) { return AsyncStorage.getItem(key); }
  set(key: string, value: string) { return AsyncStorage.setItem(key, value); }
  remove(key: string) { return AsyncStorage.removeItem(key); }
  keys() { return AsyncStorage.getAllKeys(); }
}

export class MemoryKeyValueStore implements KeyValueStore {
  private values = new Map<string, string>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async remove(key: string) { this.values.delete(key); }
  async keys() { return [...this.values.keys()]; }
}

const accountSchema = z.object({ id: z.number().int(), login: z.string(), name: z.string().nullable(), avatarUrl: z.string().nullable() });
const groupsSchema = z.array(z.object({ key: z.string(), repository: z.object({ id: z.number() }).passthrough(), group: z.object({ schema_version: z.literal(1) }).passthrough(), summary: z.unknown().nullable() }).passthrough());
const snapshotSchema = z.object({ key: z.string(), repository: z.object({ id: z.number() }).passthrough(), group: z.object({ schema_version: z.literal(1) }).passthrough(), expenses: z.array(z.unknown()), syncedAt: z.string() }).passthrough();
const pendingSchema = z.object({ repository: z.object({ id: z.number() }).passthrough(), group: z.object({ schema_version: z.literal(1) }).passthrough() }).passthrough();

const ACTIVE_ACCOUNT = 'bb:v1:active-account';
const THEME = 'bb:v1:theme';
const accountKey = (id: number) => `bb:v1:account:${id}`;
const groupsKey = (id: number) => `bb:v1:groups:${id}`;
const groupStorageKey = (id: number, key: GroupKey) => `bb:v1:group:${id}:${encodeURIComponent(key)}`;
const pendingKey = (id: number) => `bb:v1:pending-group:${id}`;

export class SnapshotStoreImpl implements SnapshotStore {
  constructor(private readonly storage: KeyValueStore = new AsyncKeyValueStore()) {}

  private async readJson<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
    const value = await this.storage.get(key);
    if (!value) return null;
    try {
      return schema.parse(JSON.parse(value));
    } catch {
      await this.storage.remove(key);
      return null;
    }
  }

  private writeJson(key: string, value: unknown) { return this.storage.set(key, JSON.stringify(value)); }

  async readActiveAccountId() {
    const value = await this.storage.get(ACTIVE_ACCOUNT);
    if (!value || !/^\d+$/.test(value)) return null;
    return Number(value);
  }
  writeActiveAccountId(accountId: number) { return this.storage.set(ACTIVE_ACCOUNT, String(accountId)); }
  readAccount(accountId: number) { return this.readJson(accountKey(accountId), accountSchema); }
  writeAccount(accountId: number, value: AccountProfile) { return this.writeJson(accountKey(accountId), value); }
  async readGroups(accountId: number) { return this.readJson(groupsKey(accountId), groupsSchema) as Promise<DiscoveredGroup[] | null>; }
  writeGroups(accountId: number, value: DiscoveredGroup[]) { return this.writeJson(groupsKey(accountId), value); }
  async readGroup(accountId: number, key: GroupKey) { return this.readJson(groupStorageKey(accountId, key), snapshotSchema) as Promise<RemoteGroupSnapshot | null>; }
  writeGroup(accountId: number, key: GroupKey, value: RemoteGroupSnapshot) { return this.writeJson(groupStorageKey(accountId, key), value); }
  removeGroup(accountId: number, key: GroupKey) { return this.storage.remove(groupStorageKey(accountId, key)); }
  async readPendingGroup(accountId: number) { return this.readJson(pendingKey(accountId), pendingSchema) as Promise<PendingGroupCreation | null>; }
  writePendingGroup(accountId: number, value: PendingGroupCreation | null) { return value ? this.writeJson(pendingKey(accountId), value) : this.storage.remove(pendingKey(accountId)); }
  async clearAccount(accountId: number) {
    const prefix = `bb:v1:`;
    const suffixes = [`account:${accountId}`, `groups:${accountId}`, `group:${accountId}:`, `pending-group:${accountId}`, `profiles:${accountId}`];
    const keys = await this.storage.keys();
    await Promise.all(keys.filter((key) => suffixes.some((suffix) => key === `${prefix}${suffix}` || key.startsWith(`${prefix}${suffix}`))).map((key) => this.storage.remove(key)));
    if (await this.readActiveAccountId() === accountId) await this.storage.remove(ACTIVE_ACCOUNT);
  }
  async readTheme(): Promise<ThemePreference> {
    const value = await this.storage.get(THEME);
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
  }
  writeTheme(value: ThemePreference) { return this.storage.set(THEME, value); }
}

export const snapshotStore = new SnapshotStoreImpl();
