"use client";

/**
 * A sound bank from this computer — a bigger general midi soundfont (.sf2 / .sf3) than the small
 * built-in one makes guitars, bass and drums sound far more real. It's kept in this browser
 * (IndexedDB, it's too big for localStorage), so it's picked once and stays.
 */

const DB = 'tabs-soundbank';
const STORE = 'files';
const KEY = 'bank';

export type StoredBank = { name: string; size: number; bytes: Uint8Array };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveBank(file: File): Promise<StoredBank> {
  if (!/\.sf[23]$/i.test(file.name)) throw new Error('a sound bank is a .sf2 or .sf3 file');
  if (file.size > 400 * 1024 * 1024) throw new Error('that sound bank is larger than 400 mb');
  const bank = { name: file.name, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
  await run('readwrite', s => s.put(bank, KEY));
  return bank;
}

export async function loadBank(): Promise<StoredBank | null> {
  try { return (await run<StoredBank | undefined>('readonly', s => s.get(KEY))) ?? null; } catch { return null; }
}

export async function forgetBank() {
  try { await run('readwrite', s => s.delete(KEY)); } catch {}
}
