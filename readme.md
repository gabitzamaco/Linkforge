# Linkforge

A URL shortener built with React, Express, and Neon serverless Postgres. Create short links with generated or custom codes, copy them from the dashboard, edit their destinations, track redirect counts, and delete links you no longer need. Links and statistics live in Postgres and survive server restarts.

## Requirements

- Node.js 24 or newer and npm.
- A Neon project with pooled and direct Postgres connection strings. The backend uses `@neondatabase/serverless` over HTTPS; no local database server is required for development or tests.
- Run commands from the repository root.

## Quick start

```sh
npm install
cp .env.example .env
# Replace DATABASE_URL and DATABASE_URL_UNPOOLED in .env with your Neon URLs.
npm run db:migrate
npm run dev
```

Open **http://127.0.0.1:5173**. The Vite development server forwards API and redirect requests to Express on port **3000**. The dashboard displays short URLs served by Express, so keep both servers running.

For PowerShell, copy `.env.example` to `.env` before editing its connection strings:

```powershell
Copy-Item .env.example .env
```

| Variable                | Default                 | Purpose                                                                        |
| ----------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| `PORT`                  | `3000`                  | Express listening port. Keep port 3000 for the default Vite proxy.             |
| `HOST`                  | `127.0.0.1`             | Express bind address; use `0.0.0.0` only when network access is intended.      |
| `DATABASE_URL`          | Required                | Pooled Neon Postgres connection string used by the backend over HTTPS.         |
| `DATABASE_URL_UNPOOLED` | Required for migrations | Direct Neon Postgres connection string, without `-pooler` in the hostname.     |
| `BASE_URL`              | Request origin          | Public origin for generated links; set an HTTPS origin behind a reverse proxy. |

The example file sets `BASE_URL=http://127.0.0.1:3000`. Keep `.env` and `.neon` out of version control. Database credentials belong only in backend environment settings; never use a `VITE_` prefix or include them in the frontend.

If the Neon CLI is already signed in, refresh this project's credentials with `neon env pull --service postgres --file .env`. When connecting a different machine, first run `neon link --project-id <your-project-id> --no-env-pull -y`. After claiming a temporary project, relink the same project and pull credentials again because the old database password is rotated.

## Commands

| Command                                         | Purpose                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                                   | Run the React frontend and API together with development reload. |
| `npm run build`                                 | Create the production frontend in `frontend/dist/`.              |
| `npm start`                                     | Run Express and serve the built frontend on port 3000.           |
| `npm run db:migrate`                            | Apply versioned SQL migrations using the direct Neon URL.        |
| `npm run db:import:sqlite -- data/links.sqlite` | Import an existing SQLite database and verify saved values.      |
| `npm test`                                      | Run HTTP API integration tests using Node's test runner.         |
| `npm run lint`                                  | Check JavaScript and JSX style and correctness.                  |
| `npm run format:check`                          | Check formatting without modifying files.                        |

For a local production build:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:3000**. Build again after changing the frontend.

## Project structure

```text
frontend/
  index.html          Browser entry point
  src/                React dashboard components and CSS
  vite.config.js      Development proxy and frontend build
backend/
  src/                Express routes, Neon queries, migrations, import logic, and server startup
  migrations/         Versioned Postgres SQL schema changes
scripts/              Schema migration and one-time SQLite import commands
api/index.js          Vercel Function entry point for the existing Express API
vercel.json           Vite build output and API/short-link routing on Vercel
.vercelignore         Excludes local credentials, databases, tools, and test files from uploads
tests/
  api.test.js         HTTP integration and Postgres persistence tests
  database.test.js    Migration, import, concurrency, and failure handling tests
  helpers/            Embedded Postgres test database adapter
  vercel.test.js      HTTPS short URL behavior for production and preview deployments
  dev.test.js         React module loading and development proxy regression test
data/                 Original SQLite files retained for migration/backup; ignored by Git
.env.example          Safe configuration examples
AGENTS.md             Contributor guidelines
```

## API

All API requests and responses use JSON except successful deletion (`204`). Errors return `{ "error": "Description" }`.

