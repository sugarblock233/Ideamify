# Contributing

Ideamify (the app is currently named **ResearchMap** in the spec and UI) is a
lightweight, self-hosted web app where one researcher and their trusted AI
tools co-maintain a research-evolution map. This repo is maintained by a single
owner; well-scoped, verified pull requests are welcome.

## Repository layout

```
backend/            FastAPI + SQLAlchemy + SQLite application (app/)
                      tests/  — pytest suite (wraps the HTTP smoke checks)
                      requirements.txt  — direct deps (pinned)
                      requirements.lock.txt — full transitive lock (used by Docker + CI)
frontend/           React 19 + TypeScript + Vite + @xyflow/react
                      src/lib       — layout, API client, relations (pure logic + unit tests)
                      src/workspace — canvas and panels
                      e2e/          — Playwright browser tests
tools/              researchmap.py — thin HTTP-only CLI for humans and AIs
                      backup.py    — SQLite online backup / verify / restore
examples/           synthetic commit-request templates (JSON)
scripts/            stress_test.py — 1000+ node / 3000 relation load test
docs/               SPEC.md (product + tech constraints), DECISIONS.md,
                      AI_USAGE.md (external AI protocol)
.github/            CI workflow, issue/PR templates, Dependabot
Dockerfile          multi-stage image (frontend build + FastAPI serving dist)
compose.yaml        single container + volume `researchmap-data`
```

## Development setup

Requirements: Python 3.13, Node 22+, (optionally) Docker for the container path.

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt   # dev venv uses the direct-deps base
```

The project runs from a **scratch database** configured via the environment,
never from a shared one:

```bash
RESEARCHMAP_DB=/tmp/rm-dev.db \
RESEARCHMAP_TOKENS='{"dev-researcher":"dev-token-0001-aaaa"}' \
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Every token value must be ≥ 12 chars and unique; the token *name* becomes the
actor identity in commit history, so treat tokens as root credentials for the
instance.

### Frontend

```bash
cd frontend
npm ci            # always from the lockfile
npm run dev       # Vite on :5173, proxies /api to 127.0.0.1:8000
```

### Container

```bash
cp .env.example .env        # set the two placeholder tokens (≥ 12 chars each)
docker compose up -d --build
# opens on http://127.0.0.1:8000/ (loopback-only by default)
```

## Testing

Run the suite that matches your change; PRs touching several layers should run
all of them:

| Suite | Command (from that directory) | Covers |
| --- | --- | --- |
| Backend | `cd backend && .venv/bin/python -m pytest tests -q` | auth, commit pipeline, idempotency, 409 conflicts, evidence gate, archive/export, concurrent writers |
| Frontend unit | `cd frontend && npm test` | layout determinism, folding, relation endpoint rules, stress-graph fixtures |
| Typecheck + build | `cd frontend && npm run build` | `tsc --noEmit` + production build |
| Browser e2e | `cd frontend && npm run build && npx playwright test` | login, project/node creation, search/locate, refresh (production-shaped server on a scratch DB) |
| Load (optional) | `python3 scripts/stress_test.py` | 1000+ node / 3000 relation synthetic graph, self-contained scratch server |

The e2e server reads `E2E_PYTHON` (default `../backend/.venv/bin/python`) and
`E2E_DB_DIR` (default `/tmp/rm-e2e`) from the environment — every run must use
a fresh scratch DB, never a real one.

## Commit conventions

Lightweight Conventional Commits, **English subjects**:

```
type(scope): short description     # e.g. fix(canvas): collapse deep branches on first load
```

- Types: `fix`, `feat`, `docs`, `test`, `ci`, `build`, `refactor`, `perf`,
  `chore`. Scope optional.
- Subject ~72 chars, states the change; body (optional, English-first; Chinese
  annotations allowed) explains why and how it was verified.
- No `update`, `fix bugs`, or one-word subjects.
- One logical change per commit.
- Branch names: lowercase English with hyphens, off `main`.
- Do **not** rewrite shared history, force-push, or change Git identities to
  re-word old commits.
- Breaking API/CLI changes must be marked (breaking-change note in the commit
  body and PR) and documented in the PR migration notes.

## Pull request conventions

Use the PR template honestly — it asks for **verification actually performed**
(commands + real results), UI screenshots when the interface changes, and an
explicit list of unverified items. UI-affecting changes should be checked in a
real browser at 1440×900 or 1280×800; screenshots must use synthetic data.
Squash-merge-friendly titles and descriptions are appreciated.

## Issues and feature requests

- **Bug report**: version/commit, install method, OS, browser (for UI bugs),
  minimal steps, expected vs actual, sanitized logs/screenshots, a minimal
  **synthetic** reproduction.
- **Feature request**: the research problem it answers, target behavior,
  alternatives, and a self-check against the documented boundaries
  (no built-in LLM, no automated research execution, single-researcher
  trusted circle).
- Labels in use: `bug` (defect to fix), `enhancement` (requested feature),
  `documentation` (docs wrong/missing), `question` (needs an answer, not a
  change), `good first issue` (small, well-scoped, approvable), `help wanted`
  (analysis done, implementation open).
- Questions are welcome in **English or Chinese** — language is never a reason
  to decline a contribution.

## Data, credentials, and test hygiene

- **Never commit tokens.** `.env*` files are gitignored; only `.env.example`
  (placeholders) is tracked. Tokens live in runtime environment variables only.
- Use scratch databases for anything you run — `/tmp/rm-*.db` by convention.
  Never point the app or tests at real research data, and never reuse a real
  deployment's database for experiments.
- All example/fixture data must be **synthetic and labeled as such** (see
  `examples/`). Real experiment logs, reports, or project content never enter
  the repo, issues, or PRs.
- Backups must not contain token configuration; run restoration drills on
  copies, and store copies on separate storage from the running instance.

## AI-assisted contributions

AI assistance is fine and common in this project. The human who submits the
change is responsible for it:

- Understand and be able to explain every line you submit.
- Actually run the verification you claim; do not invent test results,
  experiments, or "verified" claims.
- Check dependency and code provenance of anything AI-generated.
- Mention AI assistance honestly in the PR description — do not represent an
  AI contribution as entirely yours. Do not list models or AI tools as
  co-authors/owners; humans own the repo.