import { reportClientError } from "@/lib/clientErrorReporter";

/**
 * Lee los pasos de diagnóstico que el Service Worker fue guardando en su
 * propia IndexedDB (ver public/sw.js::diagLog — el SW no tiene acceso a
 * localStorage ni puede llamar a reportClientError directo mientras está
 * offline) y los manda al sistema de errores existente en un solo reporte,
 * para verlos en /admin/dashboard.
 */

const DB_NAME = "campus-sw-diagnostics";
const STORE_NAME = "log";

type DiagEntry = { id: number; at: string; step: string; details: unknown };

function openDiagDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll(): Promise<DiagEntry[]> {
  const db = await openDiagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as DiagEntry[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function clearAll(): Promise<void> {
  const db = await openDiagDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let flushing = false;

export async function flushOfflineDiagnostics(): Promise<void> {
  if (typeof indexedDB === "undefined" || typeof navigator === "undefined" || !navigator.onLine || flushing) return;
  flushing = true;
  try {
    const entries = await readAll();
    if (entries.length === 0) return;
    const summary = entries
      .map((e) => `[${e.at}] ${e.step}${e.details ? " " + JSON.stringify(e.details) : ""}`)
      .join("\n");
    reportClientError("warning", `offline-diag (${entries.length} pasos):\n${summary}`.slice(0, 3900));
    await clearAll();
  } catch {
    /* best-effort — se reintenta en el próximo flush */
  } finally {
    flushing = false;
  }
}