| Method   | Path               | Behavior                                                                                                                                         |
| -------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/health`      | Return `{ "status": "ok" }`.                                                                                                                     |
| `GET`    | `/api/links`       | Return `{ "links": [...] }`, newest first.                                                                                                       |
| `POST`   | `/api/links`       | Create a link from `{ "url": "https://example.com", "customCode": "my-link" }`; `customCode` is optional. Return `201` with `{ "link": {...} }`. |
| `PATCH`  | `/api/links/:code` | Update the destination with `{ "url": "https://example.com/new" }`. Return `200` with `{ "data": {...} }`; unknown codes return `404`.           |
| `DELETE` | `/api/links/:code` | Delete a link and return `204`; unknown codes return `404`.                                                                                      |
| `GET`    | `/s/:code`         | Record a click and return a `302` redirect; unknown codes return `404`.                                                                          |

Each link includes `id`, `code`, `url`, `shortUrl`, `createdAt`, `clicks`, and nullable `lastClickedAt`. Destinations must be absolute HTTP or HTTPS URLs without embedded credentials. Custom codes are case-sensitive and contain 3–32 letters, digits, underscores, or hyphens. Invalid input returns `400`; a code already in use returns `409`. A `HEAD` request to a short URL checks the redirect without incrementing the click count.

Updates change only the destination URL. The short code, creation date, and click statistics are preserved, and the existing short URL immediately redirects to the new destination. Updates use the same destination validation as creation; invalid updates return `400` without changing the saved link.

PowerShell example:

```powershell
$body = @{ url = 'https://example.com/articles'; customCode = 'articles' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3000/api/links -Method Post -ContentType 'application/json' -Body $body
Invoke-RestMethod http://127.0.0.1:3000/api/links
curl.exe -I http://127.0.0.1:3000/s/articles
$update = @{ url = 'https://example.com/new-articles' } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:3000/api/links/articles -Method Patch -ContentType 'application/json' -Body $update
Invoke-RestMethod http://127.0.0.1:3000/api/links/articles -Method Delete
```

## Testing

`npm test` starts real HTTP servers on ephemeral loopback ports and uses PGlite (embedded Postgres) with the same SQL migrations and queries as Neon. Tests use isolated memory or temporary disk storage and never use your Neon credentials. They cover creation, updates, validation, custom-code conflicts, redirects and click counts, deletion, error handling, persistence across restarts, repeatable migrations, and SQLite import verification. A development-server regression test verifies that React modules load as JavaScript while API and short-link requests reach Express. Tests do not follow redirects to external destinations. No coverage threshold is configured. These tests validate Postgres behavior locally; they do not test Neon network availability or account permissions.

## Migrating existing SQLite data

1. Stop the old Linkforge server and other writers so its SQLite snapshot and click counts stay stable.
2. Back up the SQLite database using SQLite's backup API or copy it after all connections close. Preserve any WAL files when copying an active database.
3. Add the Neon URLs to `.env` and run `npm run db:migrate`.
4. Run `npm run db:import:sqlite -- data/links.sqlite` (or supply your old file's path).
5. Confirm the reported source-row verification count, then run `npm run dev` or `npm start`.

The importer opens SQLite read-only, preserves short codes, destinations, timestamps, click counts, and equal-timestamp ordering, and checks every source record against Postgres. Repeating the import skips identical records. A conflicting code with different data stops the preflight without overwriting it. Keep other writers stopped until verification completes. The source file is never deleted. `DATA_FILE` is accepted only as an optional legacy import source, not as application storage.

The app requires `DATABASE_URL` and a migrated schema; there is no fallback to a local or in-memory application database. Health checks return `503` if the database or application table is unavailable. Schema changes are explicit deployment steps rather than automatic startup mutations. Test future migrations on a Neon child branch before applying them to your main branch.

For manual verification, create a link, copy and open it, and refresh the dashboard to see the updated count. Click **Edit** on the link, enter a new destination, and choose **Save changes**. Open the same short URL to verify it redirects to the new destination. Canceling an edit should leave the saved destination unchanged. Finally, delete the link and check that its short URL returns `404`.

## Deployment and data

### Vercel

Deploy from the repository root. `vercel.json` selects the Vite framework, runs `npm run build`, and publishes `frontend/dist/`. The frontend is served as static files; requests to `/api/*` and `/s/*` run the existing Express application through `api/index.js` as a Vercel Function. The local server entry point is not used on Vercel.

1. Import this repository into a Vercel project, or link it using the Vercel CLI.
2. Add `DATABASE_URL` as a server-side **Production** environment variable using the pooled URL for the existing Neon main branch. Use an isolated Neon branch if enabling Preview deployments for development.
3. Ensure the database migrations have been applied using the direct connection (`npm run db:migrate`). The deployment does not run migrations or import SQLite automatically.
4. Deploy to Production. Verify `/api/health`, the dashboard, and a short-link redirect on the deployed domain.

Production short URLs use HTTPS and Vercel's stable production domain (`VERCEL_PROJECT_PRODUCTION_URL`). Preview short URLs use their deployment domain (`VERCEL_URL`). `BASE_URL`, when explicitly set in Vercel, overrides these defaults; use your public HTTPS origin rather than a localhost URL. Enable Vercel's system environment variables so these hostnames are available at runtime.

Only the pooled `DATABASE_URL` is needed by the running function. Keep the direct migration credential in your local or deployment tooling environment. `.vercelignore` excludes local environment files, SQLite backups, tools, and tests from source uploads. Vercel project metadata in `.vercel/` is ignored by Git.

See [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) and [Vercel system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

### Application access and database operations

This version has a shared, unauthenticated dashboard and API. Anyone who can reach it can list, create, or delete links. Before exposing it publicly, add authentication or access controls, rate limiting, and an abuse-handling policy. Redirect counts represent requests, including automated traffic; they are not unique-visitor analytics.

Use HTTPS and configure `DATABASE_URL` in the backend's environment. Run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` before starting a new release. Set `BASE_URL` to the public origin without a path, query, or fragment. Use Neon branches and restore history according to your project's retention settings for database recovery. Deleting a link is permanent. The backend stores destinations and redirects browsers; it does not fetch or inspect destination content.

Connection reference: [Neon serverless driver](https://neon.com/docs/serverless/serverless-driver) and [pooled versus direct connections](https://neon.com/docs/connect/connection-pooling).

## Contributing

Follow [AGENTS.md](AGENTS.md). Use two-space indentation, camelCase functions, and PascalCase React components. Keep commits focused with imperative messages such as `Add link validation`. Pull requests should describe the change and validation performed, link relevant issues, and include screenshots for UI changes.
