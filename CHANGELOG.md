# Changelog

All notable changes to Ideamify are documented in this file.

## Versioning notes

- Releases are tagged as `vMAJOR.MINOR.PATCH`. The project is in the **0.x
  early stage**: API, CLI, and schema changes are allowed, but every breaking
  change is noted here.
- The database's `schema_version` is an independent data-format concept and
  does **not** track the software version; they move for different reasons
  and are never bumped together blindly.
- **No tags have been published as of this commit.** A release is pending the
  owner's decision (see G10 in `docs/QWEN_EXECUTION_PLAN.md`); the `Unreleased`
  section below is the working record until a tag exists.

## [Unreleased]

This batch completes the acceptance-fix and contribution-readiness plan
(`docs/QWEN_EXECUTION_PLAN.md`); per-item status and evidence are recorded in
`docs/implementation-results.md`.

### Added

- Contribution meta: `CONTRIBUTING.md`, `AGENTS.md`, `SECURITY.md`,
  `CODE_OF_CONDUCT.md`, and `CHANGELOG.md` (this file).
- `.github/`: pull-request template, issue templates (bug, feature), Dependabot
  (npm / pip / github-actions / docker, weekly, PR limit 5), and a
  `ci.yml` workflow — frontend (typecheck, vitest, build), backend (clean
  venv from lockfile, pytest on a scratch DB with synthetic tokens), browser
  e2e (Playwright on a production-shaped server, artifacts on failure only,
  7-day retention), container (image build, boot, auth positive/negative,
  SPA fallback), and repository checks (absolute-path/credential scan,
  Markdown link resolution, JSON/YAML validity).
- English-primary root `README.md` (title uses the repo name Ideamify) with a
  full Chinese counterpart `README.zh-CN.md`; both cross-linked at the top.
- `backend/requirements.lock.txt` — full transitive pip lock (clean venv,
  public index); Docker and CI now install from it. `requirements.txt`
  remains the human-maintained direct-deps base.
- `.editorconfig` — consistent UTF-8 / LF / final newline / indentation
  (2 for JSON/JS/TS/YAML, 4 for Python; Markdown trailing spaces preserved).
- `.dockerignore` — local data (.git, .env*, node_modules, .venv, databases,
  WAL/SHM, backups, docs, examples, tools) excluded from the build context.
- Playwright config accepts `E2E_PYTHON` and `E2E_DB_DIR` environment
  overrides (defaults unchanged: `../backend/.venv/bin/python`, `/tmp/rm-e2e`).

### Changed

- Docker Compose port binding is now loopback-only by default
  (`127.0.0.1:$RESEARCHMAP_PORT:8000`), matching the SPEC default; remote
  access is left to the operator's protected proxy.
- `tools/researchmap.py`: commit requests now require explicit, stable
  identity — `request_id` and `expected_revision` are not silently
  auto-generated in-memory; error output is a stable machine-readable JSON
  on stderr with a non-zero exit code; credentials stay in environment
  variables.
- `docs/AI_USAGE.md` becomes the English-primary external AI protocol
  (Chinese fallback preserved), synchronized with the CLI and SPEC so the
  README, CLI help, and docs share one contract.
- `frontend/package.json` carries real repository metadata
  (`sugarblock233/Ideamify`); the package stays `private: true`.
- `.gitignore` now covers SQLite `-wal`/`-shm` sidecars, loose `*.db`
  scratch files, backup artifacts (`backup/`, `backups/`, `*.bak`,
  `.pre-restore-*`), and all `.env*` except the tracked example.

### Fixed

Design fixes from the 2026-09-13 acceptance audit (A01–A09) and UX/contract
items (B01–B06):

- **A01** — an empty instance offers a clear first-project creation flow,
  so login → first project → routes → nodes now works purely in-browser on
  a fresh database.
- **A02** — drafts keep the revision baseline they were edited against;
  a working conflict-recovery path (merge or per-field choose) replaces the
  previously dead 409 prompt; drafts survive disconnects and project
  switches.
- **A03** — large maps first open with the virtual root plus two levels of
  business nodes (v0.1 synthetic: 104 visible, the rest preserved and
  expandable) instead of flattening ~1100 cards to unreadable zoom; manual
  "fit current graph" is kept, and polling no longer forces a full
  `fitView`.
- **A04** — context output honors the `max_chars` budget including metadata
  and omission hints; truncation is flagged consistently; keyword and focus
  priorities deterministic.
- **A05** — CLI commit identity is stable across retries (see Changed);
  409 / success-but-receipt-lost / reused-key cases are distinguished and
  machine-parseable.
- **A06** — creating `supported`/`not_supported` nodes now prompts the
  required scope/finding/decision/evidence fields inline; validation errors
  are shown in the dialog without polluting the background node.
- **A07** — deep links expand collapsed ancestors and select the target node
  across view states, branch scopes, and fresh sessions.
- **A08** — "later" holds the update prompt without loading; manual refresh
  truly compares the loaded revision against the server.
- **A09** — desktop search keeps a usable minimum width at 1280×800 and
  1440×900, even with long Chinese project titles.
- **B01–B02** — node detail reads first (edit is an explicit step);
  evidence items show full `note` text; URLs open safely, paths copy only.
- **B03–B04** — virtual root connects all top-level routes; relation display
  limit ("show M of N, M ≤ 6") without implying a total; move/reorder keeps
  the view anchored; history handles >20 entries, engine moves, and restore.
- **B05–B06** — one consistent AI contract across SPEC, CLI `--help`,
  AI_USAGE, README, and examples; the page offers copyable AI onboarding
  materials (token placeholder or env-var instructions, never the page's
  live token).

### Security

- Loopback-only default publish (see Changed): the compose file no longer
  exposes the API on all host interfaces out of the box. The token model is
  otherwise unchanged (single trusted circle, token names are actor
  identities); read `SECURITY.md`.