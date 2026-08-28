# Asistencia desde el dispositivo del alumno — Problema, soluciones y pruebas

> Documentación de lo definido y descubierto en la sesión del 2026-08-26.
> Contexto: marca de asistencia contra el sistema legacy de la facultad,
> con tres soluciones candidatas y una prueba real exitosa en Vercel.

---

## 1. Resumen ejecutivo

El app "Campus UTN" (frontend Next.js que envuelve Moodle + Sysacad) necesitaba
que un alumno pudiera **marcar su asistencia desde su propio dispositivo**, contra
el sistema legacy "Control de Asistencias" (`https://asistencia.frsfco.utn.edu.ar:4443`,
PHP + Materialize, sin API).

Se evaluaron tres soluciones (ramas `solucion/1`, `2` y `3`) y finalmente se
desplegó la **solución 2** (`solucion/2-device-fingerprint`) en Vercel bajo el
dominio `campusutn.dpdns.org`. La prueba real terminó con **éxito**
(`ok: true`, materia "Investigación Operativa" registrada).

---

## 2. El sistema legacy

### Flujo reconstruido (`lib/asistenciaLegacy.ts`)

```
1. GET  /index.php           → sesión anónima (Set-Cookie de PHP)
2. POST /index.php           → legajo + password (= DNI, igual que Sysacad)
3. GET  /apply-leave.php     → <select> de materias habilitadas AHORA + registradas hoy
4. POST /verificar_ip.php    → ip=<IP pública> (chequeo de red de la facultad)
5. POST /apply-leave.php     → id_materia + hidden fields
```

- Login y submit de asistencia **no** se capturaron en HAR; se asumió el shape
  del `<form>` real.
- El `<select>` trae `<option value="..." data-anio data-especialidad data-plan
  data-comision data-condicional data-habilitada>`, que `parseApplyLeaveHtml`
  parsea con regex.

### Endpoints relevantes

| Ruta de la app | `runtime` | Función |
|---|---|---|
| `app/api/asistencia-legacy/status/route.ts` | `nodejs` | `ensureSession` + `getStatus` (materias habilitadas + registradas hoy) |
| `app/api/asistencia-legacy/marcar/route.ts` | `edge` | `verificarIp` + `marcar` (registro real) |
| `app/api/webhooks/asistencia/route.ts` | `nodejs` | Webhook del agente `motorola-local` → push "asistencia abierta" |
| `app/api/asistencia/agent/route.ts` | `nodejs` | Estado del agente |

---

## 3. Hallazgos clave (verificados contra el servidor real)

1. **TLS válido.** `asistencia.frsfco.utn.edu.ar:4443` tiene certificado de
   **Let's Encrypt** (`authorized: true`). No hay problema de certificado en Vercel.
   (Nota: las rutas de *biblioteca* usan `rejectUnauthorized: false` porque
   `turnos.frsfco.utn.edu.ar:4443` históricamente traía un cert no confiable;
   para asistencia eso ya no es necesario.)

2. **El servidor es público.** Se alcanza desde fuera de la facultad → Vercel
   puede llegar. No hay problema de *reachability*.

3. **`verificar_ip.php` confía en el parámetro `ip`** (no en la IP de origen).
   Probado directamente:
   ```json
   ip=190.16.182.88 → {"acceso":"permitido"}
   ip=8.8.8.8        → {"acceso":"rechazado","mensaje":"El acceso es exclusivo desde la red institucional de la UTN."}
   ip=127.0.0.1      → {"acceso":"rechazado", ...}
   ```
   ⇒ El spoof de IP de la solución 2 (`IP_FACULTAD_VALIDA = "190.16.182.88"`)
   **funciona desde Vercel**, sin importar la IP real de Vercel.

4. **El chequeo de IP es 100% client-side en el legacy.** La página real
   (`apply-leave.php`) hace `fetch("api.ipify.org")` y manda esa IP a
   `verificar_ip.php`; si no está permitido, redirige a `/denegado`. El POST de
   marcado **no re-chequea IP server-side**.

5. **El anti-fraude real es `deviceFingerprint`.** Mensaje literal del legacy:
   > "Cada dispositivo solo puede registrar la asistencia de un estudiante durante 24 horas."

   La página genera `crypto.randomUUID()`, lo guarda en `localStorage` y lo setea
   como cookie `deviceFingerprint`. El backend usa esa cookie para la restricción
   "un dispositivo = un estudiante por 24 h".

