import type { ResolvedItem } from "@/lib/centerfrios";

/**
 * Cache offline-first do player:
 *  - manifesto da playlist em IndexedDB
 *  - binários das mídias na Cache API
 */

const DB_NAME = "centerfrios-player";
const STORE = "manifest";
const CACHE_NAME = "centerfrios-media-v1";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveManifest(key: string, items: ResolvedItem[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(items, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function loadManifest(key: string): Promise<ResolvedItem[] | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    return await new Promise<ResolvedItem[] | null>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as ResolvedItem[]) || null);
      req.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

/** Baixa e guarda os arquivos da playlist na Cache API (sem bloquear a exibição). */
export async function precacheMedia(items: ResolvedItem[]): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const item of items) {
      try {
        const hit = await cache.match(item.url);
        if (!hit) await cache.add(new Request(item.url, { mode: "cors" }));
      } catch {
        /* mídia sem CORS ou rede indisponível: segue com streaming direto */
      }
    }
  } catch {
    /* Cache API indisponível */
  }
}

/** Remove do cache tudo que não pertence mais à playlist atual. */
export async function pruneCache(items: ResolvedItem[]): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const keep: Record<string, boolean> = {};
    items.forEach((i) => {
      keep[i.url] = true;
    });
    const keys = await cache.keys();
    for (const req of keys) {
      if (!keep[req.url]) await cache.delete(req);
    }
  } catch {
    /* ignore */
  }
}

/** Resolve uma URL local (blob) quando a mídia está em cache; senão devolve a original. */
export async function resolveMediaUrl(url: string): Promise<{ src: string; revoke: boolean }> {
  if (typeof caches === "undefined") return { src: url, revoke: false };
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(url);
    if (!hit) return { src: url, revoke: false };
    const blob = await hit.blob();
    return { src: URL.createObjectURL(blob), revoke: true };
  } catch {
    return { src: url, revoke: false };
  }
}
