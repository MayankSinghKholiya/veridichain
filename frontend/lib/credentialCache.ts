/**
 * Browser IndexedDB cache for credential event logs.
 *
 * Key format:  "ce:{chainId}:{address}"
 * Value:       CredEventCache (issued/revoked/upgraded logs + block range)
 *
 * On first load: slow full scan → results stored here.
 * On every later load: serve from cache instantly, then delta-sync only the
 *   new blocks since lastBlock. Subsequent loads feel instantaneous.
 */

const DB_NAME = "veridichain";
const STORE   = "credEvents";

export interface CredEventCache {
  // Raw viem log objects (JSON-serialisable subset stored in IDB)
  issued:    unknown[];
  revoked:   unknown[];
  upgraded:  unknown[];
  /** Earliest block number covered by this cache entry */
  fromBlock: number;
  /** Latest block number synced */
  lastBlock: number;
}

// ── IDB helpers ─────────────────────────────────────────────────────────────

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess       = () => resolve(req.result);
    req.onerror         = () => reject(req.error);
  });
}

/**
 * Read cached events.  Returns null on cache-miss or any IDB error.
 */
export async function idbGet(key: string): Promise<CredEventCache | null> {
  try {
    const db = await openIDB();
    return new Promise((res) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => res((req.result as CredEventCache) ?? null);
      req.onerror   = () => res(null);
    });
  } catch {
    return null;
  }
}

/**
 * Write (upsert) events to cache.  Fails silently — caching is best-effort.
 */
export async function idbSet(key: string, val: CredEventCache): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction(STORE, "readwrite");
      const req = tx.objectStore(STORE).put(val, key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch {
    /* best-effort — never crash the app over a cache write failure */
  }
}

/**
 * Delete a cache entry (call when forcing a full re-sync).
 */
export async function idbDel(key: string): Promise<void> {
  try {
    const db = await openIDB();
    await new Promise<void>((res) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
      req.onsuccess = () => res();
      req.onerror   = () => res(); // ignore
    });
  } catch {
    /* best-effort */
  }
}
