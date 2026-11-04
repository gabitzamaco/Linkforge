# Linkforge

A URL shortener built with React, Express, and SQLite. Create short links with generated or custom codes, copy them from the dashboard, edit their destinations, track redirect counts, and delete links you no longer need. Links and statistics survive server restarts.

## Requirements

- Node.js 24 or newer and npm. SQLite is provided by Node's built-in `node:sqlite` module; no separate database server is required.
- Run commands from the repository root.

## Quick start

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173**. The Vite development server forwards API and redirect requests to Express on port **3000**. The dashboard displays short URLs served by Express, so keep both servers running.

For optional configuration, copy `.env.example` to `.env` before starting:

```powershell
Copy-Item .env.example .env
```

| Variable    | Default             | Purpose                                                                        |
| ----------- | ------------------- | ------------------------------------------------------------------------------ |
| `PORT`      | `3000`              | Express listening port. Keep port 3000 for the default Vite proxy.             |
| `HOST`      | `127.0.0.1`         | Express bind address; use `0.0.0.0` only when network access is intended.      |
| `DATA_FILE` | `data/links.sqlite` | SQLite file path. Its directory is created automatically.                      |
| `BASE_URL`  | Request origin      | Public origin for generated links; set an HTTPS origin behind a reverse proxy. |

The example file sets `BASE_URL=http://127.0.0.1:3000`. Keep `.env` and database files out of version control.

## Commands

| Command                | Purpose                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Run the React frontend and API together with development reload. |
| `npm run build`        | Create the production frontend in `frontend/dist/`.              |
| `npm start`            | Run Express and serve the built frontend on port 3000.           |
| `npm test`             | Run HTTP API integration tests using Node's test runner.         |
| `npm run lint`         | Check JavaScript and JSX style and correctness.                  |
| `npm run format:check` | Check formatting without modifying files.                        |

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
  src/                Express routes, SQLite storage, and server startup
tests/
  api.test.js         HTTP integration and database persistence tests
  dev.test.js         React module loading and development proxy regression test
data/                 Local SQLite database; ignored by Git
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

`npm test` starts real HTTP servers on ephemeral loopback ports and uses isolated in-memory or temporary SQLite databases. It covers creation, updates, validation, custom-code conflicts, redirects and click counts, deletion, error handling, and persistence across restarts. A development-server regression test verifies that React modules load as JavaScript while API and short-link requests reach Express. Tests do not follow redirects to external destinations. No coverage threshold is configured.

For manual verification, create a link, copy and open it, and refresh the dashboard to see the updated count. Click **Edit** on the link, enter a new destination, and choose **Save changes**. Open the same short URL to verify it redirects to the new destination. Canceling an edit should leave the saved destination unchanged. Finally, delete the link and check that its short URL returns `404`.

## Deployment and data

This version has a shared, unauthenticated dashboard and API. Anyone who can reach it can list, create, or delete links. Before exposing it publicly, add authentication or access controls, rate limiting, and an abuse-handling policy. Redirect counts represent requests, including automated traffic; they are not unique-visitor analytics.

Use HTTPS and a persistent writable volume for `DATA_FILE` when deploying. Set `BASE_URL` to the public origin without a path, query, or fragment. Back up the database with a SQLite-aware backup procedure or stop the server before copying database files. Deleting a link is permanent. The backend stores destinations and redirects browsers; it does not fetch or inspect destination content.

## Contributing

Follow [AGENTS.md](AGENTS.md). Use two-space indentation, camelCase functions, and PascalCase React components. Keep commits focused with imperative messages such as `Add link validation`. Pull requests should describe the change and validation performed, link relevant issues, and include screenshots for UI changes.
