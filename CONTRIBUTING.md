# Contributing

Bug reports, documentation improvements and small, focused pull requests are
welcome. Questions and discussions can be in English or Chinese.

v0.1 is now being used as a research notebook. Prioritize lost records,
incorrect history, broken AI handoffs and reproducible usability problems.
For a new feature, describe a concrete research workflow in a
[discussion](https://github.com/sugarblock233/Ideamify/discussions) first.

## Local development

Use Python 3.13 and Node 22 (the CI and container baseline). From the repository root:

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.lock.txt
npm --prefix frontend ci
```

Start the backend in one terminal. These credentials and data are synthetic:

```bash
RESEARCHMAP_DB="$(mktemp -d)/researchmap.db" \
RESEARCHMAP_TOKENS='{"dev":"synthetic-dev-token-0001"}' \
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend \
  --host 127.0.0.1 --port 8000
```

In a second terminal, also from the repository root:

```bash
npm --prefix frontend run dev
```

Open http://127.0.0.1:5173/. Vite proxies `/api` to the backend on port 8000.
For the deployment setup, see the [README](README.md).

## Check your change

| Change | Command from the repository root |
| --- | --- |
| Backend or CLI | `backend/.venv/bin/python -m pytest backend/tests -q` |
| Frontend logic | `npm --prefix frontend test` |
| Frontend build | `npm --prefix frontend run build` |
| Browser workflows | `npm --prefix frontend run e2e` (build first) |

Install the test browser once: `cd frontend && npx playwright install chromium`.
The E2E server uses a fresh temporary database on each invocation. Overrides:
`E2E_PORT` (default 8021), `E2E_PYTHON`, and `E2E_DB_DIR` (scratch data only).
Test screenshots go to `frontend/test-results/`, without modifying documentation.
To refresh the README images after a UI change:

```bash
cd frontend
npm run build
UPDATE_DOC_SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
```

Use checks relevant to the change, and add a regression check for a bug fix.
Check interface changes in a real browser too. Report the commands you ran,
their actual results and anything you could not verify. CI also builds the
container and exercises persistence and backup/restore.

## Repository layout

- `backend/app/`: API, authentication, commit service and SQLite models
- `frontend/src/`: React UI, canvas and shared client logic
- `frontend/e2e/`: browser workflows with synthetic data
- `tools/`: HTTP CLI and SQLite backup tool
- `examples/`: synthetic commit requests
- `docs/`: user guides, [specification](docs/SPEC.md), [design decisions](docs/DECISIONS.md) and historical archive

`backend/requirements.txt` lists direct dependencies;
`backend/requirements.lock.txt` pins the complete environment used by CI and Docker.
Update the lockfile deliberately when dependencies change.

## Commits and pull requests

Use English Conventional Commit subjects, for example
`fix(workspace): keep AI updates visible after selecting a node`.
Keep subjects concise (roughly 72 characters), with one logical change per
commit. PR titles and summaries should be English first; Chinese explanations
are welcome. Explain the user-visible result, why it matters and how you tested it.

Update `CHANGELOG.md` under **Unreleased** for changes that affect users. Keep
the English and Chinese user guides aligned. Document API, CLI or schema
changes and any migration steps. Do not rewrite shared history or force-push.

AI assistance is welcome. The contributor is responsible for understanding,
reviewing and testing the change. Acknowledge substantial AI assistance in
the PR description; human contributors retain responsibility and authorship.

## Data and security

Use synthetic data and isolated databases or Compose projects. Never test on
someone's research instance or commit credentials, private records, database
files or personal filesystem paths. Sanitize screenshots and logs before
sharing. Report vulnerabilities through [SECURITY.md](SECURITY.md).
