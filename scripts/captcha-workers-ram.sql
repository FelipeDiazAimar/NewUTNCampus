-- RAM de la PC del worker en el monitor. Correr en Supabase -> SQL Editor.
alter table public.captcha_workers
  add column if not exists ram_total_mb integer not null default 0,
  add column if not exists ram_usada_mb integer not null default 0;
