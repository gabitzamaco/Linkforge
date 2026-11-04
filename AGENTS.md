# Repository Guidelines

## Project Structure & Module Organization

Linkforge is planned as a React frontend with an Express backend running on Node.js. The repository currently contains only `readme.md`; source code, tests, assets, and package manifests have not been added.

When introducing application code, document the actual frontend, backend, test, and asset directories in `readme.md`. Keep React UI concerns separate from Express routes and server configuration.

## Build, Test, and Development Commands

No build, test, lint, or startup commands are configured yet. Once a `package.json` exists, run commands from the directory containing it:

- `npm install`: install declared dependencies.
- `npm run`: list available package scripts.
- `npm run dev` or `npm start`: start an application only when that script is defined.
- `npm test`, `npm run lint`, and `npm run build`: run the corresponding checks only when implemented.

Document required Node.js versions, scripts, ports, and setup steps when adding the application. Do not report unavailable checks as passing.

## Coding Style & Naming Conventions

No formatter or linter is configured. For new JavaScript or JSX, use two-space indentation, camelCase for variables and functions, and PascalCase for React components, such as `LinkCard.jsx`. Match surrounding code once conventions exist. Add shared formatting and lint configuration with the initial application setup.

## Testing Guidelines

No testing framework or coverage threshold is established. When adding executable code, configure appropriate frontend and backend tests and document how to run them. Prefer descriptive test names that state behavior; use `*.test.js` or `*.test.jsx` unless the selected framework requires another pattern. Cover new behavior and regression cases for bug fixes.

## Commit & Pull Request Guidelines

Existing commits use short, imperative summaries, including `Add README` and `Update README`. Continue that style and keep commits focused.

Pull requests should describe the change, explain its purpose, link relevant issues, and list validation performed or checks unavailable. Include screenshots for UI changes and update setup documentation when commands or configuration change.

## Security & Configuration

Keep credentials and local environment files out of Git. When configuration is introduced, add appropriate ignore rules and an `.env.example` containing placeholders. Document required variables without including real secrets.
