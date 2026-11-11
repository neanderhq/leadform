# Leadform

A single-owner form builder with public forms, branching, response collection and
CSV exports. This private template starts from production Neander project
`proj_c26d64ac166c`; [onboarding and provenance](docs/template-onboarding.md)
describes the source snapshot and release contract.

Use Node 22.23.2 from `mise.toml`, then run `npm ci`. Copy `.env.example` to `.env`
and configure a local PostgreSQL `DATABASE_URL`, a unique `OWNER_PASSWORD` and a
random `SESSION_SECRET`. Start with `npm run dev`, or `npm start` for the normal
server. Open `http://localhost:3000` and sign in as `admin` with your configured
password. There is no shared default password. Generate local secrets with
`node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`.

`npm run db:seed` creates three fictional forms and five example responses once.
Retries preserve user changes, including deleted forms. Source contains no
customer responses, credentials or database contents.

PostgreSQL stores forms, responses and owner sessions. Startup and seeding use
`db/schema.mjs` with the versioned `db/schema/001-initial.sql`, preserving the
application's existing startup-initialization behavior. Sessions survive server
restarts when the same database and session secret are supplied. Startup never
seeds customer data automatically. `npm run check` checks source syntax and
`npm test` runs local tests.

Normal Publish uses `.neander/compose.yaml`. It requests managed PostgreSQL and
generated owner/session secrets. The entrypoint reads the mounted runtime secret
bundle literally; credentials are not baked into the image. The shared template
workflow verifies this same image and publishes artifacts on main. Consuming a
release to create/deploy a user's project remains a separate product integration.
