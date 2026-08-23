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

const RUNTIME_CACHE = "campus-runtime-v4";
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

// ─── Diagnóstico ────────────────────────────────────────────────────────────
// Mientras el dispositivo está offline no hay forma de mandar nada al
// servidor de errores — se guardan los pasos acá, en la propia IndexedDB del
// SW (el SW no tiene acceso a localStorage), y el cliente los junta y los
// manda a /api/errors apenas vuelve a haber conexión (ver
// lib/offlineDiagnostics.ts + instrumentation-client.ts).
const DIAG_DB = "campus-sw-diagnostics";
const DIAG_STORE = "log";

// Devuelve una promesa que resuelve recién cuando la escritura se confirmó
// (tx.oncomplete), y la envuelve en event.waitUntil() cuando hay un event a
// mano. Sin esto, un diagLog() aislado (sin otra actividad async alrededor
// que mantenga vivo el SW) puede ser cortado por el navegador antes de
// terminar de escribir — exactamente el mismo bug que ya se corrigió para
// cache.put() en safeCachePut(), aplicado acá al propio diagnóstico.
function diagLog(event, step, details) {
  // Visible en vivo abriendo DevTools → Application → Service Workers →
  // "inspect" (consola propia del SW, no la de la pestaña normal).
  console.log("[SW diag]", step, details || "");
  const promise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DIAG_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DIAG_STORE)) {
          db.createObjectStore(DIAG_STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(DIAG_STORE, "readwrite");
          tx.objectStore(DIAG_STORE).add({ at: new Date().toISOString(), step, details: details || null });
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve(); // el diagnóstico nunca debe romper el fetch real
        }
      };
      req.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  if (event && typeof event.waitUntil === "function") event.waitUntil(promise);
  return promise;
}

// skipWaiting + clients.claim: sin esto, un SW nuevo se queda "waiting" hasta
// que TODAS las pestañas/instancias de la PWA controladas por el viejo se
// cierren — un solo reload (o incluso "cerrar y reabrir" en algunos casos)
// puede no alcanzar para que el nuevo SW tome control. Con esto, se activa
// y controla inmediatamente.
// Precachea TODOS los archivos de .next/static/ (chunks JS, CSS, etc.) de una
// sola vez al instalarse — no alcanza con guardar lo que se pide de a uno
// mientras el usuario navega, porque Next.js/Turbopack carga muchos chunks
// de forma perezosa (code-splitting) y hay piezas que nunca se disparan
// durante una sesión de navegación normal, aunque la página en sí sí se haya
// visitado ("Failed to load chunk ... from module" offline). La lista sale
// de /precache-manifest.json, generado en build time (scripts/generate-
// precache-manifest.mjs, corre como "postbuild") — NO de una API route: en
// Vercel .next/static/ no está disponible dentro de una función serverless
// en producción (devolvía 0 archivos). Cada archivo se cachea por separado —
// si alguno falla no bloquea a los demás.
async function precacheAllStaticAssets(event) {
  const cache = await caches.open(RUNTIME_CACHE);
  let urls = [];
  try {
    const res = await fetch("/precache-manifest.json");
    if (res.ok) urls = (await res.json()).urls ?? [];
  } catch (err) {
    diagLog(event, "install:precache-manifest-fetch-failed", { message: err && err.message });
    return;
  }
  let ok = 0;
  let failed = 0;
  await Promise.all(
    urls.map((url) =>
      cache
        .add(url)
        .then(() => { ok++; })
        .catch(() => { failed++; })
    )
  );
  diagLog(event, "install:precache-static-done", { total: urls.length, ok, failed });
}

