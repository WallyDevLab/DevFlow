# DevFlow security review

Date: 5 November 2026 · Scope: the whole application as it stands (API, web app,
database access, GitHub integration, CI and local infrastructure).

## How this was done

- **Code review** of every security-relevant path: authentication, token
  handling, authorisation on every endpoint, input validation, the GitHub
  install flow and webhook handler, notifications and email.
- **Pattern search** for dangerous constructs: raw SQL, `eval`, `innerHTML` /
  `dangerouslySetInnerHTML`, browser storage, committed secrets.
- **Live probing** of the running stack: response headers, CORS preflights,
  oversized bodies, published ports.
- **Dependency audit** (`npm audit`) for production and development packages.
- **Exploit-style regression tests** for every fix (`apps/api/test/security.e2e-spec.ts`,
  `e2e/security.spec.ts`). Each fix was also reverted once to confirm its test
  fails without it.

## What was already solid

Verified by reading the code and by existing tests, not assumed:

- **Authorisation is checked on the server for every resource.** Access goes
  through one service; non-members get `404` (so a resource's existence isn't
  revealed). Table-driven tests check that an anonymous caller gets `401` on 25
  endpoints and a non-member gets `404` on 29 (`test/rbac.e2e-spec.ts`), plus
  per-role permission tests.
- **No SQL injection surface.** All queries go through Prisma (parameterised);
  there is no raw SQL in application code.
- **No XSS sinks.** No `dangerouslySetInnerHTML`/`innerHTML`; user text is always
  rendered as text (comments are tested against `<img onerror>`). Label colours
  are validated `#rrggbb`; notification links are validated internal paths.
- **Mass assignment is blocked** (`whitelist` + `forbidNonWhitelisted`).
- **Passwords** are bcrypt-hashed; login treats unknown users and wrong
  passwords identically (same message, comparable timing).
- **Sessions:** short-lived access token held in memory only (never
  `localStorage`); refresh token in an `httpOnly`, `SameSite=Strict` cookie,
  stored hashed, rotated on use, with reuse detection.
- **One-time tokens** (password reset, invitations, GitHub install `state`) are
  random, hashed at rest, single-use and time-limited.
- **GitHub:** webhook signatures use a timing-safe HMAC comparison; deliveries
  are de-duplicated; installs are bound to the signed-in user and verified with
  GitHub, so an installation id can't be claimed by someone who doesn't own it;
  app credentials never leave the server.
- **No secrets in the repository**; `.env` is ignored.
- **Production dependencies: 0 known vulnerabilities.**

## Findings and fixes

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | Medium | The GitHub webhook endpoint had **no rate limit** and parsed up to 5 MB of JSON **before** checking the signature, so an unauthenticated caller could burn CPU/memory. | **Fixed.** The body is read raw, the signature is verified first, then it is parsed; the route is rate-limited. |
| 2 | Medium | Every endpoint, including unauthenticated ones, accepted **5 MB** JSON bodies. | **Fixed.** 100 KB everywhere; only the webhook route allows 5 MB. |
| 3 | Medium | **No security headers** on the API or web app; `X-Powered-By` revealed Express and Next.js. | **Fixed.** `helmet` on the API; on the web app: CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action`, no `eval`), HSTS, `X-Frame-Options`, `nosniff`, referrer and permissions policies. The app is tested running under the CSP with no violations. |
| 4 | Medium | **Rate limiting trusted nothing about proxies.** Behind a reverse proxy every user would share one IP (so 5 failed logins would lock out everyone); without it the limit is meaningless. | **Fixed.** New `TRUST_PROXY` setting (hop count), tested both with and without a trusted proxy; a startup warning appears in production if it is unset. |
| 5 | Medium | **No per-account brute-force protection**, only a per-IP limit that a spread-out attacker avoids. | **Fixed.** 10 consecutive failures lock the account for 15 minutes; a locked account answers exactly like a wrong password; resetting the password clears the lock. |
| 6 | Medium | **No production configuration checks.** A weak or placeholder `JWT_SECRET`, a missing or `http://` web origin, or a forgotten `NODE_ENV` (which disables Secure cookies) would run silently. | **Fixed.** The API now refuses to start in production with a secret under 32 characters or a placeholder, or a non-HTTPS/missing `WEB_ORIGIN`; it warns when `NODE_ENV` is unset. |
| 7 | Medium (dev) | `docker-compose.yml` published **Postgres and Redis on all network interfaces** with default credentials. | **Fixed.** Bound to `127.0.0.1`. |
| 8 | Low | The cookie-authenticated endpoints (`/auth/refresh`, `/auth/logout`) relied only on `SameSite`. | **Fixed.** An `Origin` check refuses requests from any other site. |
| 9 | Low | **bcrypt ignores everything after byte 72**, and the limit was 72 *characters*, so multi-byte passwords were silently truncated. | **Fixed.** Limit is 72 bytes on register, login, reset and change. |
| 10 | Low | JWT algorithms weren't pinned. | **Fixed.** HS256 only (tested with HS384 and `alg: none`). |
| 11 | Low | Pull-request links from webhook payloads were stored and rendered as `href`s without checking the scheme. | **Fixed.** Only `https:` URLs are stored; the UI re-checks before rendering. |
| 12 | Low | Names allowed line breaks and control characters. They are copied into emails and notifications (spoofing / header-injection risk). | **Fixed.** Names and titles are single-line; comments and descriptions still allow line breaks. |
| 13 | Low | A scaffold "Hello World" route was still served. | **Removed.** |
| 14 | Medium | **Email addresses weren't verified.** Invitations are matched by address, so anyone could register an address they don't own and (with an invitation token) join its workspaces. | **Fixed** (follow-up). Sign-up emails a one-time link (24 hours, single-use, hashed at rest, newest link only, one email a minute); **invitations can only be accepted by a verified address**. Completing a password reset also verifies the address. Tested end to end, including the attacker scenario. |

