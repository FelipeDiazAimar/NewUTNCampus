# Biblioteca — Captcha remoto en Vercel

> Documento técnico del problema, la investigación, la solución elegida y la
> implementación. Complementa `BIBLIOTECA_IMPLEMENTATION.md` y sigue el patrón de
> `ASISTENCIA_LEGACY.md`.
>
> Rama de trabajo: `solucion/3-captcha-remoto`.

---

## 1. El problema

El sistema de turnos de la facultad (`https://turnos.frsfco.utn.edu.ar:4443`, PHP
a mano) protege el alta de turnos con **reCAPTCHA v2 checkbox**:

- **Sitekey**: `6Lfx5oAkAAAAAF45dX6a-gGxt13afBWFejLFQ77z`, registrada
  exclusivamente para el dominio del legacy.
- El formulario principal postea `multipart/form-data` a
  `/envio/envio_turno.php`; el token viaja en `g-recaptcha-response`.
- El backend **valida el token contra Google siteverify**. Evidencia empírica
  (HARs + script `scripts/pedir-turno-biblioteca.mjs`, 30-31/08/2026):

| Prueba | Resultado |
|---|---|
| POST sin token | HTTP 200 — `"No se pudo probar que es un Humano..."` |
| POST con token inventado | Mismo rechazo |
| POST con token real (generado en el dominio original) | ✅ Turno creado |

Hallazgos adicionales del flujo real:

- El POST **requiere User-Agent de navegador**: con otro UA el servidor responde
  body vacío.
- El alta requiere cookie `PHPSESSID` de un `GET /` previo, y el flujo completo
  incluye un "warm-up" (búsqueda de área/temática + consulta de disponibilidad)
  antes del submit.
- **El token no está atado a la sesión PHP**: se genera en una sesión/navegador y
  se consume desde otra (comprobado con el Test 3). Es de un solo uso y expira
  en ~2 minutos.
- La respuesta de éxito es HTML con el texto `"ya se encuentra ingresado"`; no
  hay códigos de estado ni JSON.
- El sistema permite turnos duplicados para la misma persona/fecha/horario (sin
  quejarse) — debilidad del legacy, fuera de nuestro control.

Consecuencia: NewUTNCampus no puede pedir un turno con su propio formulario a
menos que un token válido — generado por el widget de Google **dentro del dominio
original** — llegue al POST.

## 2. Caminos evaluados

| Camino | Resultado | Evidencia |
|---|---|---|
| Renderizar el captcha con la sitekey del legacy en nuestro dominio | ❌ `Invalid domain for site key` (la key está domain-locked) | Consulta directa al `api2/anchor` de Google |
| Iframe del sitio original | ✅ Funciona (el legacy no envía `X-Frame-Options` ni CSP), pero la reserva ocurre enteramente en el sitio viejo | Headers verificados el 30/08/2026 |
| Iframe recortado (solo el captcha) | ❌ Inútil: el token vive en el form del iframe y no se puede leer cross-origin | Política de mismo origen |
| Proxies de framing / reverse proxy (Nginx, willyogo/iframe-proxy) | ❌ Empeoran el captcha: sirven el contenido bajo nuestro origen → `Invalid domain` | Análisis + docs del repo |
| FlareSolverr | ❌ Herramienta equivocada: resuelve desafíos de Cloudflare; el legacy no está detrás de CDN | HARs |
| Bypass / token inventado / fuga del backend | ❌ El backend valida contra Google; no se buscó ni se buscarán vulnerabilidades | Tests A/B |
| Solver comercial (2Captcha) | ❌ Descartado por costo y legitimidad | — |
| Userscript autocompletador | ✅ Viable pero requiere extensión por usuario | Prototipo conceptual |
| **Browser headless que abre el sitio original y el usuario resuelve el captcha a través de un espejo** | ✅ **Solución elegida** | Prototipo funcional en `scripts/captcha-remoto/` |

La solución elegida es legítima por construcción: un humano real resuelve su
propio captcha, en tiempo real, en el dominio real, a través de un navegador
real. No se engaña al mecanismo; se lo opera a distancia.

