-- Fase 2: comandos remotos al supervisor del worker (reiniciar / frenar /
-- arrancar) desde /admin/dashboard, sin SSH. El supervisor hace polling de
-- GET /api/captcha/comando y confirma con POST.
--
-- Correr DESPUES de scripts/captcha-workers.sql.

alter table public.captcha_workers
  add column if not exists comando         text,          -- 'reiniciar' | 'frenar' | 'arrancar' | null
  add column if not exists comando_nonce   text,          -- id unico del pedido
  add column if not exists comando_pedido  timestamptz,   -- cuando lo encolo el admin
  add column if not exists comando_ack     timestamptz,   -- cuando lo confirmo el supervisor
  add column if not exists comando_por     text;          -- quien lo pidio (info)
