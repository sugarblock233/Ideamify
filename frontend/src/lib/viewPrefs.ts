/** Browser-side view preferences and saved views (DECISIONS §13 视图偏好存储).
 *
 * Keys, deliberately one concern per key so the high-frequency writers never
 * share state:
 * - `rm.lang`         global language choice (owned by lib/i18n.ts)
 * - `rm.prefs.app`    global chrome prefs — side panel width/collapse
 * - `rm.prefs.<pid>`  per-project view choices — layout, density, 低干扰
 * - `rm.view.<pid>`   SavedView v2 — per-layout folds / branch / viewport
 *
 * `rm.view.<pid>` v1 stored `{folds, branchRoot, viewport}` with no version
 * field. v2 wraps each layout's view in `layouts`; a v1 blob is read back as
 * `layouts.h`. Folds/viewport are browser-only state (SPEC 2.4/3.2) so a
 * storage-format migration here can never touch server data.
 */

export type LayoutMode = "h" | "v" | "outline";
export type DensityMode = "auto" | "reading" | "compact" | "overview";

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** One layout's browser view state (what v1 called SavedView). */
export interface LayoutView {
  folds: string[];
  branchRoot: string | null;
  viewport: Viewport | null;
}

/** Legacy-facing alias: fields of the horizontal-tree view, as v1 exposed them. */
export type SavedView = LayoutView;

export interface SavedStore {
  version: 2;
  layouts: Partial<Record<LayoutMode, LayoutView>>;
}

const VIEW_KEY = (pid: string) => `rm.view.${pid}`;
const APP_PREFS_KEY = "rm.prefs.app";
const PROJ_PREFS_KEY = (pid: string) => `rm.prefs.${pid}`;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return undefined;
    return JSON.parse(raw);
  } catch {
    /* private mode / cleared / malformed — treat as absent */
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function isViewport(v: unknown): v is Viewport {
  return (
    typeof v === "object" &&
    v !== null &&
    Number.isFinite((v as Viewport).x) &&
    Number.isFinite((v as Viewport).y) &&
    Number.isFinite((v as Viewport).zoom)
  );
}

function asLayoutView(v: unknown): LayoutView {
  if (typeof v !== "object" || v === null) return { folds: [], branchRoot: null, viewport: null };
  const o = v as Record<string, unknown>;
  return {
    folds: Array.isArray(o.folds) ? o.folds.filter((x): x is string => typeof x === "string") : [],
    branchRoot: typeof o.branchRoot === "string" ? o.branchRoot : null,
    viewport: isViewport(o.viewport) ? { ...o.viewport } : null,
  };
}

function parseSavedStore(raw: unknown): SavedStore {
  if (typeof raw !== "object" || raw === null) return { version: 2, layouts: {} };
  const o = raw as Record<string, unknown>;
  if (o.version === 2 && typeof o.layouts === "object" && o.layouts !== null) {
    const layouts: SavedStore["layouts"] = {};
    for (const m of ["h", "v", "outline"] as const) {
      const slot = (o.layouts as Record<string, unknown>)[m];
      if (slot !== undefined) layouts[m] = asLayoutView(slot);
    }
    return { version: 2, layouts };
  }
  /* v1 blob (or anything else): its fields describe the horizontal tree. */
  return { version: 2, layouts: { h: asLayoutView(o) } };
}

/** Load one layout's saved view; missing fields come back as the fresh defaults
 *  (empty folds = expand-all, no branch filter, no stored viewport). */
export function loadLayoutView(pid: string, layout: LayoutMode): LayoutView {
  const store = parseSavedStore(readJson(VIEW_KEY(pid)));
  const hit = store.layouts[layout];
  if (!hit) return { folds: [], branchRoot: null, viewport: null };
  return { folds: [...hit.folds], branchRoot: hit.branchRoot, viewport: hit.viewport ? { ...hit.viewport } : null };
}

/** Patch one layout's saved view (merge, never clobber the sibling layouts). */
export function saveLayoutView(pid: string, layout: LayoutMode, v: LayoutView): void {
  const store = parseSavedStore(readJson(VIEW_KEY(pid)));
  store.layouts[layout] = {
    folds: [...v.folds],
    branchRoot: v.branchRoot,
    viewport: v.viewport ? { ...v.viewport } : null,
  };
  writeJson(VIEW_KEY(pid), store);
}

/** v1-shaped accessors used by Canvas/Workspace for the horizontal tree.
 *  Kept standalone so both writers keep their exact read-modify-write shape. */
export function loadSavedView(pid: string): SavedView {
  return loadLayoutView(pid, "h");
}

export function saveView(pid: string, v: SavedView): void {
  saveLayoutView(pid, "h", v);
}

// ---------------------------------------------------------------------------
// Global chrome prefs (side panel). null = the user never made a choice here.

export interface AppPrefs {
  version: 1;
  side: { width: number | null; collapsed: boolean | null };
}

function asAppPrefs(raw: unknown): AppPrefs {
  const fallback: AppPrefs = { version: 1, side: { width: null, collapsed: null } };
  if (typeof raw !== "object" || raw === null) return fallback;
  const side = (raw as Record<string, unknown>).side;
  if (typeof side !== "object" || side === null) return fallback;
  const s = side as Record<string, unknown>;
  return {
    version: 1,
    side: {
      width: typeof s.width === "number" && Number.isFinite(s.width) ? s.width : null,
      collapsed: typeof s.collapsed === "boolean" ? s.collapsed : null,
    },
  };
}

export function loadAppPrefs(): AppPrefs {
  return asAppPrefs(readJson(APP_PREFS_KEY));
}

export function saveAppPrefs(patch: Partial<AppPrefs["side"]>): AppPrefs {
  const cur = loadAppPrefs();
  const next: AppPrefs = {
    version: 1,
    side: { ...cur.side, ...patch },
  };
  writeJson(APP_PREFS_KEY, next);
  return next;
}

// ---------------------------------------------------------------------------
// Per-project view prefs.

export interface ProjectViewPrefs {
  version: 1;
  layout: LayoutMode;
  density: DensityMode;
  lowInterference: boolean;
}

const LAYOUTS: readonly LayoutMode[] = ["h", "v", "outline"];
const DENSITIES: readonly DensityMode[] = ["auto", "reading", "compact", "overview"];

export function projectViewPrefsDefaults(): ProjectViewPrefs {
  return { version: 1, layout: "h", density: "auto", lowInterference: false };
}

export function loadProjectViewPrefs(pid: string): ProjectViewPrefs {
  const raw = readJson(PROJ_PREFS_KEY(pid));
  if (typeof raw !== "object" || raw === null) return projectViewPrefsDefaults();
  const o = raw as Record<string, unknown>;
  return {
    version: 1,
    layout: LAYOUTS.includes(o.layout as LayoutMode) ? (o.layout as LayoutMode) : "h",
    density: DENSITIES.includes(o.density as DensityMode) ? (o.density as DensityMode) : "auto",
    lowInterference: o.lowInterference === true,
  };
}

export function saveProjectViewPrefs(
  pid: string,
  patch: Partial<Omit<ProjectViewPrefs, "version">>,
): ProjectViewPrefs {
  const next: ProjectViewPrefs = { ...loadProjectViewPrefs(pid), ...patch };
  writeJson(PROJ_PREFS_KEY(pid), next);
  return next;
}
