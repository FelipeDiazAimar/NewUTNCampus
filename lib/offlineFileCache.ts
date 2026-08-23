import { reportClientError } from "@/lib/clientErrorReporter";
import { beginOfflineActivity, endOfflineActivity } from "@/lib/offlineActivity";

export type OfflineFileMeta = {
  materiaId: string;
  materiaNombre: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  savedAt: string;
};

export type OfflineFileRecord = OfflineFileMeta & { key: string };

const DB_NAME = "campus-offline-files";
const STORE_NAME = "files";
const DB_VERSION = 1;

// Se activa tras el primer QuotaExceededError; corta más intentos de guardado
// automático por el resto de la sesión para no repetir escrituras que ya
// sabemos que van a fallar en cada archivo que el usuario abra.
let storageFull = false;

export function isStorageFull(): boolean {
  return storageFull;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}

export async function saveFile(key: string, blob: Blob, meta: OfflineFileMeta): Promise<void> {
  if (typeof indexedDB === "undefined" || storageFull) return;
  beginOfflineActivity();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ key, blob, ...meta });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    if (isQuotaError(err)) {
      storageFull = true;
      reportClientError("warning", `offline-files: espacio insuficiente al guardar ${meta.materiaNombre}/${meta.fileName}`);
      return;
    }
    reportClientError("warning", `offline-files: fallo al guardar ${meta.materiaNombre}/${meta.fileName}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  } finally {
    endOfflineActivity();
  }
}

export async function getFile(key: string): Promise<{ blob: Blob; meta: OfflineFileMeta } | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => {
        const row = req.result as (OfflineFileMeta & { key: string; blob: Blob }) | undefined;
        if (!row) return resolve(null);
        const { blob, ...meta } = row;
        resolve({ blob, meta });
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportClientError("warning", `offline-files: fallo al leer ${key}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
    return null;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    reportClientError("warning", `offline-files: fallo al borrar ${key}`, {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
}

export async function listFiles(): Promise<OfflineFileRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const rows = (req.result as (OfflineFileMeta & { key: string; blob: Blob })[]) ?? [];
        resolve(
          rows.map((row) => ({
            key: row.key,
            materiaId: row.materiaId,
            materiaNombre: row.materiaNombre,
            fileName: row.fileName,
            mimeType: row.mimeType,
            sizeBytes: row.sizeBytes,
            savedAt: row.savedAt,
          }))
        );
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    reportClientError("warning", "offline-files: fallo al listar archivos guardados", {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
    return [];
  }
}

export async function deleteFilesByMateria(materiaId: string): Promise<void> {
  const all = await listFiles();
  await Promise.all(all.filter((f) => f.materiaId === materiaId).map((f) => deleteFile(f.key)));
}

export async function clearAll(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    reportClientError("warning", "offline-files: fallo al borrar todos los archivos", {
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
}

export async function getTotalSize(): Promise<number> {
  const all = await listFiles();
  return all.reduce((sum, f) => sum + f.sizeBytes, 0);
}
