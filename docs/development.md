# Development

The Express server is `server.js`, browser code is `public/`, and schema initialization is `db/schema.mjs`. `project.json` records this published template's identity; it is
not a deployment configuration or an acceptance/payment record.

Use Node 22.23.2 from `mise.toml`.
Run `npm ci` from the repository root. Python 3 and
`python3 -m pip install PyYAML==6.0.3` are also needed for repository/deployment checks.
Follow the existing [README](../README.md) database and environment instructions;
do not substitute a live database for a development database.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Existing local development server |
| `npm run check` | JavaScript syntax checks |
| `npm run test` | Existing app-specific unit and contract tests |
| `npm run test:policy` | Repository, workflow and runtime-pin contract |
| `npm run build` | Existing production build |
| `npm run verify` | All four source checks above, including build |
| `npm run test:production` | Existing built-image smoke suite; isolated database required |

`.neander/compose.yaml` is the deployment recipe; `.neander/Dockerfile` builds
the image. Read `docs/deployment-contract.md` where present and the existing
`.neander/blocks/` guides before extending database/auth capabilities.
`.neander/template.yaml` owns catalog metadata and initialization.
Keep these contracts, migrations, fictional sample data and tests together when
runtime needs change. Local credentials belong in ignored environment files.

Use feature branches and PRs with the included PR template. The default branch
requires passing repository/app/runtime and security checks plus maintainer
review. CODEOWNERS identifies the reviewer; it grants no repository access.
GitHub Actions runs untrusted code with read-only permissions and no saved checkout
credentials. Do not put private publisher/cloud credentials in public workflows.

This existing repository remains public under its current MIT license. New client
projects created from the private starter stay private through delivery review;
their publication is a separate owner decision. Commercial scope, prices and
freelancer negotiations belong outside source repositories.
