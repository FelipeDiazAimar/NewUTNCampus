-- Credenciales de Sysacad cifradas de los usuarios con "Avisar asistencia
-- disponible" activo. Las escribe /api/asistencia/credencial/refresh; las lee
-- (descifradas) /api/asistencia/credenciales para el daemon.
-- El cifrado es AES-256-GCM con clave derivada de SESSION_SECRET (lib/crypto.ts).

create table if not exists public.asistencia_credenciales (
  legajo         text primary key,       -- plano (está en el carnet; ya es path param del WS)
  cred_cifrada   text not null,          -- encryptCred(valor de la cookie sysacadws_auth) = enc(base64("legajo:dni"))
  email          text,                   -- username de Moodle, linkea con perfil_notificaciones
  comisiones     jsonb,                  -- AsistenciaMateria[]; null hasta el 1er descubrimiento del daemon
  comisiones_at  timestamptz,            -- cuándo se refrescó el mapa de comisiones
  strikes        integer not null default 0,  -- descubrimientos consecutivos con 0 comisiones
  visto_at       timestamptz not null default now(),  -- último refresh desde la app
  creado_at      timestamptz not null default now()
);

create index if not exists asistencia_credenciales_visto_idx
  on public.asistencia_credenciales (visto_at desc);

-- Solo el service role (backend) toca esta tabla.
alter table public.asistencia_credenciales enable row level security;