## 3. La solución: captcha remoto

```
Navegador del usuario              Vercel Function (instancia pinned)
┌───────────────────────┐   WSS    ┌──────────────────────────────┐
│ /biblioteca (form)    │◄────────►│ SesionCaptcha:               │
│ espejo del captcha    │  diffs   │ Playwright + Chromium        │
│ clics locales         │  JSON    │ headless cargando la página  │
└───────────────────────┘          │ ORIGINAL de turnos           │
                                   └──────────────┬───────────────┘
                                                  │ warm-up + POST multipart
                                                  │ + g-recaptcha-response
                                                  ▼
                                     turnos.frsfco.utn.edu.ar:4443 ✅
```

1. El usuario completa el formulario de `/biblioteca` y confirma.
2. Se abre una sesión WebSocket: un Chromium headless carga la página original
   (dominio correcto → el widget renderiza nativo).
3. El usuario tilda "No soy un robot" en el **espejo**; el clic se reenvía al
   widget real. Si aparece el desafío de imágenes, se replica y las selecciones
   se reenvían tile por tile (clics humanizados: curvas de movimiento, jitter y
   delays — Google mide trayectorias).
4. Al resolver, `grecaptcha.getResponse()` devuelve el token → el headless se
   cierra → se llama a `/api/biblioteca/pedir-turno` con el token y los datos
   del form.
5. Esa ruta ejecuta el flujo probado contra el legacy y devuelve el resultado.

### Detalles del espejo (lecciones del prototipo)

- El clic real va a `.recaptcha-checkbox-border` (la capa invisible con el
  handler de Google), no al div contenedor.
- El área del desafío es `#rc-imageselect-target` (ID, no clase), con fallbacks
  por si Google cambia el markup.
- El scroll hasta el widget se hace desde el documento principal
  (`scrollIntoView` sobre el iframe), no dentro del iframe cross-origin.
- El desafío puede ser **multi-ronda**: tras VERIFICAR llegan más imágenes sin
  pasar el captcha. La UI lo comunica ("puede venir otra ronda").
- **Detección por evento, no por polling**: un `MutationObserver` inyectado en
  los iframes del reCAPTCHA (`api2/anchor` + `api2/bframe`) avisa a Node vía un
  binding de Playwright (`window.__captchaEvento`) cada vez que el DOM del
  widget muta. Node coalesce la ráfaga con un debounce corto (~120 ms, tope
  1.2 s), re-serializa la grilla y emite **solo si la firma del DOM cambió**.
  No hay `setInterval` ni re-lecturas temporizadas.
- **Espejo DOM puro, sin screenshots**: si el desafío está visible pero la
  serialización falla (probable cambio de markup de Google), se emite
  `error-widget` — no hay modo screenshot de reserva.
- Selección de tiles con feedback local instantáneo (borde azul + ✔), toggle con
  re-clic, y clic remoto al centro exacto de la celda (`(col+0.5)/filas`).

## 4. Arquitectura en Vercel

Todo corre en Vercel, sin workers externos. Requisitos que se validaron contra
los docs oficiales (ago 2026):

| Requisito | Soporte Vercel | Nota |
|---|---|---|
| WebSocket en Functions | ✅ Beta pública (22/06/2026) vía Fluid compute | `experimental_upgradeWebSocket()` de `@vercel/functions` funciona en Route Handlers de Next; requiere `ws` |
| Sesión pinneada a una instancia | ✅ "A single WebSocket connection is pinned to one Vercel Function instance" | La `SesionCaptcha` vive en memoria de esa instancia |
| Duración | ✅ Techo por defecto 5 min por conexión | El solve tarda 30-120 s |
| Chromium en el runtime | ✅ `@sparticuz/chromium` (~70 MB comprimido, se descomprime en `/tmp`) + `playwright-core` | Bajo el límite de 250 MB sin necesitar large functions |
| Duración del booking | ✅ Route `nodejs` con `maxDuration` | El POST al legacy tarda segundos |

Componentes:

