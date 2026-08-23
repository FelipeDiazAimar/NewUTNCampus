self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Campus UTN", body: event.data?.text() };
  }

  const isChat = payload.tag === "chat-message";

  const title = payload.title || (isChat ? "Nuevo mensaje" : "¡La asistencia está abierta!");
  const body  = payload.body  || (isChat ? "Tenés un mensaje nuevo en Campus UTN." : "Entrá al Campus UTN para marcar tu asistencia.");

  // iOS Safari no soporta `actions` ni `badge` — incluirlos hace que
  // showNotification() rechace la promesa y la notificación no aparezca.
  const options = {
    body,
    icon: payload.icon || "/logo.png",
    tag:  payload.tag  || "campus-notif",
    renotify: true,
    data: { url: payload.url || (isChat ? "/chat" : "/asistencia") },
  };

  event.waitUntil(
    self.registration.showNotification(title, options).catch((err) => {
      console.error("[SW] showNotification falló:", err);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const target = new URL(url, self.location.origin).href;
        const existing = clients.find((c) => c.url === target);
        if (existing) return existing.focus();
        return self.clients.openWindow(target);
      })
  );
});

// ─── Offline data & app-shell caching ──────────────────────────────────────
// Extiende este Service Worker (que ya maneja Web Push arriba) con un
// handler de fetch para guardar materias/horarios/notas/agenda y navegación
// ya visitada, disponibles sin conexión. Nunca cachea /api/files (streaming
// con Range, cubierto aparte por IndexedDB en el cliente), /api/auth,
// /api/offline-preferences, /api/errors ni /api/admin/*.

const RUNTIME_CACHE = "campus-runtime-v1";
const OFFLINE_FALLBACK_URL = "/offline";

const NEVER_CACHE_PATTERNS = [
  /^\/api\/files/,
  /^\/api\/auth/,
  /^\/api\/offline-preferences/,
  /^\/api\/errors/,
  /^\/api\/admin/,
];

function shouldNeverCache(pathname) {
  return NEVER_CACHE_PATTERNS.some((re) => re.test(pathname));
}

// Precachea la página de fallback en el install — si no está garantizada acá,
// el fallback de networkFirst() nunca la encuentra offline y termina
// relanzando el error de red en vez de mostrar algo (rompe toda navegación
// offline, no solo la que falta en caché).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(RUNTIME_CACHE).then((cache) => cache.add(OFFLINE_FALLBACK_URL))
  );
});

function stableStringify(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableStringify).join(",")}]`;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

// /api/moodle solo acepta POST { methodname, args } — para poder cachearlo
// con Cache API (que solo indexa por Request/URL) armamos una URL sintética
// GET a partir del cuerpo, estable entre llamadas idénticas.
async function moodleCacheKey(request) {
  const body = await request.clone().json().catch(() => null);
  if (!body) return null;
  const key = stableStringify({ m: body.methodname, a: body.args });
  return new Request(`${self.location.origin}/__sw_moodle_cache__?k=${encodeURIComponent(key)}`);
}

// El SW no tiene acceso a reportClientError (vive en el hilo principal) —
// se avisa a los clientes abiertos vía postMessage; instrumentation-client.ts
// escucha "message" en el SW y reenvía al reporter real.
async function notifyClientsOfCacheFailure(context, err) {
  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const client of clientsList) {
    client.postMessage({ type: "campus:sw-cache-error", context, message: err && err.message });
  }
}

async function safeCachePut(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch (err) {
    // Típicamente QuotaExceededError — no debe romper la respuesta al usuario.
    notifyClientsOfCacheFailure("runtime-cache-put", err);
  }
}

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) safeCachePut(cache, cacheKey ?? request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(cacheKey ?? request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_FALLBACK_URL);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) safeCachePut(cache, request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.headers.has("Range")) return; // nunca — cubierto por IndexedDB en el cliente
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (shouldNeverCache(url.pathname)) return;

  // Caso especial: POST /api/moodle — la vía principal de datos de materias.
  if (request.method === "POST" && url.pathname === "/api/moodle") {
    event.respondWith(
      (async () => {
        const cacheKey = await moodleCacheKey(request);
        if (!cacheKey) return fetch(request);
        return networkFirst(request, cacheKey);
      })()
    );
    return;
  }

  if (request.method !== "GET") return; // otras escrituras: siempre red, nunca cache

  if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
  }
});