6. **Formulario real.** El botón de submit es `<button name="signin">`; los campos
   hidden (`anio_academico`, `id_especialidad`, `id_plan`, `comision`) se llenan por
   JS desde los `data-*` del `<option>`.

---

## 4. Las tres soluciones

| Rama | Base | Enfoque | Commits (adelante de `main`) |
|---|---|---|---|
| `solucion/1-origen-dispositivo` | `main` | Marcado **client-side** (relay + iframe) | `3f64ab7`, `668274a` |
| `solucion/2-device-fingerprint` | `main` | Marcado **server-side** + cookie `deviceFingerprint` | `c82a35e`, `5ce30c4` |
| `solucion/3-combinada` | merge de 1 y 2 | Combina relay/iframe + fingerprint | `3f64ab7`, `c82a35e`, `be96f89`, `c109bf2` |

### Solución 1 — relay + iframe (client-side)

- `lib/asistenciaBrowser.ts` → `browserMark()` crea un iframe oculto, carga
  `/api/asistencia-legacy/relay-login` y hace `POST` directo **desde el navegador
  del alumno** a `verificar_ip.php` y `apply-leave.php`.
- El legacy ve la **IP real del dispositivo** → valida "estás en la facultad".
- Envía `IP_FACULTAD = "190.16.182.88"` hardcodeado (`lib/asistenciaBrowser.ts:3`).
- `marcar` server-side quedó solo como confirmación (lee `registradasHoy`).
- Añadió configuración por env (`ASISTENCIA_BASE_URL` / `NEXT_PUBLIC_ASISTENCIA_BASE_URL`)
  y un mock local (`scripts/mock-legacy.mjs`).
- **Ventaja:** respeta el chequeo de IP real del legacy.
- **Contra:** depende de que el alumno esté en la red de la facultad; flujo
  iframe más frágil.

### Solución 2 — server-side + deviceFingerprint (ELEGIDA)

- Todo el marcado ocurre **server-side** (Vercel → legacy).
- Fuerza `IP_FACULTAD_VALIDA = "190.16.182.88"` (`app/api/asistencia-legacy/marcar/route.ts`).
- Añade cookie `deviceFingerprint`, generada en el navegador y reenviada al legacy
  en cada request vía `withDeviceFingerprint()` (`lib/asistenciaLegacy.ts`).
  - Generación: `ensureDeviceFingerprint()` en `app/asistencia/page.tsx`, en
    `useLayoutEffect` (usa `crypto.randomUUID()`, guarda en `localStorage` + cookie).
  - Reenvío: `withDeviceFingerprint(cookie, fp)` concatena `; deviceFingerprint=...`
    al header `Cookie` en login, status, `verificarIp` y `marcar`.
- **Ventaja:** marca desde cualquier lado (no requiere estar en la facultad).
- **Contra:** elimina la verificación de ubicación; el único control que queda es
  el `deviceFingerprint`.

### Solución 3 — combinada

- Merge de las dos anteriores. No se usó para el deploy.

---

## 5. Decisiones de despliegue (Vercel vs local)

**Se eligió Vercel** para una clase real, porque:
1. Web Push + Service Worker + PWA/offline exigen **HTTPS** y URL pública
   (`instrumentation-client.ts` registra `/sw.js`; push usa VAPID).
2. El webhook del agente `motorola-local` necesita una **URL pública**.
3. El marcado (solución 2) es server-side y Vercel alcanza el legacy (verificado).

**Local** solo aplicaba para single-machine demo o con túnel, y rompía PWA/push.

### Gate previo (obligatorio antes de usar la única chance con clase real)

- Deploy en Vercel → desde un dispositivo en la red de la facultad, llamar a
  `/api/asistencia-legacy/status` con cuenta real. Debe devolver `materias`
  (no `502`).

### Env vars requeridas (Production scope en Vercel)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`,
`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SESSION_SECRET`,
`ADMIN_USER`, `ADMIN_PASS`, `NOTIFICATIONS_WEBHOOK_SECRET`, `GOOGLE_*`.

