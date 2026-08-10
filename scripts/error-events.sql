-- Registro de errores de toda la app (cliente + servidor), append-only.
-- Ver docs/superpowers/specs/2026-08-10-error-tracking-design.md
create table error_events (
  id bigserial primary key,
  severity text not null check (severity in ('critical', 'error', 'warning')),
  source text not null check (source in ('client', 'server')),
  message text not null,
  stack text,
  section text,
  console_log jsonb,
  request_info jsonb,
  user_agent text,
  created_at timestamptz not null default now()
);
create index error_events_created_at_idx on error_events (created_at);
create index error_events_severity_idx on error_events (severity);