## Residual risks and recommendations

Not fixed in this pass, in rough priority order. (The top item of the first
review, unverified email addresses, is now fixed; see finding 14.)

1. **Tenant isolation is enforced in application code only (Medium,
   defence in depth).** It is thoroughly tested, but a single missed check would
   expose data. Consider Postgres row-level security keyed on workspace.
2. **Unbounded work for authenticated users (Low–Medium).** Comment lists, boards,
   member lists and the analytics endpoint (which loads a project's tasks and
   history into memory) have no pagination or per-user limit. Add pagination and a
   tighter limit on analytics before large workspaces exist.
3. **CSP still allows inline scripts (Low–Medium).** Next.js's bootstrap scripts
   need `'unsafe-inline'` today. Moving to nonce-based CSP would also block
   injected inline scripts.
4. **Security events aren't audited (Low).** Failed logins, lockouts, password
   changes and email verification are not recorded, and the audit log has no
   screen. Add auth events and a viewer for owners/admins; add retention to
   `WebhookEvent`, `Notification` and `AuditLog`.
5. **Lockout can be used to annoy a user (Low).** An attacker who knows an email
   can keep it locked for 15 minutes at a time. This is bounded by the per-IP
   limit (about two minutes per lock) and the owner can always reset their
   password, but alerting the user by email on lockout would help.
6. **No session management (Low).** Users can't see or revoke their devices.
   Password change signs out everywhere else.
7. **Registration reveals whether an email is registered (Low).** The `409`
   response is the usual trade-off. With email verification now in place, sign-up
   can safely return a neutral "check your email" response for existing addresses
   (the existing owner is told by email) if account enumeration matters for your
   threat model.
8. **Concurrent refresh in two tabs can sign the user out (Low, UX).** Reuse
   detection treats it as token theft. The web app already de-duplicates refreshes
   inside one tab.
9. **Password policy is length-only (Low).** Consider a breached-password check.
10. **Development-only advisories (Low).** `npm audit` reports high-severity
    issues in `prisma` (CLI config loader → `deepmerge-ts`) and `@nestjs/mau`
    (`tmp`, `undici`). Neither is a production dependency and CI gates on
    production dependencies. The `prisma` fix needs the Prisma 7 major upgrade;
    plan it deliberately rather than as a patch. Dependabot will keep proposing
    updates.
11. **Backups, restore and secret management** (PRD 9.3) aren't part of the
    application. Keep the GitHub App private key and `JWT_SECRET` in a secret
    manager and rotate them if exposed.

## Deployment checklist

- [ ] Serve everything over **HTTPS** (the proxy terminates TLS; the app sets
      HSTS and Secure cookies in production).
- [ ] `NODE_ENV=production` for the API (and web).
- [ ] `JWT_SECRET`: 32+ random characters (`openssl rand -base64 48`).
- [ ] `WEB_ORIGIN`: the web app's exact `https://` origin.
- [ ] `TRUST_PROXY`: number of proxies in front of the API.
- [ ] `DATABASE_URL`: a dedicated, least-privilege database user; the database is
      **not** reachable from the internet.
- [ ] `SMTP_URL` and `EMAIL_FROM` set, with SPF/DKIM/DMARC on the sending domain.
- [ ] GitHub App: read-only permissions as documented, webhook secret set, webhook
      URL is HTTPS.
- [ ] The email-verification migration marks every **existing** account as
      verified (it predates the feature). If your database already holds real,
      unverified users, delete the final `UPDATE` in
      `20261105030000_email_verification/migration.sql` before deploying.
- [ ] CI branch protection: all five checks required.
- [ ] Backups and a tested restore procedure.
- [ ] Log shipping and alerting for 5xx responses and repeated `429`s.
