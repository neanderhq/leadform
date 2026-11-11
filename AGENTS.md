# Leadform

Leadform is a single-owner form builder. The Express server is in `server.js`, and the browser app is in `public/`.

## Development setup

- Install the locked dependencies with `npm ci` from the project root.
- Start the local app with `npm run dev` from the project root.
- The production-style start command is `npm start`.
- The app uses SQLite at `data/leadform.sqlite` by default; `DATA_DIR` and `DATABASE_PATH` are optional overrides.
- `SESSION_SECRET` is generated and stored in the SQLite database when it is not provided. `OWNER_PASSWORD` defaults to `leadform123`, and the login page shows that default only in development.
- Do not claim that Publish preserves the default `data/` directory across redeploys unless the platform confirms it; no Publish-specific persistent storage configuration is present in this workspace.

The npm scripts in `package.json` are the runnable app entry points; `README.md` has additional local usage notes.
