# DevFlow

Developer-focused project management that connects Agile planning (Kanban,
backlog, sprints) with real GitHub activity.

- `apps/web` – Next.js + TypeScript + Tailwind
- `apps/api` – NestJS + Prisma + PostgreSQL

## Running locally

```bash
docker compose up -d postgres        # Postgres on localhost:5433
cp apps/api/.env.example apps/api/.env   # then set JWT_SECRET
npm install
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run dev                          # API on :4000, web on :3000
```

Postgres is mapped to port **5433** so it doesn't clash with a local install on 5432.

## Security

See [docs/security-review.md](docs/security-review.md) for the review, what was
fixed, the remaining risks, and a **deployment checklist**. In short, for a
production deployment:

- `NODE_ENV=production`, a random 32+ character `JWT_SECRET`, and `WEB_ORIGIN` set
  to the web app's `https://` origin. The API **refuses to start** otherwise.
- Set `TRUST_PROXY` to the number of reverse proxies in front of the API, or rate
  limits will treat all users as one client.
- Keep the database private, and the GitHub App key and `JWT_SECRET` in a secret
  manager.

## Testing

| Command | What it runs |
| --- | --- |
| `npm test` | API unit + integration tests with coverage, then web tests with coverage |
| `npm run test:e2e` | Playwright browser tests (see below) |
| `npm run lint` · `npm run typecheck` · `npm run format:check` | Static checks |
| `npm run format` | Auto-format with Prettier |

**API integration tests** (`apps/api/test`) boot the real NestJS app and talk to a
real Postgres through HTTP (supertest). They use a separate database,
`devflow_test` (`TEST_DATABASE_URL`, default
`postgresql://devflow:devflow@localhost:5433/devflow_test`), which the test setup
creates, migrates and empties on every run. It refuses to run against any
database whose name doesn't contain `test`. Start Postgres first:
`docker compose up -d postgres`. Email is captured in memory, GitHub is
replaced by a local mock, and rate limiting is switched off (only when
`NODE_ENV=test`).

Coverage must stay above 80% lines/statements/functions for the business logic
(services, analytics maths, auth guard); `npm test` fails below that.

**Browser tests** (`e2e/`) drive Chrome through the real UI. In CI they start
their own servers. Locally, against servers you already run:

```bash
E2E_SKIP_SERVERS=1 E2E_WEB_URL=http://localhost:3000 PW_CHANNEL=chrome npx playwright test
```

`PW_CHANNEL=chrome` reuses the Chrome you have installed; without it Playwright
needs its own browser (`npx playwright install chromium`). Your dev API rate-limits
sign-ups (5 per minute), so wait a minute between runs against it.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and push to `main`:

1. **quality**: lint, Prettier check, TypeScript, Prisma schema validation, and
   production builds of both apps
2. **api-tests**: unit + integration tests against a Postgres service, with the
   coverage threshold
3. **web-tests**: component and unit tests
4. **e2e**: Playwright against freshly built servers
5. **security**: `npm audit` on production dependencies (high/critical fail)

Make these required checks in the repository's branch protection settings so a
failing check blocks merging. Dependabot (`.github/dependabot.yml`) opens weekly
update PRs.

## Email

Email confirmation links, password reset, "password changed" notices and workspace invitations send email.

- **Without `SMTP_URL`** (the default in development) nothing leaves your machine:
  each email is printed to the API console, including its one-time link, so you
  can copy the link into the browser. In production an unconfigured server logs a
  warning and does **not** print message bodies.
- **With `SMTP_URL`** (e.g. `smtps://user:password@smtp.example.com`) mail is sent
  through that server. Set `EMAIL_FROM` and, if the web app isn't on
  `WEB_ORIGIN`, `WEB_URL` (used to build the links).

**Email verification.** New accounts get a confirmation link (valid 24 hours, single use). Until the address is verified the account works normally, but **workspace invitations can't be accepted**; a banner explains this and offers a new link. Finishing a password reset also verifies the address. In development the link is printed in the API console like the other emails. Accounts that existed before this feature were marked verified by its migration.

Reset links expire after 1 hour, work once, and only the newest one is valid.
Resetting or changing a password signs the account out on every other device.

## GitHub integration

DevFlow talks to GitHub through a **GitHub App** (scoped, per-repository
access) rather than a personal access token. The integration stays disabled,
and the UI says so, until all six `GITHUB_*` variables in `apps/api/.env` are set.

### 1. Create the app

GitHub → Settings → Developer settings → GitHub Apps → **New GitHub App**
(for an organisation, create it under the organisation's settings).

| Field | Value |
| --- | --- |
| Homepage URL | your web URL, e.g. `http://localhost:3000` |
| Callback URL | `<web URL>/integrations/github/callback` |
| Setup URL | `<web URL>/integrations/github/callback` |
| Request user authorization (OAuth) during installation | **on** |
| Webhook URL | `<public API URL>/api/v1/integrations/github/webhooks` |
| Webhook secret | a long random string (you'll reuse it below) |

**Repository permissions** (read-only is enough): Pull requests, Checks,
Metadata. **Subscribe to events**: Pull request, Pull request review, Check
suite. (Installation events are delivered automatically.)

GitHub can't reach `localhost`, so for local development expose the API with a
tunnel (for example `cloudflared tunnel --url http://localhost:4000` or ngrok)
and use that URL for the webhook.

### 2. Configure DevFlow

After creating the app, note the **App ID** and the app's URL slug
(`github.com/apps/<slug>`), generate a **private key** (downloads a `.pem`),
and copy the **Client ID** and a generated **Client secret**.

```
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=     # contents of the .pem; \n escapes allowed
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_WEBHOOK_SECRET=      # same value as the app's webhook secret
```

Restart the API. These values are only ever read by the API; they are never
sent to the browser or logged.

### 3. Connect

1. Workspace page → **Integrations → Connect GitHub** (owners and admins).
2. Choose the account and repositories to share, then approve.
3. Open a project's board → **Link GitHub repository**.
4. Put the task key in a branch name or pull request title/description, e.g.
   `feature/DEV-124-auth-api`. The pull request appears under **Development**
   on that task, with review and CI status kept up to date by webhooks.

### Security notes

- Webhooks are accepted only with a valid `X-Hub-Signature-256` (HMAC-SHA256 of
  the raw body); anything else is rejected before being stored.
- Each delivery is recorded by its `X-GitHub-Delivery` id, so redeliveries never
  create duplicate records.
- Completing an install requires the signed-in GitHub user to be able to see
  that installation (checked through GitHub's OAuth flow), so an installation id
  can't be claimed by someone who doesn't own it.
- Disconnecting uninstalls the app on GitHub's side as well as locally.
