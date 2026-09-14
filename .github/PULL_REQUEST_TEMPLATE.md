## Problem

<!-- What is broken or missing, and why does it matter? -->

## Result

<!-- What does this PR change? Link the problem, not just the diff. -->

Closes #<!-- issue number, or "n/a" for docs/fixes without an issue -->

## Verification actually performed

List the commands you ran and their real results (not "should pass"). State the
OS and toolchain versions if relevant.

- [ ] Backend: `cd backend && .venv/bin/python -m pytest tests -q` → result: `...`
- [ ] Frontend unit tests: `cd frontend && npm ci && npm test` → result: `...`
- [ ] Type check + production build: `cd frontend && npm run build` → result: `...`
- [ ] Browser e2e (UI/canvas changes): `npm run build && npx playwright test` → result: `...`

## UI

<!-- If this touches the interface: attach screenshots (1440x900 and/or
     1280x800) of the affected views. Synthetic demo data only. -->

## Unverified items

<!-- What could not be checked in your environment and why (e.g. no local
     Docker → container path unverified here; the container CI job covers it).
     Be explicit — an empty section is fine only if everything was checked. -->

## Migration notes

<!-- Required when the HTTP API, CLI, or data schema changes:
     - what changed, who is affected (browser / CLI / AI sessions),
     - any required user action, and backward compatibility notes.
     See the commit conventions in CONTRIBUTING.md for breaking-change marking. -->