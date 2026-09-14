# Changelog

User-visible changes to Ideamify. Release tags use `vMAJOR.MINOR.PATCH`;
database schema versions are tracked separately. Breaking changes and required
migration steps will be noted here.

## [Unreleased]

### Fixed

- AI updates remain detectable after selecting another node. Refresh now
  compares against the graph actually loaded, so new records are not missed.
- Ordinary browser reloads and navigation warn before discarding unsaved
  node edits.

- Node details now use the correct status color; supported results no longer
  appear red.

### Improved

- Add a visible **+ 子节点** action to node details for continuing a research route.
- Replace the onboarding README with matching English and Chinese guides,
  including a first research cycle, AI handoff, backup, restore and upgrades.
- Separate historical implementation records from current documentation.
- Isolate browser-test data on each run and keep test screenshots out of
  tracked documentation unless explicitly regenerated.

No API, database schema or configuration changes are required for this update.

## [0.1.0] — 2026-09-14

First public pre-release.

- Research trees with questions, ideas, attempts and findings; cross-branch relations.
- Evidence and scoped conclusions, including negative and inconclusive results.
- Search, node links, archive/restore and commit history with before/after changes.
- External AI access through a Python CLI and HTTP API, budgeted context,
  dry-run validation, idempotent commits and revision conflict handling.
- One Docker container with persistent SQLite storage, backup and restore tools.
- MIT license, contribution guidelines and CI for frontend, backend, browser,
  container and repository checks.

The application currently has a Chinese interface and uses the name ResearchMap.

[Unreleased]: https://github.com/sugarblock233/Ideamify/compare/v0.1.0...main
[0.1.0]: https://github.com/sugarblock233/Ideamify/releases/tag/v0.1.0
