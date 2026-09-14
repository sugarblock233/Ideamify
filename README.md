[English](README.md) | [简体中文](README.zh-CN.md)

# Ideamify

> **Ideamify** is the project name. **ResearchMap** is what the running
> application, its spec and its CLI are called; both names are settled and
> used deliberately.

**One line:** a self-hosted, lightweight web app in which one researcher and
a few AI tools they trust **co-maintain a single research-evolution map** —
routes from a question, with trials, observations, successes, failures, and
decisions — so that past exploration (especially negative results and the
conditions under which they hold) survives changing AI tools or machines.

Suitable for: a single researcher (with AI-assisted terminals) who wants a
persistent, auditable, shared research memory on their own server. This is a
**pre-release (0.x)** project: expect quick, honest fixes and no stability
guarantee. Released under the [MIT License](LICENSE).

![ResearchMap main tree canvas — synthetic demo project: root, routes, node statuses, and the selected node's cross-branch relations (synthetic demo data)](docs/images/workspace-1440x900.png)
_Main-tree canvas at 1440×900 with cross-branch relations. **Screenshots show synthetic demo data**, not real research results._

![ResearchMap node detail read view — title, status, scope, finding, decision, and evidence items (synthetic demo data)](docs/images/detail-panel-1280x800.png)
_Node detail read view at 1280×800 (also synthetic demo data)._

## Core features

- **Main tree + cross-branch relations.** Every node hangs off exactly one
  parent (the layout axis); an independent relations layer connects nodes
  across branches (related / motivates / supports / contradicts / depends_on).
  Lines are drawn on demand, not by default.
- **Research states with an evidence gate.** Six statuses from `unexplored`
  to `supported` / `not_supported`; red and green *require* scope, finding,
  decision, and at least one evidence reference — enforced server-side.
  Red is "not supported under these conditions", not permanently disproven.
- **Commit history as audit log.** Every change is an atomic, attributed
  commit with before/after diffs; anyone can see who changed what and why,
  and old versions stay readable.
- **External AI via API and CLI.** No built-in model: external AIs read a
  budgeted `context` endpoint and write small idempotent incremental commits
  with optimistic version control (`request_id` + `expected_revision`, 409
  conflict semantics). The thin CLI `tools/researchmap.py` speaks plain HTTP.
- **Export and backup.** Full JSON export per project; offline backup/verify/
  restore tooling built on SQLite online backup (`tools/backup.py`).

## What it deliberately does not do

- **No built-in LLM** — there are no model calls anywhere in the app, and it
  never goes looking for your keys.
- **No automated research execution** — no training/GPU/Slurm management, no
  automatic paper reading, no experiment orchestration.
- **No model API key required.** All core features work without one.
- **No multi-tenancy.** Not a public platform: one researcher's trusted
  circle only.
- Also out: free-form whiteboard, vector/graph databases, real-time
  multi-user cursors, MCP as a service, mobile-first layouts.
  Full boundary: [`docs/SPEC.md`](docs/SPEC.md) §0.

## Quick start

Prerequisites: a machine with Docker (Compose plugin) and a terminal.

```bash
git clone https://github.com/sugarblock233/Ideamify.git
cd Ideamify
cp .env.example .env
```

Edit `.env` — set **two personal tokens**, each ≥ 12 chars, different from
each other (the token *name* becomes the author-identity on commits):

```dotenv
RESEARCHMAP_TOKENS={"researcher":"my-researcher-token-0001","ai-one":"my-ai-one-token-0002"}
RESEARCHMAP_PORT=8000
```

Then:

```bash
docker compose up -d --build
```

Open **http://127.0.0.1:8000/** and log in with the researcher token. From a
fresh database you can, entirely in the browser: log in → create your first
project → add top-level routes and child nodes → save → refresh → log back
in, with the content intact.

### Key configuration

| Variable | Meaning |
| --- | --- |
| `RESEARCHMAP_TOKENS` | Inline JSON (or a file path) mapping **name → bearer token**. That name is the actor identity in commit records. Treat tokens as root for the instance — see [SECURITY.md](SECURITY.md). |
| `RESEARCHMAP_PORT` | Host port (default `8000`). |

- **Loopback by default.** Compose publishes `127.0.0.1:$RESEARCHMAP_PORT:8000`
  — reachable only from the host. Remote access is your job: put it behind
  your own protected network / HTTPS proxy; the project will not reconfigure
  your SSH, firewall, or tunnels.
- **Data location.** Everything lives in the `researchmap-data` volume as a
  single SQLite file (`/data/researchmap.db`). Rebuilding/restarting the
  container must not clear it.
- **Re-authentication on refresh.** Tokens are held in page memory only;
  a browser refresh logs you out. That is intentional (v0.1).
- **Export & backup.** On a plain SQLite file (a dev checkout, or a copy you
  already pulled out):

  ```bash
  python3 tools/backup.py backup  --db <db-file> --out ./backup/ --json
  python3 tools/backup.py verify  ./backup/researchmap-<ts>.db
  python3 tools/backup.py restore --src <backup> --dst <target> --server-stopped --yes
  ```

  Backups contain no token configuration and do not include the external
  files that evidence paths reference. Keep a copy of a backup on separate
  storage.

- **Backing up a running container.** The database is in WAL mode, so the live
  rows may sit in `/data/researchmap.db-wal` rather than the main file:
  copying `researchmap.db` alone can hand you a 4 KB file with **no tables at
  all**. Use the SQLite online-backup path (`tools/backup.py`, WAL-safe) with
  the repo's `tools/` mounted read-only into a one-off container:

  ```bash
  export RESEARCHMAP_TOKENS='{"researcher":"…"}'   # compose interpolates this

  # 1) backup while the server keeps running
  docker compose run --rm -v "$PWD/tools:/tools:ro" researchmap \
    python /tools/backup.py backup --db /data/researchmap.db --out /data/backups
  docker compose cp researchmap:/data/backups/researchmap-<ts>.db ./backup/
  python3 tools/backup.py verify ./backup/researchmap-<ts>.db   # 会打印计数，缺表即失败

  # 2) restore: stop the writer first (v0.1 does not swap a live file)
  docker compose stop
  docker compose cp ./backup/researchmap-<ts>.db researchmap:/data/restore-source.db
  docker compose run --rm -v "$PWD/tools:/tools:ro" researchmap \
    python /tools/backup.py restore --src /data/restore-source.db \
      --dst /data/researchmap.db --server-stopped --yes
  docker compose start
  ```

  The backup is a single self-contained file (converted to `journal_mode=DELETE`),
  so `verify` and `show` work on it anywhere. `restore` keeps the replaced file
  as `/data/researchmap.db.pre-restore-<ts>` and deletes stale `-wal`/`-shm`
  sidecars — leaving them behind would let SQLite replay the old rows over the
  restored data. After restarting, reload the UI and check the version number.
  `verify` **fails** (non-zero, `缺表`) on a schema-less file instead of
  certifying it, which is what makes the `docker cp` mistake loud rather than
  silent.

## Let an external AI read and write the map

Full protocol: [`docs/AI_USAGE.md`](docs/AI_USAGE.md). Copy-paste commit
templates: [`examples/`](examples/). The minimal loop, env vars only —
tokens never appear in command lines, samples, or logs:

```bash
export RESEARCHMAP_BASE_URL=http://127.0.0.1:8000
export RESEARCHMAP_TOKEN="<your personal token>"     # ai-one for an AI terminal

python3 tools/researchmap.py health
python3 tools/researchmap.py context <project_id>           # budgeted world state
python3 tools/researchmap.py commit <project_id> delta.json --dry-run
python3 tools/researchmap.py commit <project_id> delta.json
```

`delta.json` is a full commit request — its own `request_id` (a UUID you
generate) *and* the `expected_revision` you read from the project, before
operations. Copy [`examples/skeleton.json`](examples/skeleton.json) and edit.

Conflict handling, stated precisely:

- **`409 REVISION_CONFLICT` — the commit was not recorded.** Re-read the
  context, then **re-send the same `request_id`** with the fresh
  `expected_revision` (the error's `details.current_revision` tells you).
- **`409 IDEMPOTENCY_KEY_REUSED`** — the same `request_id` was already
  committed with *different* content. Generate a new UUID. Re-sending a
  *fully identical* payload is a safe idempotent replay
  (`already_committed: true`).

## Development & tests

Baseline toolchain: **Python 3.13, Node 22** (matching the Docker image and
CI).

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
RESEARCHMAP_DB=/tmp/rm-dev.db \
RESEARCHMAP_TOKENS='{"dev-researcher":"dev-token-0001","dev-ai":"dev-ai-token-0001"}' \
  .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# frontend (in another terminal)
cd frontend
npm ci && npm run dev            # :5173, proxies /api to :8000
npm test                         # vitest unit tests
npm run build                    # tsc --noEmit + production build
npm run build && npx playwright test    # browser e2e (production-shaped server)

# backend tests
cd backend && .venv/bin/python -m pytest tests -q

# optional synthetic load test (self-contained scratch server)
python3 scripts/stress_test.py
```

Use a scratch database (`/tmp/...`) for dev and tests — never `data/` or the
deployment volume. The locked file `backend/requirements.lock.txt` is used by
Docker and CI. The dev venv uses `requirements.txt`.

## Documentation map

| File | What it is |
| --- | --- |
| [`docs/SPEC.md`](docs/SPEC.md) | Product & technical specification — the source of product semantics |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Implementation decisions made where the SPEC was silent |
| [`docs/AI_USAGE.md`](docs/AI_USAGE.md) | External AI protocol (read → dry-run → commit → conflict → handoff) |
| [`docs/QWEN_EXECUTION_PLAN.md`](docs/QWEN_EXECUTION_PLAN.md) | Execution plan for the current fix/governance batch (A/B/D/G items; G10 = owner decisions) |
| [`docs/implementation-results.md`](docs/implementation-results.md) | Per-task execution evidence and remaining limitations |
| [`examples/`](examples/) | Labeled-synthetic commit request templates |
| [`scripts/`](scripts/) | Stress/load test |

> Note: `docs/QWEN_EXECUTION_PLAN.md` and `docs/acceptance-2026-09-13/`
> still carry local development paths; a sanitized public version is being
> prepared before wider release.

## Contributing, issues, support

- [CONTRIBUTING.md](CONTRIBUTING.md) — development setup, commit/PR
  conventions, test matrix, language policy, data/credential rules.
- [AGENTS.md](AGENTS.md) — operating rules for AI agents.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — how we work together here.
- Issues: use the provided templates (English or Chinese are both fine).
  Security reports go through [SECURITY.md](SECURITY.md), not public issues.
- No mailing list or IRC: this is a single-maintainer project; issues and
  release notes are the channels.

## Known limitations (honest list)

- **Pre-release 0.x.** API/CLI/schema may change; see versioning note in
  [CHANGELOG.md](CHANGELOG.md).
- **Remote CI has not run yet.** The workflow in `.github/workflows/ci.yml`
  is configured and tool-consistent, but has not been executed on GitHub as
  of this commit (no remote here yet).
- **Container path verified locally, not in CI yet.** The image builds and
  runs on a Docker host here (loopback publish, `/healthz`, token gate, SPA
  deep-link fallback, backup → restore drill; see
  `docs/implementation-results.md` §2 D01–D03), but the container CI job has
  not executed on GitHub yet, and Windows 11 / podman were not exercised.
- Local-only docs carry paths (see note above).

## Roadmap (what has been documented as deferred)

Nothing below is promised; it is carried over from the project's documented
deferred list (`docs/QWEN_EXECUTION_PLAN.md` §10) precisely so scope does not
creep in accidentally. No v0.2 feature set is decided yet.

- No: automated npm/PyPI publish, complex branching models, CLA systems,
  maintainer org management, auto-close bots, auto-merging all dependency
  upgrades, GitHub Pages docs site, public online demo, paid code-quality
  platforms, full UI i18n, CITATION.cff/DOI automation, complex release
  automation or multi-platform image matrices.

## License

[MIT](LICENSE) — Copyright (c) 2026 sugarblock233.

Screenshots and example data in this repository are synthetic; they are not
research results and carry no claim of their own.