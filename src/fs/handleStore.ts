// Persists the picked directory handle in IndexedDB so the folder can be
// reopened after a reload (handles are structured-cloneable, not JSON-able).

const DB_NAME = "code-explorer";
const STORE_NAME = "handles";
const ROOT_KEY = "root";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await withStore<FileSystemDirectoryHandle | undefined>("readonly", (store) =>
      store.get(ROOT_KEY),
    );
  } catch {
    return undefined;
  }
}

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await withStore("readwrite", (store) => store.put(handle, ROOT_KEY));
  } catch {
    // Remembering the folder is a convenience; ignore storage failures.
  }
}