| Pieza | Path | Rol |
|---|---|---|
| Cliente del captcha | `components/biblioteca/CaptchaRemoto.tsx` | Clon visual del reCAPTCHA + espejo WS (checkbox, desafío, selecciones) |
| Ruta WS del captcha | `app/api/captcha/route.ts` | Upgrade + `SesionCaptcha` (una por conexión); solo reenvía |
| Sesión headless | `lib/captchaSesion.ts` | Playwright + Chromium; espejo DOM por evento (`MutationObserver` → binding) |
| Cliente del legacy | `lib/turnosLegacy.ts` | warm-up + POST multipart + clasificación de respuesta |
| Booking | `app/api/biblioteca/pedir-turno/route.ts` | Valida datos + token, llama a `lib/turnosLegacy` |
| Página | `app/biblioteca/page.tsx` | Submit real: captcha → booking → banners |

Variables y configuración:

- `NEXT_PUBLIC_CAPTCHA_WS_URL` (opcional): URL WS alternativa. Si no está, se
  usa `wss://<host>/api/captcha`. Útil en desarrollo local apuntando al worker
  standalone (`scripts/captcha-remoto/server.mjs`), porque el upgrade WS de
  Vercel **no funciona con `next dev`** — localmente hay que usar `vc dev`
  (Vercel CLI ≥ 54.14.2) o el worker standalone.
- `vercel.json`: `"fluid": true` y `functions` con `memory: 2048` /
  `maxDuration: 300` para la ruta captcha.
- Chromium: en producción se usa `@sparticuz/chromium` (Linux); como fallback
  (dev local) el launcher cae al `playwright` completo si está instalado.
- `CAPTCHA_PROXIES` (opcional, opt-in): lista (coma o salto de línea) de
  proxies por los que sale el headless — `host:port` / `http://user:clave@host:port`
  / `socks5://host:port`. Sin la variable, salida directa. Se prueban en
  tandas de 3 y se usa el primero que hace CONNECT a infra de Google. Existe
  porque la IP de datacenter de Vercel arrastra mala reputación con reCAPTCHA
  (bucle infinito de desafíos 4×4). Las listas públicas gratis probaron estar
  muertas/inalcanzables; para una IP **residencial** de verdad hay un helper
  en `scripts/proxy-casero/` (proxy Node + túnel bore desde una PC en una casa).
  `CAPTCHA_PROXIES=off` fuerza salida directa.

## 5. Seguridad

- **El upgrade WS exige sesión de la app**: valida cookie `moodle_user` o
  `sysacadws_auth` y `Origin` del request. Sin eso, nadie externo puede usar
  nuestro headless como solver gratuito.
- **Tope de sesiones simultáneas por instancia** (`MAX_SESIONES_CAPTCHA = 2`):
  cada sesión es un Chromium (~300-500 MB de RAM); limita abuso y OOM.
- `/api/biblioteca/pedir-turno` exige auth por cookie y valida tipos/longitudes
  de los campos antes de tocar el legacy.
- Los tokens no se loguean; el espejo no toca datos personales (el form viaja
  solo por la ruta de booking).
- Límite natural: el token de captcha es de un solo uso y expira en 2 min.

## 6. Implementación (fases)

1. **Fase 0 — Documento** (este archivo).
2. **Fase 1 — Integración** ✅ **GO en producción (31/08/2026)**: WebSocket upgrade
   funcionó en Vercel (`101` en `/api/captcha`), Chromium headless levantó con
   `@sparticuz/chromium` + `playwright-core`, y el captcha se resolvió completo
   (checkbox + rondas de imágenes) desde el espejo. Hicieron falta dos fixes de
   empaquetado: `outputFileTracingIncludes` global + `includeFiles` en
   `vercel.json` (el tracer poda `browsers.json` de playwright-core, requerido
   dinámicamente por `coreBundle.js`). Submit real integrado en `/biblioteca`.
