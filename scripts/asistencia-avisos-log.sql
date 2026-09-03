-- Anti-repetición del aviso de asistencia: una fila por (día, materia).
-- Lo escribe /api/webhooks/asistencia antes de mandar la push.

create table if not exists public.asistencia_avisos_log (
  fecha           date not null,
  materia_id      text not null,
  materia_nombre  text,
  enviado_at      timestamptz not null default now(),
  enviados        integer not null default 0,
  primary key (fecha, materia_id)
);

alter table public.asistencia_avisos_log enable row level security;
