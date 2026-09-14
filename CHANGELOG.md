# Changelog

User-visible changes to Ideamify. Release tags use `vMAJOR.MINOR.PATCH`;
database schema versions are tracked separately. Breaking changes and required
migration steps will be noted here.

## [Unreleased]

### Added

- Markdown **tables** in node details: GFM table rendering with a
  container-scoped horizontal scroll for wide tables, and an「插入表格」
  template button in the editor.
- **Managed image attachments**: insert or paste images into node details;
  they upload as staged attachments and become attached when the edit
  commits. Images render inline in the read view and editor preview, with a
  click-to-zoom lightbox. Bytes are served only through an authenticated
  endpoint — the bearer token never appears in an image URL. External
  `https://` images are never loaded; they degrade to a placeholder showing
  the URL text. Unreferenced staged uploads are garbage-collected after
  30 days.
- Attachments flow through the boundaries: project export gains
  `schema_version: 2` with attachment metadata (bytes stay in the backup
  bundle, not the JSON), `backup` copies attachment files with a per-file
  sha256 manifest, `restore` verifies directory coverage, and the CLI gains
  a read-only `attachments` list subcommand.
- Canvas layout switcher: horizontal tree, vertical tree and outline list,
  with folds, branch filter and viewport remembered independently per
  layout (browser-side, per project).
- One-click expand/collapse tools above the map: expand all / collapse all,
  expand to level 1–3, expand the selected subtree, and single-step undo
  for batch tools.
- Information density tiers: cards step down to compact and overview
  presentations as you zoom out (or lock a tier in the view menu), with an
  overview overlay showing route names, a status legend, and a
  low-interference mode that hides tags and counts.
- A resizable, collapsible detail side panel; collapsing it never discards
  an unsaved draft, and the restore entry stays visible on the right edge.
- An adaptive top bar that keeps search reachable at narrow widths, and
  side-panel tabs that scroll instead of shrinking.
- Interface language switch (中文 / English) in the top bar; user content
  and API fields are never translated.
- Per-project view preferences persist in the browser: layout choice,
  density tier lock and low-interference mode.
- Direct creation on the map: 「+ 一级路线」 / 「+ 子节点」 open a dashed
  draft card next to the parent, edited by the same session as the side
  panel form. Nothing is committed until you save; cancelling removes the
  card with no record, and a failed save (offline or revision conflict)
  keeps the draft for a retry that cannot create a duplicate.

### Changed

- The node-create modal is retired in favour of the on-map draft card;
  the side panel keeps the same form, accessible names and A06 evidence
  gate for red/green statuses.

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
