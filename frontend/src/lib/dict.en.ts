/** English UI strings. The type pins every key of dict.zh — a missing key here
 *  is a compile error, so `npm run build` enforces dictionary parity. */

import type { zh } from "./dict.zh";

export const en: Record<keyof typeof zh, string> = {
  // ---- TokenGate -----------------------------------------------------------
  "gate.subtitle": "Lightweight research evolution map · enter your access token to open the workspace",
  "gate.token.placeholder": "Access token (Bearer token)",
  "gate.open": "Open",
  "gate.opening": "Opening…",
  "gate.err.network": "Cannot reach the server",
  "gate.note":
    "The token is kept in page memory only; a refresh requires re-entry. It is never written to cookies, localStorage, or the URL. This app needs no model API key.",

  // ---- EmptyProjects (App.tsx) ----------------------------------------------
  "empty.enter.or.create": "Enter an existing project, or create one:",
  "empty.none": "No projects yet — create your first project.",
  "empty.enter.btn": "Enter \"{name}\" (v{rev})",
  "empty.name.label": "Project name (1–100)",
  "empty.name.placeholder": "e.g. Li-rich Mn-based cathode degradation mechanism",
  "empty.objective.label": "Research goal (1–4000)",
  "empty.objective.placeholder": "What question are you trying to answer?",
  "empty.create.err": "Failed to create the project (check network/token)",
  "empty.create": "Create project",
  "empty.creating": "Creating…",
  "empty.refresh": "Refresh project list",
  "empty.refreshing": "Refreshing…",
  "empty.note":
    "Project data is stored on this server (SQLite volume). Creation and edits go through the same commit protocol; every write carries the token's identity (actor) and cannot be forged.",

  // ---- TopBar ---------------------------------------------------------------
  "topbar.switch.project": "Switch project",
  "topbar.new.project": "+ Project",
  "topbar.new.project.title": "Create project",
  "topbar.search.placeholder": "Search titles/summaries/tags/observations/findings (substrings work)",
  "topbar.search.head": "Search results (click = expand ancestors and locate; the main tree stays visible)",
  "topbar.search.count": " · {n} total",
  "topbar.search.loading": "Searching…",
  "topbar.search.empty": "No matches (folding does not limit search)",
  "topbar.new.route": "+ Top-level route",
  "topbar.more.title": "More: project settings / fit map / recent changes / export / AI access",
  "topbar.menu.project.settings": "Project settings",
  "topbar.menu.fit": "Fit current map",
  "topbar.menu.show.archived": "Show archived nodes",
  "topbar.menu.hide.archived": "Hide archived nodes ✓",
  "topbar.menu.recent": "Recent changes ▾",
  "topbar.menu.no.commits": "No commits yet",
  "topbar.menu.export": "Export",
  "topbar.menu.export.title": "Download the full project JSON (incl. archive and history)",
  "topbar.menu.ai": "AI access guide",
  "topbar.menu.lang.to_en": "Switch to English",
  "topbar.menu.lang.to_zh": "切换为 中文",
  "topbar.refresh": "Refresh",
  "topbar.refresh.title": "Manually check whether records changed",
  "topbar.actor": "Identity: {actor}",
  "topbar.actor.title": "Who is signed in for this session (decided by the token; cannot be forged)",
  "topbar.conn.version": " · v{v}",
  "topbar.conn.project": " · project v{v}",
  "topbar.exit": "Exit",
  "topbar.exit.title": "Exit (clears the in-memory token; you will re-enter it)",

  // ---- formatters (used across screens) -------------------------------------
  "common.first.level.node": "top-level node",
};
