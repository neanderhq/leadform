# Verification

Run `npm run verify` after [development setup](development.md). This preserves the
existing app tests and build, and adds the common repository policy check.
The existing JavaScript syntax checks remain the static gate.

## CI gates

- **policy** checks repository identity/files, runtime pins, immutable action pins,
  read-only permissions and the production verification entry point.
- **app** runs the source checks and existing app-specific assertions.
- **Runtime security** (the `production` job) builds the real Docker image,
  scans it with checksum-verified Trivy, initializes a disposable PostgreSQL
  service and runs `npm run test:production`. The alias preserves `test:template`.
- **Dependency audit**, **Dependency review** and GitHub CodeQL remain required.
  Runtime and dependency scans also run daily. Existing additional deployment
  checks remain in their separate workflow where present.

## Production smoke coverage

Owner login, seeded editor, edits during an in-flight save, keyboard focus after adding or moving a question, public branching and validation at 375 CSS pixels, one response from repeated submission activation, responses/CSV, seed retries and database/session persistence after restart.

CI supplies only fictional credentials and an isolated local PostgreSQL service.
`DATABASE_URL` and `NEANDER_TEMPLATE_TEST_DATABASE_URL` must identify the same
explicitly disposable database. Build the image and apply the existing recipe's
migration/seed commands before invoking the smoke suite. `.github/workflows/check.yml`
is the executable setup reference; test credentials there are CI fixtures.
The suite starts/stops its own local app container and writes synthetic records.
Never copy these commands onto an existing customer database.

Passing this CI establishes the assertions in the existing suites, not complete
product acceptance, physical-device/mobile coverage, managed Neon/Cloud Run
deployment, real email delivery or the desktop Neander Publish path. Keep the
README's product-specific limitations. Add regression tests for behavior changes;
do not replace real app checks with boilerplate-only assertions.
