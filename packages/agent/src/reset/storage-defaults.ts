/**
 * Built-in stores cleared on soft reset, web (requirements.md §6.5): localStorage, sessionStorage and
 * every IndexedDB database. AsyncStorage on web is backed by localStorage, so it is covered.
 */
import type { StorageAdapter } from '../api-types';

interface IDBFactoryLike {
  databases?: () => Promise<{ name?: string }[]>;
  deleteDatabase(name: string): { onsuccess: (() => void) | null; onerror: (() => void) | null; onblocked: (() => void) | null };
}

function deleteDb(idb: IDBFactoryLike, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(new Error(`cannot delete IndexedDB database ${name}`));
    // Another connection keeps it open; it is deleted once that connection closes (the remount does that).
    req.onblocked = () => resolve();
  });
}

export function defaultStorageAdapters(g: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): StorageAdapter[] {
  const out: StorageAdapter[] = [];
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    const s = g[key] as { clear?: () => void } | undefined;
    if (s !== undefined && typeof s.clear === 'function') out.push({ name: key, clear: () => s.clear?.() });
  }
  const idb = g['indexedDB'] as IDBFactoryLike | undefined;
  if (idb !== undefined && typeof idb.databases === 'function') {
    out.push({
      name: 'indexedDB',
      clear: async () => {
        const dbs = (await idb.databases?.()) ?? [];
        await Promise.all(dbs.flatMap((d) => (d.name === undefined ? [] : [deleteDb(idb, d.name)])));
      },
    });
  }
  return out;
}
