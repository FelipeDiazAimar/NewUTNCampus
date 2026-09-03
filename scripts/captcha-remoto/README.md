# Worker del captcha remoto (corre en una PC de casa)

reCAPTCHA mete a la sesión en un **bucle infinito de desafíos 4×4** cuando la
petición sale desde la IP de datacenter de Vercel. Solución: correr el Chromium
en una PC con **IP residencial**, y que por internet viaje **solo el WebSocket
de la app** (JSON + imágenes de tiles, cientos de KB), no todo el tráfico de
Google.

```
Navegador del usuario ──wss──► xxx.trycloudflare.com ──► ESTA PC (cloudflared)
                                                              │
                                                    server.mts (ws) ──► SesionCaptcha
                                                              │
                                                    Chromium (Playwright, SIN proxy)
                                                              │
                                    Google ve la IP residencial de ESTA PC ◄──┘
```

- `server.mts` — servidor `ws` local. Valida `?token=` (y opcionalmente el
  `Origin`) y por cada conexión crea una `SesionCaptcha` (reusa
  `lib/captchaSesion.ts` tal cual). Se corre con `node server.mts` (TS nativo
  de Node 24: borra tipos sin transformar — necesario para que las funciones
  de `page.evaluate()` lleguen intactas al navegador).
- `cloudflared` — Cloudflare quick tunnel: da una URL `https://…trycloudflare.com`
  con TLS (necesario para `wss://` desde la app `https://`), soporta WebSocket,
  sin cuenta ni dominio. El tráfico a Google **sale por esta PC**.
- `start.ps1` — verifica el Chromium de Playwright, baja `cloudflared`, levanta
  worker + túnel e imprime las env vars para Vercel.

## Requisitos

- **Node 22.6+ (idealmente 24)** en el PATH — para correr `.mts` nativo.
  `npm install` ya corrido.
- Windows + PowerShell para `start.ps1`. Linux: ver abajo.

## Uso

```powershell
# en scripts\captcha-remoto\
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Opciones:

- `-Headful` — Chrome con ventana visible. Con IP residencial + navegador real
  la reputación con reCAPTCHA es casi perfecta (menos probable el bucle). Abre
  una ventana de Chrome cada vez que alguien pide turno.
- `-Origin https://tu-app.vercel.app` — solo acepta conexiones desde ese origin
  (además del token). Recomendado una vez que sepas la URL final.
- `-MaxSesiones N` — cuántos captcha **en paralelo** (default **2**). Hay **un
  solo Chromium compartido** (~250 MB) y cada sesión suma un `context`
  (~100-150 MB, con imágenes/fuentes/mapa bloqueados). Guía aprox: 8 GB → 6-8,
  16 GB → 12-16, 32 GB → 24+. El arranque del 2do en adelante es casi
  instantáneo (no relanza Chromium).
- `-MaxCola N` — cuánta gente puede quedar **esperando en la fila** (default
  **40**). Pasado `-MaxSesiones`, las conexiones NO reciben error: entran a una
  fila FIFO y ven "Sos el N.º X". Al liberarse un cupo entra el siguiente. Si
  el usuario cierra la pantalla mientras espera, sale de la fila. Recién si la
  fila está llena (`> MaxCola`) se rechaza con "probá en unos minutos".
- `-Pool N` — mantiene **N contextos pre-cargados** (ya en la página de turnos,
  `grecaptcha` listo, warmup hecho). El usuario agarra uno al instante: el
  arranque baja de ~5 s a **~30 ms**. Suman RAM: presupuestá
  `total = MaxSesiones + Pool` contextos. Recomendado `-Pool 2` o `3`. Se
  recicla cada 2,5 min y se rellena solo en segundo plano. (Sin efecto si usás
  `CAPTCHA_PROXIES`.)
- `-Name TXT` — nombre del worker en el monitor de `/admin/dashboard`
  (default: `COMPUTERNAME`).
