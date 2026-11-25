ALTER TABLE forms ADD COLUMN IF NOT EXISTS draft_version integer NOT NULL DEFAULT 1;
ALTER TABLE forms ADD COLUMN IF NOT EXISTS published_snapshot jsonb;

-- Existing forms were already live. Backfill once so a later restart can never
-- make a new draft or subsequent edits public.
WITH migration AS (
  INSERT INTO app_settings (key, value) VALUES ('schema_002_form_publication', 'complete')
  ON CONFLICT (key) DO NOTHING
  RETURNING key
)
UPDATE forms SET published_snapshot = jsonb_build_object(
  'version', draft_version, 'title', title, 'description', description,
  'questions', questions::jsonb, 'design', design::jsonb
)
WHERE published_snapshot IS NULL AND EXISTS (SELECT 1 FROM migration);
