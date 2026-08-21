-- Preferencias de almacenamiento offline (PWA) por usuario.
CREATE TABLE IF NOT EXISTS offline_preferences (
  username TEXT PRIMARY KEY,
  files_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  onboarding_seen_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
