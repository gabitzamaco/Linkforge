---
name: api-endpoint
description: Add an Express API endpoint to Linkforge using the existing route, storage, and test conventions.
---

# API Endpoint

1. Add the route to `backend/src/app.js`. Follow the response shape, validation, and error handling of analogous endpoints.
2. Add matching storage logic to `backend/src/store.js` if needed. Keep database queries separate from route handlers.
3. Add focused tests in `tests/*.test.js` using `node:test` and `node:assert/strict`, covering success, invalid input, and missing resources where applicable. Use the existing isolated PGlite test helper instead of live database credentials.
4. Run `npm test` from the repository root. Report the results and any checks that could not be completed; do not claim passing checks without running them.
