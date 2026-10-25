// Browser-only: stores generated audio clips in IndexedDB, keyed by cacheKey().
// IndexedDB is a database built into the browser that can hold files, unlike localStorage.
// Old name kept on purpose for storage compatibility: renaming would lose saved data and cached audio.
const DB_NAME = "scene-partner";
const STORE = "audio";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs one request against the audio store and resolves with its result.
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const getClip = (key: string) => run<Blob | undefined>("readonly", (s) => s.get(key));
export const putClip = (key: string, clip: Blob) => run("readwrite", (s) => s.put(clip, key));

// Every key already cached, so we know which lines can be skipped.
export async function cachedKeys(): Promise<Set<string>> {
  const keys = await run("readonly", (s) => s.getAllKeys());
  return new Set(keys.map(String));
}