self.addEventListener("install", (event) => {
  diagLog(event, "install:start");
  event.waitUntil(
    caches
      .open(RUNTIME_CACHE)
      .then((cache) => cache.add(OFFLINE_FALLBACK_URL))
      .then(() => diagLog(event, "install:precache-offline-ok"))
      .catch((err) => diagLog(event, "install:precache-offline-failed", { message: err && err.message }))
      .then(() => precacheAllStaticAssets(event))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  diagLog(event, "activate:start");
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith("campus-runtime-") && name !== RUNTIME_CACHE)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => diagLog(event, "activate:old-caches-cleared"))
      .then(() => self.clients.claim())
      .then(() => diagLog(event, "activate:clients-claimed"))
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

// Avisa al cliente (Navbar → OfflineActivityIndicator) que se está
// guardando esta vista/dato para offline, así puede dibujar el indicador
// del contorno azul. Solo se usa en networkFirst (páginas + /api/moodle +
// datos), no en cacheFirst — cachear un ícono o una fuente no es "descargar
// la vista" y generaría parpadeo constante sin aportar información útil.
async function notifyActivity(type) {
  const clientsList = await self.clients.matchAll({ type: "window" });
  for (const client of clientsList) client.postMessage({ type });
}

// IMPORTANTE: el escrito a cache SIEMPRE se envuelve en event.waitUntil().
// Una promesa "fire and forget" (sin await ni waitUntil) puede ser cortada
// por el navegador apenas se devuelve la respuesta — el SW se considera
// "terminado" y el browser lo suspende, sobre todo en PWA instalada en
// celular. Sin waitUntil, cache.put() a veces nunca llega a completarse.
async function networkFirst(event, request, cacheKey) {
  const label = `${request.mode === "navigate" ? "navigate" : request.method} ${new URL(request.url).pathname}`;
  const cache = await caches.open(RUNTIME_CACHE);
  notifyActivity("campus:offline-activity-start");
  try {
    const response = await fetch(request);
    diagLog(event, "networkFirst:fetch-ok", { label, status: response.status });
    if (response && response.ok) {
      event.waitUntil(
        safeCachePut(cache, cacheKey ?? request, response.clone())
          .then(() => diagLog(event, "networkFirst:cache-put-ok", { label }))
          .finally(() => notifyActivity("campus:offline-activity-end"))
      );
    } else {
      notifyActivity("campus:offline-activity-end");
    }
    return response;
  } catch (err) {
    diagLog(event, "networkFirst:fetch-failed", { label, message: err && err.message });
    notifyActivity("campus:offline-activity-end");
    const cached = await cache.match(cacheKey ?? request);
    if (cached) {
      diagLog(event, "networkFirst:served-from-cache", { label });
      return cached;
    }
    diagLog(event, "networkFirst:cache-miss", { label });
    if (request.mode === "navigate") {
      const fallback = await cache.match(OFFLINE_FALLBACK_URL);
      if (fallback) {
        diagLog(event, "networkFirst:served-offline-fallback", { label });
        return fallback;
      }
      diagLog(event, "networkFirst:offline-fallback-not-cached", { label });
    }
    diagLog(event, "networkFirst:rethrow", { label, message: err && err.message });
    throw err;
  }
}

async function cacheFirst(event, request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      event.waitUntil(safeCachePut(cache, request, response.clone()));
    }
    return response;
  } catch (err) {
    diagLog(event, "cacheFirst:fetch-failed", { url: new URL(request.url).pathname, message: err && err.message });
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode === "navigate") diagLog(event, "fetch:navigate-intercepted", { url: request.url });
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
        return networkFirst(event, request, cacheKey);
      })()
    );
    return;
  }

  if (request.method !== "GET") return; // otras escrituras: siempre red, nunca cache

  if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(event, request));
    return;
  }

  // Navegación "liviana" de Next.js (RSC, al clickear un link sin recargar):
  // se prueba cachear, pero el payload trae embebido un buildId/estado del
  // momento exacto en que se generó — servir uno guardado más tarde puede no
  // coincidir con lo que el router de React espera y dejar la sesión en un
  // estado roto (pantallas en blanco, "error inesperado" incluso en vistas
  // no relacionadas). A propósito NO se intercepta: se deja pasar directo,
  // así cuando falla offline Next.js cae solo a una recarga completa, que sí
  // usa la navegación dura (más abajo) — comprobada confiable.
  if (request.headers.has("RSC") || url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate" || url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(event, request));
  }
});
