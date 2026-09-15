# Changelog

User-visible changes to Ideamify. Release tags use `vMAJOR.MINOR.PATCH`;
database schema versions are tracked separately. Breaking changes and required
migration steps will be noted here.

## [Unreleased]

### Added

- A research map redesign handoff covering the proposed overview, route
  reader, evidence presentation, implementation stages and acceptance tasks.
  This is design documentation; the proposed UI and API additions are not
  implemented in this documentation batch.
- English and Chinese research authoring guides: establish routes before
  subquestions, explain research continuity, distinguish code from execution
  and evidence, maintain route summaries, and preserve existing research.
  Getting-started guides and AI handoff instructions now teach this workflow.

- Refreshed the visual system across the project dashboard and research
  workspace: dark utility navigation, warm paper canvas, clearer status
  accents, softer cards, and improved panel hierarchy while preserving the
  existing interaction model.

- Local single-user project manager as the default entry: no login or token
  setup, searchable project cards, recent/name sorting, creation and return
  from maps with unsaved-draft protection. Project lists include every API page.
- Explicit `RESEARCHMAP_AUTH_MODE=token` for protected remote deployments;
  local mode keeps the loopback-only Compose binding and checks browser Host,
  Origin and write headers. The CLI can access local projects without a token;
  optional named bearer credentials still preserve AI actor attribution.
  No authentication cookies, stored browser credentials or database migration.

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
- **Research versions**: tag nodes with phase labels (v1, v2, v3 … —
  displayed as 第一轮/第二轮 by order). Version create/update/archive and
  per-node assignment all flow through the same commit protocol
  (idempotency, revision conflicts and before/after history included), and
  project export gains `schema_version: 3` with the full version and
  assignment tables.
- **Version filter and swimlane view**: filter the map by research version
  (or 未分配) across all layouts and reloads; matched nodes keep their route
  ancestors visible as context, a selected node caught outside the filter
  gets a restore hint in the detail panel, and new drafts pre-fill the
  filtered version. The new 泳道 layout renders versions × top-level routes
  as a deterministic progress grid — columns per version plus 未分配, one
  row per route, tree edges hidden and folds intentionally ignored.
  A shared node belonging to several matching versions shows one card per
  hit lane instead of collapsing into the first one.
- **Version manager in the UI**: create, rename, reorder (up/down via the
  commit-protocol `version.update after_id` repositioning) and archive
  research versions without touching the API or CLI — entry points in the
  view menu「科研版本管理」 and always visible next to the version filter
  row, even on projects that have no versions yet. Archived versions stay
  filterable; unarchiving is not provided server-side and the dialog says
  so.
- A fixed **route rail on the overview tier**: when the whole map is fitted
  and route labels fall off-screen, a collapsible screen-space list of every
  visible top-level route stays clickable to zoom straight to it.
- Cards **preview unsaved edits live**: while an existing node is being
  edited, its map card mirrors the draft title, summary and status
  immediately, without re-laying-out the graph; text-only edits never move
  other cards.
- Draft cards find a deterministic spot even on an **empty canvas, empty
  filter result or swimlane grid** (docked under the 未分配 column), so
  creation never depends on an existing card to anchor to.

### Changed

- Save records are now consistently labelled 「记录 #N」 (was mixed wording
  around revision numbers) to keep them clearly distinct from research
  version labels. The root card, the recent-changes list and the project
  record indicator all follow this wording; the application's own version
  is labelled separately as 「应用版本 vN」.

- The node-create modal is retired in favour of the on-map draft card;
  the side panel keeps the same form, accessible names and A06 evidence
  gate for red/green statuses.

### Fixed

- AI protocol documentation now reflects the current export schema version
  (3), keyword priority in budgeted context, and the need to read full nodes
  for rationale and evidence.

- Detail-panel content now follows live sidebar resizing without fixed-width
  form controls or evidence rows causing horizontal overflow.
- Rapid node switching no longer lets a late detail response replace the
  currently selected node; create forms are locked while their request is in
  flight so typed values cannot be discarded on success.
- AI updates remain detectable after selecting another node. Refresh now
  compares against the graph actually loaded, so new records are not missed.
- Ordinary browser reloads and navigation warn before discarding unsaved
  node edits.

- Node details now use the correct status color; supported results no longer
  appear red.
- Acceptance rework: a pasted/uploaded image no longer clobbers text typed
  while the upload was in flight; `backup`/`restore` fail honestly when the
  attachment bundle is incomplete instead of restoring silently partial data;
  replaying the exact bytes of a successful commit is idempotent at the
  request level again; on the swimlane, a shared node appears once per
  matched version column; toolbar, card and context-menu fold/branch controls
  disappear on the swimlane grid where they would be dead buttons.

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
