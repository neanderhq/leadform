# Leadform

A neutral, single-owner form builder with public forms, branching, and CSV exports.

## Run locally

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. Sign in as `admin` / `leadform123`; the default is displayed on the sign-in page only in development. `npm start` runs the production-style server and listens on the platform's `PORT` (or port `3000` locally). `npm run build` checks the JavaScript syntax; this app has no separate asset-compilation step.

Set `OWNER_PASSWORD` to replace the default owner password. If `DATABASE_URL` is set to a PostgreSQL connection string, the app creates its forms, responses, settings, and session tables in that database at startup. Owner sessions are stored in PostgreSQL so they work across server restarts and instances. Without `DATABASE_URL`, the app uses SQLite at `data/leadform.sqlite`; `DATA_DIR` or `DATABASE_PATH` can override that location, and sessions use Express's default in-memory store. If `SESSION_SECRET` is not provided, a random secret is generated once and stored in the selected database so it is reused after a restart. Switching from SQLite to PostgreSQL does not copy existing forms or responses; migrate data separately if needed. The login page displays the default only when `NODE_ENV=development`; `npm run dev` sets this automatically. The default password is not displayed in production, but it remains the default unless `OWNER_PASSWORD` is configured. Because this password is weak, do not expose a production deployment publicly unless the Publish environment can set a replacement password.

Forms and completed submissions are stored server-side, not in browser storage. For deployments that provide PostgreSQL, set `DATABASE_URL` to use durable database storage rather than relying on the container's local SQLite file. This workspace contains no Neander Publish storage configuration or evidence about how to provision or attach a database, so configure the connection string through the platform and confirm its retention behavior there.