3. **Fase 2 — Espejo DOM** ✅ implementada en esta rama:
   - El server serializa la grilla real celda por celda (data-URLs del
     `background-image` computado) + texto + filas, y re-emite solo cuando la
     firma del DOM cambia.
   - Cliente: grilla por celdas con selección local optimista y merge por
     imagen (imagen nueva = tile reemplazada = deseleccionada; celda `null` =
     tile consumida, gris con ✔).
   - Aviso visible de auto-submit: "Al resolver el captcha se pedirá el turno
     automáticamente con los datos del formulario".
4. **Fase 3 — Espejo por evento + widget fiel** ✅ implementada en esta rama:
   - Se eliminó el polling por `setInterval`: la detección de cambios ahora es
     100% por evento (`MutationObserver` en `api2/anchor` + `api2/bframe` →
     binding `window.__captchaEvento` → debounce ~120 ms en Node → re-lectura
     y emisión solo si cambió la firma). Los desafíos dinámicos (tile que se
     reemplaza al seleccionarla) los capta el observer sin timers.
   - Se eliminó el **modo screenshot** por completo (protocolo, estado del
     server y rama del cliente). El espejo es lectura DOM pura; si el desafío
     está visible y no se puede serializar, se emite `error-widget`.
   - `CaptchaRemoto.tsx` re-estilizado como clon visual fiel del reCAPTCHA de
     Google (caja `#f9f9f9`/`#d3d3d3`, logo SVG, header `#1a73e8` del desafío,
     botón VERIFICAR azul). Sigue siendo no funcional: lo maneja el estado WSS.
5. **Pendiente**: fix del 500 en `POST /api/biblioteca/preferencias` (surfacing
   del error PostgREST agregado; probablemente falten columnas de perfil en la
   tabla — verificar schema en Supabase), "Mis turnos" + cancelación, watcher
   de disponibilidad.
6. **Limpieza**: `scripts/pedir-turno-biblioteca.mjs` queda como herramienta
   local de diagnóstico.

## 7. Riesgos y plan B

| Riesgo | Mitigación |
|---|---|
| WS en beta: condiciones pueden cambiar | El protocolo es simple; el fallback no depende de WS |
| `@sparticuz/chromium` en el runtime de Vercel sin validar en este proyecto | **Spike previo obligatorio** (deploy mínimo, GO/NO-GO antes de construir encima) |
| CPU throttling → solve más lento | Techo de 5 min por conexión; memory 2048 MB |
| Google cambia el markup del widget | Selectores con fallbacks + diagnóstico (`debug/stuck.png` en el worker standalone) |
| La UTN agrega `X-Frame-Options`, cambia el flujo o hardeniza el captcha | Plan B documentado: iframe directo u Opción "relevar token" (bookmarklet + pegar token) — ambos operativos sin infra extra |
| Uso concurrente alto (múltiples Chromium por instancia) | Tope de 2 sesiones por instancia + cola implícita por usuario |

## 8. Cómo testear el deploy en Vercel

### Pre-deploy

- [ ] `vercel.json` commiteado (fluid + memory/maxDuration de la ruta captcha).
- [ ] **`NEXT_PUBLIC_CAPTCHA_WS_URL` NO definida** en el environment de producción (si existe, el cliente apunta a otro lado y la ruta integrada no se usa).
- [ ] Deploy y verificar en el dashboard que el build compila las rutas `/api/captcha` y `/api/biblioteca/pedir-turno`.

### Nivel 0 — Gates sin browser (curl, 1 min)

```bash
curl -s -X POST https://<dominio>/api/biblioteca/pedir-turno -d '{}' -H "Content-Type: application/json"
# esperado: 401 {"ok":false,"mensaje":"Iniciá sesión..."}
curl -s https://<dominio>/api/captcha
# esperado: 401 "No autorizado" (sin cookie de sesión ni WS)
```

### Nivel 1 — WS + Chromium (el spike GO/NO-GO)

