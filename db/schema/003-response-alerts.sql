ALTER TABLE forms ADD COLUMN IF NOT EXISTS alerts_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS response_alerts (
  response_id TEXT PRIMARY KEY REFERENCES responses(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','sending','accepted','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  provider_id TEXT
);

CREATE INDEX IF NOT EXISTS response_alerts_available_idx ON response_alerts (available_at)
  WHERE state IN ('queued','sending');
