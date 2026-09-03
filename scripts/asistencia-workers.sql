-- Monitor del daemon de asistencia (heartbeat cada ~10s).
-- Lo escribe /api/asistencia/worker/heartbeat; lo lee /admin/dashboard.
-- Mismo patrón que scripts/captcha-workers.sql (una fila por worker, los
-- comandos viven como columnas en la fila).

create table if not exists public.asistencia_workers (
  id             text primary key,          -- nombre del worker (-Name, default hostname)
  actualizado    timestamptz not null default now(),
  proceso_desde  timestamptz,
  version        text,                       -- git sha corto
  estado         text not null default 'activo',   -- 'activo' | 'apagado'
  motivo         text,                       -- por qué se apagó (si estado='apagado')
  ram_total_mb   integer not null default 0,
  ram_usada_mb   integer not null default 0,
  -- métricas propias del daemon:
  polls_total    integer not null default 0,
  errores        integer not null default 0,
  login_ok       boolean not null default false,
  ultimo_error   text,
  rt_ultimo_ms   integer not null default 0,   -- duración del GET a apply-leave.php
  rt_prom_ms     integer not null default 0,
  rt_max_ms      integer not null default 0,
  rt_min_ms      integer not null default 0,
  materias_hoy   text,                        -- CSV de nombres detectados hoy
  pushes_hoy     integer not null default 0,
  -- comandos remotos (mismas columnas que captcha_workers):
  comando        text,                        -- 'reiniciar' | 'frenar' | 'arrancar' | null
  comando_nonce  text,
  comando_pedido timestamptz,
  comando_ack    timestamptz,
  comando_por    text
);

create index if not exists asistencia_workers_actualizado_idx
  on public.asistencia_workers (actualizado desc);

-- Solo el service role (backend) toca esta tabla.
alter table public.asistencia_workers enable row level security;