1. Logueado en el sitio, `/biblioteca`, completar área/temática/fecha/horario → "Confirmar Turno".
2. Debe aparecer el espejo y pasar de "Conectando" a "No soy un robot" (~5-15 s: cold start + Chromium + carga de la página del legacy).
3. Tildar el checkbox. **Éxito de esta fase = pasa a "Verificando" y aparece el desafío o se tilda solo.**
4. Mirar Runtime Logs (dashboard → Deployments → Functions, filtrar `/api/captcha`): debe loguear `[captcha] clic humanizado en el checkbox`. Si hay excepción de `@sparticuz/chromium` (lib faltante, /tmp sin espacio) → **NO-GO**, revisar logs.
5. Verificar consumo de memoria de la función (memoria configurada: 2048 MB).

### Nivel 2 — Flujo completo end-to-end

1. Resolver todas las rondas del desafío hasta el ✔.
2. El booking sale solo (el token viaja a `/api/biblioteca/pedir-turno`).
3. Banner de éxito con fecha/hora + **mail real de la UTN**.
4. Cancelar el turno (sitio original o `--cancelar` con el código del mail) para no ocupar cupos de la facultad.

### Nivel 3 — Caminos de error

- **Token expirado**: resolver el captcha y dejar pasar 2+ minutos antes de que el front llame al booking (forzar con la pestaña en background) → banner "El sistema rechazó el captcha (posiblemente expiró)".
- **Duplicado**: pedir exactamente el mismo slot dos veces seguidas → el legacy puede aceptar el duplicado (debilidad suya, §1) — verificar el comportamiento real y anotarlo.
- **Sin cupos**: elegir una fecha con la grilla vacía → el botón queda deshabilitado (el select de horarios ya no ofrece opciones).
- **Sesiones concurrentes**: abrir dos pestañas con el captcha a la vez → la segunda recibe el aviso de tope (o comparten instancia, verificando que ninguna se rompa).

### Si algo falla

- Logs: `vercel logs <deployment-url>` o dashboard → Functions → invocaciones de `/api/captcha`.
- Síntoma típico de Chromium roto: error de `executablePath` o libs faltantes al iniciar → probar `@sparticuz/chromium` con `chromium.setGraphicsMode = false` y verificar la versión instalada contra la doc del paquete.
- Síntoma de WS no habilitado: el upgrade responde 4xx/5xx sin llegar a "listo" → revisar que Fluid esté activo para el proyecto y el plan soporte la beta.

## 9. Apéndice: contrato exacto con el legacy

**Request de alta** (todo validado contra HAR del 30/08/2026 19:27):

```
POST https://turnos.frsfco.utn.edu.ar:4443/envio/envio_turno.php
Content-Type: multipart/form-data
Cookie: PHPSESSID=...          (de GET / previo)
User-Agent: (navegador real — obligatorio)
Referer/Origin: https://turnos.frsfco.utn.edu.ar:4443/
```

Campos: `responsable`, `tematica`, `obs`, `datepicker` (dd/MM/yyyy), `horarios`
(vacío), `turnos_lote` (JSON: `[{fecha, idHorario, horarioDesc, idResponsable,
responsableDesc, idTematica, tematicaDesc}]`), `tipoasistencia`,
`tipo_contacto`, `carrera`, `tipo_documento`, `nro_documento`, `nombre`,
`apellido`, `uploadedFile` (vacío), `email`, `telefono`, `localidad`,
`provincia`, `g-recaptcha-response`, `enviar="Solicitar Turno"`.

Warm-up previo (misma sesión): `POST /` con
`resp=<id>/<desc>&tema=<id>/<desc>&bus_turnos=` + `POST /funciones/disponibilidad_horarios.php`
con los mismos ids. Endpoints auxiliares ya proxeados por la app:
`/api/biblioteca/areas|tematicas|horarios`.

**Respuestas**: éxito = HTML con `"ya se encuentra ingresado"` (+ fecha/hora);
captcha rechazado = `alert("Solicitud Fallida!!!.No se pudo probar que es un
Humano...")`; body vacío = UA o sesión inválida.

**Scripts de referencia**: `scripts/pedir-turno-biblioteca.mjs` (flujo de alta),
`scripts/captcha-remoto/server.mjs` (worker standalone + protocolo WS),
HARs en la raíz del repo.
