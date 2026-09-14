# AGENTS.md

Short operating instructions for AI agents working in this repository.
Human readers: the same rules apply; see `CONTRIBUTING.md` for the longer form.

## What this is

Ideamify / ResearchMap — a self-hosted research-evolution map: one browser SPA
(React 19 + Vite), one FastAPI + SQLite backend, one thin HTTP-only CLI, one
Docker image + compose file. Single researcher + trusted AIs. No built-in
LLM, no automated research execution, no multi-tenancy. Product semantics are
defined in `docs/SPEC.md`; do not drift from them silently.

## Layout (short)

- `backend/app/` — FastAPI app (auth, commit service, context builder, SQLAlchemy models)
- `backend/tests/` — pytest wrapper around `tests/api_smoke.py` (ASGI smoke suite)
- `frontend/src/lib/` — pure logic (layout, relations, API client) + vitest tests
- `frontend/src/workspace/` — canvas, panels, top bar
- `frontend/e2e/` — Playwright smoke (production-shaped server, scratch DB)
- `tools/researchmap.py` — AI/human CLI (HTTP only) · `tools/backup.py` — backup/restore
- `examples/` — synthetic commit templates · `scripts/stress_test.py` — load script
- `docs/` — SPEC, DECISIONS, AI_USAGE (protocol), plan/results docs

## Commands (real, from this repo)

```bash
# backend (dev)
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
RESEARCHMAP_DB=/tmp/rm-dev.db RESEARCHMAP_TOKENS='{"dev":"dev-token-0001-aaaa"}' \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# backend tests
cd backend && .venv/bin/python -m pytest tests -q

# frontend
cd frontend && npm ci
npm run dev                      # :5173, proxies /api to :8000
npm test                         # vitest
npm run build                    # tsc --noEmit + vite build
npm run build && npx playwright test   # e2e (uses E2E_DB_DIR, default /tmp/rm-e2e)

# container
cp .env.example .env && docker compose up -d --build
```

Toolchain baseline: **Python 3.13, Node 22** (matches Dockerfile and CI).

## Commit / PR summary convention

- English, Conventional-Commit subjects: `fix(scope): what changed`, ~72 chars.
- Body in English-first (Chinese fine as annotation): why, verification method.
- Honest verification claims only: state what was run and the real result.
  Never claim tests that were not executed; never claim "all verified".
- Update `CHANGELOG.md` (Unreleased section) in the same change batch.

## Boundaries you do not cross

- No rewriting shared history, force pushes, or changes to Git identity.
- No pushing to a remote, publishing packages/images, or creating releases —
  explicit owner approval only.
- Do not silently change product semantics or SPEC §0 boundaries (no LLM,
  no execution, no multi-tenancy, token model). If a change needs to touch
  them, it must surface as a decision, not sneak in as an "improvement".
- Heavy renames of the public surface (API paths, `RESEARCHMAP_*` env vars,
  DB fields) are not agent work without an explicit request.

## Test requirements before delivery

- Backend changes: `pytest` green. Frontend changes: `npm test` + `npm run
  build` green. UI/canvas changes: also run e2e and check a real browser.
- New bug fixes: add or use a check that would have caught the bug (tests are
  a regression net, not a checkbox).
- Report unverified items explicitly: "not verified + reason + follow-up step".

## Data safety

- Work against scratch databases only: `RESEARCHMAP_DB=/tmp/...`. Never open,
  write, migrate, or delete any real database, `data/` volume, or
  `researchmap-data` volume.
- Tokens come from environment variables; never write a token value into
  files, logs, tests, samples, or PR text. Test tokens must be synthetic
  (e.g. `e2e-test-token-0001`) and labeled as such.
- Demo and fixture data is synthetic and labeled as synthetic. Real research
  content never enters the repo.

## Delivery rules

- Docs change with the code in the same batch (README pair, AI_USAGE,
  DECISIONS if a non-obvious choice was made).
- Keep every new public file free of absolute local paths, tokens, and
  hostnames other than 127.0.0.1/localhost.
- Attribution honesty: AI assistance is fine and should be acknowledged;
  models and AI tools are never listed as authors.