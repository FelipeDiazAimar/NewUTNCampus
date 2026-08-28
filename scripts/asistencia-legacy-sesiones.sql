-- Caché de sesiones del sistema legacy de asistencias (asistencia.frsfco.utn.edu.ar:4443).
-- Ver lib/asistenciaLegacySesiones.ts.
--
-- La "sesión" es la cookie PHP empaquetada que hoy vive solo en el navegador
-- (asistencia_legacy_cookie = legajo::PHPSESSID=...). Al persistirla por legajo,
-- cuando alguien cierra sesión y entra con otra cuenta, cada legajo recupera su
-- propia cookie si sigue viva, evitando el login completo contra el legacy.
--
-- TTL de 20 horas: heurística de vida útil. La alividad REAL siempre se verifica
-- contra el legacy antes de reusar (fetchApplyLeave) — si expiró antes, se hace
-- login fresco y se sobrescribe la fila.
create table asistencia_legacy_sesiones (
  legajo     text primary key,
  cookie     text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '20 hours')
);