- `-AppUrl https://campusutn.dpdns.org` — base de la app, para mandar el
  **heartbeat** al monitor. Se guarda en `app-url.txt` y se reusa. Con el
  heartbeat andando **NO hace falta tocar `NEXT_PUBLIC_CAPTCHA_WS_URL`** en cada
  reinicio: el cliente toma la URL de `/api/captcha/endpoint`.

## Setup (una vez)

1. Correr `scripts/captcha-workers.sql` en Supabase (tabla del monitor).
2. En **Vercel → Environment Variables** (Production + Preview), pegar lo que
   imprime `start.ps1`:
   - `NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = ...`
   - `CAPTCHA_HEARTBEAT_SECRET = ...`
   - **Borrar `CAPTCHA_PROXIES`.**
3. Redeploy.

## Uso normal

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1 `
  -AppUrl https://campusutn.dpdns.org -Origin https://campusutn.dpdns.org `
  -MaxSesiones 14 -MaxCola 60 -Pool 3
```

- El cliente descubre el worker solo (heartbeat → `/api/captcha/endpoint`). No
  reconfigurás nada en cada reinicio.
- `/admin/dashboard` → sección **"Captcha remoto — workers"**: conectada/caída,
  activa hace cuánto, conexiones (ahora / máx / total), cola, pool, errores,
  tiempos de respuesta (último / promedio / mín / máx), y el motivo si está
  caída.
- **Dejá la ventana abierta.** Si la cerrás, el worker manda un último
  heartbeat con `motivo: "cierre manual"` y el monitor lo muestra en rojo.
- Fallback manual: si querés forzar una URL fija, seteá
  `NEXT_PUBLIC_CAPTCHA_WS_URL` en Vercel (gana sobre el endpoint runtime).

## Cosas a saber

- **El subdominio de `trycloudflare.com` cambia en cada arranque.** Al reiniciar
  `start.ps1`, actualizá `NEXT_PUBLIC_CAPTCHA_WS_URL` en Vercel y redeployá.
  Para algo permanente: named tunnel de Cloudflare (necesita cuenta + un dominio
  en Cloudflare, gratis) con una URL fija.
- El route `/api/captcha` de Vercel sigue existiendo como fallback: si borrás
  `NEXT_PUBLIC_CAPTCHA_WS_URL`, la app vuelve a usarlo (con el bucle).
- `worker-token.txt` y `bin/` están gitignoreados.
- **Seguridad:** `NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN` viaja en el bundle del
  cliente, no es secreto. Frena el abuso casual junto con: la URL efímera del
  túnel, el `-Origin` allowlist, y el tope de **2 sesiones simultáneas**
  (`MAX_SESIONES_CAPTCHA` en `lib/captchaSesion.ts`) — como mucho 2 Chromium a
  la vez, y cada uno se cierra solo al resolver o al cerrar la pestaña.

## La PC "definitiva" (la que vas a dejar prendida)

- **Windows:** copiar el repo (o solo tener Node + `npm install`), correr
  `start.ps1`. Arranque automático: Task Scheduler → tarea "Al iniciar sesión" →
  `powershell -ExecutionPolicy Bypass -File C:\ruta\scripts\captcha-remoto\start.ps1`.
- **Linux** (Node 22.6+):

  ```bash
  npx playwright install chromium
  CAPTCHA_WORKER_TOKEN=xxx CAPTCHA_WORKER_PORT=8788 \
    node scripts/captcha-remoto/server.mts &
  cloudflared tunnel --url http://localhost:8788
  ```

  (bajar `cloudflared` de github.com/cloudflare/cloudflared/releases). Un par de
  unidades `systemd` y queda permanente. Actualizar
  `NEXT_PUBLIC_CAPTCHA_WS_URL` con la URL que imprima.

## Volver a Vercel (sin worker)

Borrar `NEXT_PUBLIC_CAPTCHA_WS_URL` y `NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN` en
Vercel y redeploy. La app usa `/api/captcha` de nuevo.
