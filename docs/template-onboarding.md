# Form Builder template

Current release process: this MIT-licensed application runs app checks and builds
in its own CI. Neander maintainers manually verify and publish template releases
from private CI; contributors need no private workflow or publishing credentials.
The workflow pins and publication runs below describe the original onboarding.
See the repository README for current local setup and contributor instructions.


## Provenance and scope

The initial GitHub commit `5685a6f305df8ad6da91119389fc6795008e707c` is a byte-for-byte
copy of the 13 source files from production Neander Git project
`proj_c26d64ac166c`, commit `d3ad6e5ef2649610639df0c6b53bc64908e3f253`.
That was both the project main and deployed commit when extracted. The original
production project and deployment remain unchanged. No production database data
was copied.

This onboarding preserves the form editor, branching, public form submission,
response list and CSV export. It keeps the existing PostgreSQL tables and session
store, removes the local-database fallback, and requires configured owner/session
secrets instead of a shared default password. The login hint for the old default
was removed. The inherited `body-parser` dependency was updated within Express's
compatible range to 1.20.9 to address GHSA-27r3-jxmh-p828. Other production
dependencies remain resolved through the checked-in lockfile.

## Contract and initialization

The catalog ID is `leadform`, with display title **Form Builder**. The manifest in
`.neander/template.yaml` declares metadata, commands, seed and screenshot. The
Compose recipe remains the normal publishing definition for the Express app.
Its environment requires a provisioned PostgreSQL `DATABASE_URL`, generated
`OWNER_PASSWORD` and generated `SESSION_SECRET`. Sign in as `admin`; the project
owner must receive their generated password through the provisioning consumer.
Do not put that password in the public catalog, screenshot or browser assets.

This app already creates schema at startup. Its shared `db/schema.mjs` initializer
applies versioned SQL under a PostgreSQL transaction/advisory lock. Both startup
and the seed command call it, so fresh verification and normal Publish execute
the same schema code. The recipe intentionally declares no Drizzle/Alembic
migration profile; it does not use either stack. Future schema changes should
extend this initializer with versioned migrations as required.

The seed contains Project enquiry (including a branch that skips the budget
question), Workshop feedback and Community meetup. All five sample responses
are fictional; email addresses use `example.invalid`. A transaction and advisory
lock protect first initialization. The completion marker is stored separately
from forms, so retries also preserve deleted sample forms, changed titles and new
submissions. Normal app startup never invokes the sample-data seed.

## Verify and publish

Use Node 22.23.2 and a disposable PostgreSQL database:

```sh
export NEANDER_TEMPLATE_TEST_DATABASE_URL='postgresql://template:template@127.0.0.1:55490/template_check'
export NEANDER_TEMPLATE_TEST_ORIGIN='http://127.0.0.1:18091'
neander-template check .
neander-template verify .
# Commit first; output must be outside the repository.
neander-template prepare-release . --output /tmp/leadform-template-release
```

The shared runner installs locked dependencies, checks syntax/startup behavior,
builds Linux/amd64, then seeds and verifies the built image. Seed initializes the
schema using the same helper as startup. Browser checks cover owner login, the
seeded dashboard/editor, a persisted edit, public form branching and submission,
invalid input rejection, response display and CSV download. Concurrent seed
retries must preserve the edit, submission and a deleted sample form. Container
restart must preserve the owner session, edit and submission. The verifier mounts
the actual `/run/secrets/neander_environment` bundle read by the entrypoint.
It cleans up its own app container and temporary secret bundle; the caller owns
and must remove the disposable database.

The verifier installs its pinned Chromium browser and Linux dependencies when
needed. Linux CI uses host networking; Docker Desktop on macOS uses
`host.docker.internal` for the local test database. These are local/container
checks, not production Cloud Run or managed Neon acceptance.

`.neander/thumbnail.png` is an actual screenshot of the seeded application.
Set `NEANDER_TEMPLATE_SCREENSHOT` to an absolute PNG path during verification to
regenerate it. Regular CI leaves the committed screenshot unchanged.

The caller pins the shared workflow to
`a4835cf2d2ce09b9462610107bdd022efd1b36c8`; its private installer remains pinned to
`620f1f00f9cd3509bd0920e74a19055826581ea4`. PRs verify only. Successful main pushes
publish the tested image digest to Artifact Registry, thumbnail/release JSON to
GCS, then register `catalog/leadform.json`. All destinations/auth references come
from the six organization `TEMPLATE_*` variables. Source is referenced by this
GitHub repository and exact commit; no source archive is published. Verification
reports are GitHub Actions artifacts.
