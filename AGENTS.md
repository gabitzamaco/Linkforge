# Repository Guidelines

## Project Structure & Module Organization

Linkforge is a TypeScript React frontend with an Express backend running on Node.js. React components, CSS, and component tests live in `frontend/src/`; Express routes, database adapters, and server configuration live in `backend/src/`. SQL migrations live in `backend/migrations/`, CLI commands in `scripts/`, and Node integration tests in `tests/`. `api/index.ts` is the Vercel entry point. Type-only API contracts live in `shared/types.ts`; backend database/store interfaces live in `backend/src/types.ts`.

Keep `readme.md` current when directories change. Keep React UI concerns separate from Express routes and server configuration.

## Build, Test, and Development Commands

Run commands from the repository root. Use Node.js 24.15+ within the 24.x release line, or Node.js 26+, and npm. CI uses Node 24 LTS. The frontend runs on port 5173 and proxies API/redirect requests to Express on port 3000. Set up `.env` from `.env.example` and apply migrations before starting against Neon.

- `npm install`: install declared dependencies.
- `npm run`: list available package scripts.
- `npm run dev`: run the frontend and backend with development reload.
- `npm start`: serve the API and previously built frontend.
- `npm run typecheck`: check all TypeScript application code and tests.
- `npm test`: run Node/PGlite integration tests and Vitest component tests; the individual suites are `npm run test:backend` and `npm run test:frontend`.
- `npm run lint` and `npm run format:check`: check ESLint and Prettier rules.
- `npm run build`: typecheck, then create the production frontend in `frontend/dist/`.
- `npm run db:migrate` and `npm run db:import:sqlite -- <path>`: explicit database maintenance commands; do not run them against live data as part of routine tests.

Document required Node.js versions, scripts, ports, and setup steps when adding the application. Do not report unavailable checks as passing.

## Coding Style & Naming Conventions

Use two-space indentation, camelCase for variables/functions, and PascalCase for React components, such as `LinkCard.tsx`. Prettier and ESLint (including TypeScript and React rules) are configured at the root. Application code and tests use TypeScript; tool configurations remain JavaScript.

Use explicit `.ts`/`.tsx` extensions and `import type` for types. Backend modules, scripts, and Node tests execute through native type stripping: use erasable syntax and avoid runtime path aliases. Preserve strict checking and handle nullable values and unchecked indices explicitly. Validate external inputs at runtime; type assertions do not validate JSON or SQL results.

## Testing Guidelines

Backend integration tests use Node's test runner and isolated PGlite databases with the production SQL migrations; they must not use Neon credentials. Frontend component tests use Vitest, React Testing Library, and jsdom. Use descriptive `*.test.ts` or `*.test.tsx` names and cover new behavior and regression cases. No coverage threshold is configured. Native dialog focus trapping and mobile layout require browser verification beyond jsdom.

## Commit & Pull Request Guidelines

Existing commits use short, imperative summaries, including `Add README` and `Update README`. Continue that style and keep commits focused.

Pull requests should describe the change, explain its purpose, link relevant issues, and list validation performed or checks unavailable. Include screenshots for UI changes and update setup documentation when commands or configuration change.

## Security & Configuration

Keep credentials and local environment files out of Git. When configuration is introduced, add appropriate ignore rules and an `.env.example` containing placeholders. Document required variables without including real secrets.
