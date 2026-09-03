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
- `-MaxSesiones N` — cuántos captcha a la vez (default **2**). Cada uno es un
  Chromium headless, ~300-500 MB de RAM. Guía: 8 GB → 3-4, 16 GB → 6-8,
  32 GB → 10-12. El usuario N+1 recibe "Hay N sesiones activas, esperá" y
  reintenta; cada sesión dura ~30 s-2 min y libera el lugar al resolver.

Después:

1. Copiá las 2 variables que imprime a **Vercel → Settings → Environment
   Variables**, en **Production y Preview**:
   - `NEXT_PUBLIC_CAPTCHA_WS_URL = wss://xxx.trycloudflare.com`
   - `NEXT_PUBLIC_CAPTCHA_WORKER_TOKEN = ...`
2. **Borrá `CAPTCHA_PROXIES`** (o ponela en `off`) — ya no se proxean nada.
3. **Redeploy.**
4. Probá el captcha. En el panel **Diagnóstico** tenés que ver `iniciar:*` y
   llegar a `listo` (el Chromium levantó en tu PC). El bucle 4×4 debería
   desaparecer o pasar a un desafío normal que sí acepta.
5. **Dejá la ventana abierta.** Si la cerrás, el captcha vuelve a fallar.

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
