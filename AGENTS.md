# Leadform

Leadform is a single-owner form builder. The Express server is in `server.js`,
and the browser app is in `public/`.

- Use Node 22.23.2 from `mise.toml`; install locked dependencies with `npm ci`.
- Configure `DATABASE_URL`, `APP_ORIGIN`, `OWNER_PASSWORD` and `SESSION_SECRET` before starting
  `npm run dev` or `npm start`. There is no shared default password.
- PostgreSQL holds forms, responses and owner sessions. `db/schema.mjs` applies
  the versioned SQL schema at startup; template seeding uses the same initializer.
- `npm run check` checks syntax and `npm test` runs local contract behavior checks.
- `npm run db:seed` initializes fictional data once without resetting user edits.
- See `docs/template-onboarding.md` for built-image verification with a disposable
  database, publication provenance, credential handling and thumbnail generation.
- Preserve the normal form-editor/public-form/response workflows. Do not copy
  production data into template fixtures or claim Cloud Run acceptance from CI.
