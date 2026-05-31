-- Notification settings schema (Supabase)
CREATE TABLE IF NOT EXISTS perfil_notificaciones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  telegram_chat_id TEXT,
  telegram_link_code TEXT,
  notificaciones_globales_activas BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notificaciones_materias (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  perfil_id UUID REFERENCES perfil_notificaciones(id) ON DELETE CASCADE,
  materia_nombre TEXT NOT NULL,
  materia_activa BOOLEAN DEFAULT TRUE,
  notificar_nuevas BOOLEAN DEFAULT TRUE,
  notificar_cierre BOOLEAN DEFAULT TRUE,
  notificar_vencimiento BOOLEAN DEFAULT TRUE,
  dias_anticipacion_vencimiento INT DEFAULT 1,
  UNIQUE(perfil_id, materia_nombre)
);
