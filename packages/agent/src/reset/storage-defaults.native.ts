/**
 * Built-in stores cleared on soft reset, iOS / Android (Metro picks this over storage-defaults.ts).
 * AsyncStorage is optional: Metro treats a `require` directly inside a `try` block as an optional
 * dependency (transformer.allowOptionalDependencies, on by default), so apps without it still bundle.
 * Only the default (legacy) store is cleared; stores from `createAsyncStorage(name)` need an adapter.
 */
import type { StorageAdapter } from '../api-types';

declare const require: (id: string) => unknown;

interface AsyncStorageLike {
  clear(): Promise<void>;
}

export function defaultStorageAdapters(): StorageAdapter[] {
  let asyncStorage: AsyncStorageLike | undefined;
  try {
    const mod = require('@react-native-async-storage/async-storage') as { default?: AsyncStorageLike } & Partial<AsyncStorageLike>;
    asyncStorage = mod.default ?? (mod as AsyncStorageLike);
  } catch {
    asyncStorage = undefined;
  }
  if (asyncStorage === undefined || typeof asyncStorage.clear !== 'function') return [];
  const s = asyncStorage;
  return [{ name: 'AsyncStorage', clear: () => s.clear() }];
}
