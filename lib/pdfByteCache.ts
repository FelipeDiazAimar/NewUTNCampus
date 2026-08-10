// In-memory, module-scoped cache for downloaded PDF bytes. Survives
// component unmount/remount (closing a preview and reopening it, navigating
// within the app) for as long as the tab stays open — a hard reload clears
// it, which is fine since the goal is just to avoid re-downloading a file
// the user already viewed this session, not a persistent offline cache.

const MAX_CACHE_BYTES = 200 * 1024 * 1024; // cap so a long session with many large PDFs doesn't grow unbounded

const cache = new Map<string, ArrayBuffer>();
const inflight = new Map<string, Promise<ArrayBuffer>>();
let cachedBytes = 0;

function evictIfNeeded() {
  for (const [key, buf] of cache) {
    if (cachedBytes <= MAX_CACHE_BYTES) break;
    cache.delete(key);
    cachedBytes -= buf.byteLength;
  }
}

export function getCachedPdfBytes(url: string): ArrayBuffer | undefined {
  return cache.get(url);
}

/** Fetches PDF bytes for `url`, caching the result so a later call for the
 *  same url resolves instantly. Concurrent calls for the same url share one
 *  in-flight fetch instead of downloading twice. */
export function fetchPdfBytes(
  url: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<ArrayBuffer> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const total = parseInt(res.headers.get("content-length") ?? "0", 10);

    if (!res.body) {
      const buf = await res.arrayBuffer();
      cache.set(url, buf);
      cachedBytes += buf.byteLength;
      evictIfNeeded();
      return buf;
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      onProgress?.(loaded, total);
    }
    const merged = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    cache.set(url, merged.buffer);
    cachedBytes += merged.byteLength;
    evictIfNeeded();
    return merged.buffer;
  })();

  inflight.set(url, promise);
  promise.catch(() => {}).finally(() => inflight.delete(url));
  return promise;
}
