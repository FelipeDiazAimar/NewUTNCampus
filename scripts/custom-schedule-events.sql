-- Horarios personalizados del alumno (Supabase / PostgreSQL)
CREATE TABLE IF NOT EXISTS custom_schedule_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     TEXT NOT NULL,                -- moodle userid del dueño del evento
  title       TEXT NOT NULL,
  description TEXT,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=domingo … 6=sábado
  start_time  TEXT NOT NULL,                -- "HH:MM"
  end_time    TEXT NOT NULL,                -- "HH:MM"
  color_hex   TEXT NOT NULL DEFAULT '#007aff',
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_schedule_events_user ON custom_schedule_events (user_id, day_of_week);
