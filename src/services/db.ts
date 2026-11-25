/**
 * Thin promise wrapper over IndexedDB.
 * Stores:
 *   projects  Project records (saved file contents)
 *   drafts    unsaved buffers per project (crash / reload recovery)
 *   vcs       local version-control repositories per project
 *   kv        settings, recent list, directory handles, misc
 */
const DB_NAME = 'c-studio';
const DB_VERSION = 1;
export type StoreName = 'projects' | 'drafts' | 'vcs' | 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB non disponibile in questo browser'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['projects', 'drafts', 'vcs', 'kv'] as StoreName[]) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Impossibile aprire il database locale'));
    req.onblocked = () => reject(new Error('Database locale bloccato da un’altra scheda'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function dbPut<T>(store: StoreName, key: string, value: T): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transazione annullata (spazio esaurito?)'));
  });
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}

export async function dbAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function dbClearAll(): Promise<void> {
  const db = await openDb();
  for (const s of ['projects', 'drafts', 'vcs', 'kv'] as StoreName[]) {
    await wrap(db.transaction(s, 'readwrite').objectStore(s).clear());
  }
}

/** For tests. */
export function resetDbConnection(): void {
  dbPromise = null;
}