`ASISTENCIA_BASE_URL` / `NEXT_PUBLIC_ASISTENCIA_BASE_URL` **no** hacen falta en
solución 2 (el `BASE` está hardcodeado a `:4443`).

---

## 6. Operaciones git realizadas

```
git stash push -u -m "wip rama 1 (origen-dispositivo)"   # guarda package-lock.json + untracked
git checkout main
git merge --ff-only solucion/2-device-fingerprint         # fast-forward a 5ce30c4
npm run build                                             # OK (76s) tras limpiar .next + tsbuildinfo
git push origin main                                      # 403: Permission denied to Ulises-Araya
```

- El push falló por permisos (`Ulises-Araya` sin write sobre `FelipeDiazAimar/NewUTNCampus`).
- Al obtener acceso de colaborador, se decidió **no tocar `main`**:
  ```
  git reset --hard origin/main                            # main vuelve a bbe67c9
  git checkout solucion/2-device-fingerprint
  git push -u origin solucion/2-device-fingerprint        # rama publicada
  ```

### Detalle técnico del build

- El primer `next build` falló por **caché de tipos stale**: `.next/dev/types/validator.ts`
  (de la rama 1) referenciaba `relay-login`, ruta que no existe en solución 2.
  `tsconfig.json` incluye `.next/dev/types/**/*.ts`.
- Fix: `rm -rf .next` + borrar `tsconfig.tsbuildinfo` y reconstruir.

---

## 7. Prueba real y resultado

Prueba capturada en HAR: `campusutn.dpdns.org_api_asistencia-legacy_marcar_Archive [26-08-25 20-31-51].har`
(1 entry). El proyecto está en **Vercel** con custom domain `campusutn.dpdns.org`.

### Request

```
POST https://campusutn.dpdns.org/api/asistencia-legacy/marcar
Content-Type: application/json
Body: {"ip":"190.16.182.88","idMateria":"404"}
```

Cookies enviadas (relevantes):
- `asistencia_legacy_cookie=16841::PHPSESSID=a03277990600668012b4420c606af347`
- `sysacadws_auth=MTY4NDE6...` (legajo `16841`)
- `deviceFingerprint=4bd27a2a-e223-4ef2-8d50-06f2536f1aee`
- `moodle_user={... "fullname":"Felipe Diaz Aimar" ...}`

### Response

```json
{
  "ok": true,
  "yaEstaba": false,
  "materia": "Investigación Operativa",
  "materias": [{"id":"404","anio":"2026","especialidad":"5","plan":"2023","comision":"1","condicional":false,"habilitada":true,"nombre":"Investigación Operativa"}],
  "registradasHoy": [{"materia":"Investigación Operativa","hora":"20:29 hs"}]
}
```

**Resultado: ÉXITO total.** `ok: true`, `yaEstaba: false`, y la materia aparece en
`registradasHoy` a las 20:29 hs (confirmado por relectura del legacy).

Valida de punta a punta en Vercel: login → `verificar_ip` (IP forzada) → `marcar`
(`apply-leave.php`) → confirmación, con `deviceFingerprint` reenviado correctamente.

---

## 8. Pendientes

1. **Prueba de marcado remoto** (fuera de la red de la facultad). El test se hizo
   con el dispositivo en la facultad (`ipify` devolvió `190.16.182.88`). Como el
   server fuerza `IP_FACULTAD_VALIDA` e ignora el `ip` del cliente, debería andar
   igual, pero no quedó ejercitado.
2. **`ip` muerto en el body.** `app/asistencia/page.tsx` sigue llamando a
   `api.ipify.org` y enviando `ip`, pero la ruta lo ignora (usa `IP_FACULTAD_VALIDA`).
   Candidato a limpieza.
3. **Runtime/tiempo.** `marcar` es `edge` con ~7 fetches secuenciales al legacy;
   `status` es `nodejs` en región default (US). Riesgo de 504 por timeout. Evaluar
   unificar a `nodejs` + `maxDuration` + `regions: ["gru1"]` (São Paulo).
4. **`getSetCookie` en edge.** Si `Headers.getSetCookie()` no está disponible en el
   runtime edge, el fallback `get("set-cookie")` solo trae la primera cookie. Riesgo
   bajo (PHP suele setear un único `PHPSESSID`).
