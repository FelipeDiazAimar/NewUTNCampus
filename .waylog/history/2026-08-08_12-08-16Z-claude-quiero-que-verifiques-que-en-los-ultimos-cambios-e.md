# Quiero que verifiques que en los ultimos cambios e
_Exported on 08/08/2026 at 13:31:17 GMT-3 from Claude via WayLog_


**User**

Quiero que verifiques que en los ultimos cambios en http://localhost:3000/dashboard/horarios no quedo nada ligado a ningun usuario especifico ni que con un f12 se pueda ver la relacion con el campus viejo.

---


**Claude**

Ya conocía ese archivo de la sesión de "guest mode" (memoria). Dado que es mock genérico, no hay problema ahí. Ahora reviso el bundle real que llega al navegador para confirmar que ninguna URL del campus viejo se filtra en las respuestas JSON/NDJSON.

---


**Claude**

Sin coincidencias — nada de eso quedó hardcodeado.

## Resultado

Revisé todo lo que cambió en esta sesión (`horarios/page.tsx`, `api/tareas/route.ts`, `asistencia/page.tsx`, `page.tsx`, `tareas/page.tsx`):

**Datos de usuario específico:** ✅ nada hardcodeado. Los `legajo`, `especialidad`, `userid`, etc. se leen siempre de cookies del usuario en sesión (`sysacadws_user`, `moodle_user`), no hay ningún valor fijo pegado en el código.

**Relación con el campus viejo visible por F12:**
- `lib/officialSchedule.ts` (URLs de `sanfrancisco.utn.edu.ar`) y `lib/asistenciaLegacy.ts` (`asistencia.frsfco.utn.edu.ar:4443`) son módulos server-only, usados solo dentro de route handlers (`app/api/...`). Next.js nunca envía ese código al bundle del navegador, así que no aparecen ni en Sources ni en Network.
- Confirmé que los componentes cliente (`asistencia/page.tsx`, `horarios/page.tsx`) solo hacen `fetch` a rutas internas (`/api/...`) y a `api.ipify.org` (para IP pública, no relacionado). Ninguna request del browser toca directamente los dominios viejos.
- Las respuestas JSON/NDJSON de `/api/horarios-oficiales` y `/api/tareas` solo devuelven datos ya parseados (materia, aula, horario, título de tarea) — no filtran la URL de origen.
- Los comentarios que antes nombraban esos dominios (`sanfrancisco.utn.edu.ar`, `asistencia.frsfco.utn.edu.ar`) en `horarios/page.tsx` y `asistencia/page.tsx` ya fueron genericizados en este mismo diff; de todos modos los comentarios no se compilan al bundle, así que no era un riesgo real, solo prolijidad.

No encontré ningún leak. Todo lo sensible al campus viejo queda del lado del servidor.

---
