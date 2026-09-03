-- Monitor de workers del captcha remoto (heartbeat cada ~10s).
-- Lo escribe /api/captcha/heartbeat; lo lee /admin/dashboard y /api/captcha/endpoint.

create table if not exists public.captcha_workers (
  id             text primary key,          -- nombre del worker (-Name, default hostname)
  actualizado    timestamptz not null default now(),
  proceso_desde  timestamptz,               -- cuando arranco el worker
  wss_url        text,                       -- tunel actual (trycloudflare)
  version        text,                       -- git sha corto
  estado         text not null default 'activo',   -- 'activo' | 'apagado'
  motivo         text,                       -- por que se apago (si estado='apagado')
  conex_total    integer not null default 0,
  conex_actual   integer not null default 0,
  conex_max      integer not null default 0,
  en_cola        integer not null default 0,
  pool           integer not null default 0,
  errores        integer not null default 0,
  rechazos       integer not null default 0,
  rt_ultimo_ms   integer not null default 0,
  rt_prom_ms     integer not null default 0,
  rt_max_ms      integer not null default 0,
  rt_min_ms      integer not null default 0
);

create index if not exists captcha_workers_actualizado_idx
  on public.captcha_workers (actualizado desc);

-- Solo el service role (backend) toca esta tabla.
alter table public.captcha_workers enable row level security;
