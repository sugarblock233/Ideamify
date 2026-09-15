import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasLayoutView,
  loadAppPrefs,
  loadLayoutView,
  loadProjectViewPrefs,
  loadSavedView,
  saveAppPrefs,
  saveLayoutView,
  saveProjectViewPrefs,
  saveView,
  type SavedStore,
} from "../viewPrefs";

/* vitest runs in a node environment — provide a deterministic localStorage. */
function stubStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => void map.clear(),
    key: () => null,
    length: 0,
  });
}

beforeEach(() => stubStorage());
afterEach(() => vi.unstubAllGlobals());

const PID = "11111111-1111-4111-8111-111111111111";

describe("SavedView v1 → v2 migration", () => {
  it("reads a legacy v1 blob back as the horizontal layout", () => {
    localStorage.setItem(
      `rm.view.${PID}`,
      JSON.stringify({ folds: ["a", "b"], branchRoot: "route1", viewport: { x: 10, y: 20, zoom: 0.7 } }),
    );
    const v = loadSavedView(PID);
    expect(v.folds).toEqual(["a", "b"]);
    expect(v.branchRoot).toBe("route1");
    expect(v.viewport).toEqual({ x: 10, y: 20, zoom: 0.7 });
  });

  it("hasLayoutView: absent slot vs explicit entry (B2 virgin semantics)", () => {
    // nothing saved at all: both slots are virgin
    expect(hasLayoutView(PID, "h")).toBe(false);
    expect(hasLayoutView(PID, "v")).toBe(false);
    // an explicit expand-all-without-viewport entry IS an entry
    saveLayoutView(PID, "v", { folds: [], branchRoot: null, viewport: null });
    expect(hasLayoutView(PID, "v")).toBe(true);
    expect(hasLayoutView(PID, "h")).toBe(false);
    // a v1 blob hands "h" its entry without being written as v2
    localStorage.setItem(
      `rm.view.${PID}`,
      JSON.stringify({ folds: [], branchRoot: null, viewport: null }),
    );
    expect(hasLayoutView(PID, "h")).toBe(true);
  });

  it("writes v2 with the version field and keeps sibling layout slots", () => {
    saveLayoutView(PID, "outline", { folds: ["x"], branchRoot: null, viewport: null });
    saveView(PID, { folds: ["a"], branchRoot: "r", viewport: { x: 1, y: 2, zoom: 0.9 } });
    const raw = JSON.parse(localStorage.getItem(`rm.view.${PID}`)!) as SavedStore;
    expect(raw.version).toBe(2);
    expect(raw.layouts.h?.folds).toEqual(["a"]);
    expect(raw.layouts.h?.viewport).toEqual({ x: 1, y: 2, zoom: 0.9 });
    expect(raw.layouts.outline?.folds).toEqual(["x"]);
    // patching h does not clobber outline
    loadSavedView(PID);
    saveView(PID, { folds: [], branchRoot: null, viewport: null });
    const raw2 = JSON.parse(localStorage.getItem(`rm.view.${PID}`)!) as SavedStore;
    expect(raw2.layouts.outline?.folds).toEqual(["x"]);
  });

  it("returns fresh defaults for unknown layouts and missing keys", () => {
    expect(loadSavedView(PID)).toEqual({ folds: [], branchRoot: null, viewport: null });
    expect(loadLayoutView(PID, "v")).toEqual({ folds: [], branchRoot: null, viewport: null });
  });

  it("tolerates malformed JSON and junk slot payloads", () => {
    localStorage.setItem(`rm.view.${PID}`, "{not json");
    expect(loadSavedView(PID)).toEqual({ folds: [], branchRoot: null, viewport: null });
    localStorage.setItem(
      `rm.view.${PID}`,
      JSON.stringify({ version: 2, layouts: { h: { folds: "nope", viewport: { x: "x" } } } }),
    );
    const v = loadSavedView(PID);
    expect(v.folds).toEqual([]);
    expect(v.viewport).toBeNull();
    expect(v.branchRoot).toBeNull();
  });

  it("preserves an explicit-viewport round trip exactly", () => {
    const vp = { x: -123.45, y: 678.9, zoom: 0.73 };
    saveView(PID, { folds: ["n1"], branchRoot: null, viewport: vp });
    expect(loadSavedView(PID).viewport).toEqual(vp);
  });
});

describe("app prefs (side panel)", () => {
  it("defaults to null sentinels (user never chose)", () => {
    expect(loadAppPrefs()).toEqual({ version: 1, side: { width: null, collapsed: null } });
  });

  it("merges patches and persists", () => {
    saveAppPrefs({ width: 380 });
    expect(loadAppPrefs().side).toEqual({ width: 380, collapsed: null });
    saveAppPrefs({ collapsed: true });
    expect(loadAppPrefs().side).toEqual({ width: 380, collapsed: true });
  });

  it("ignores junk values instead of trusting storage", () => {
    localStorage.setItem("rm.prefs.app", JSON.stringify({ side: { width: "wide", collapsed: 1 } }));
    expect(loadAppPrefs().side).toEqual({ width: null, collapsed: null });
    localStorage.setItem("rm.prefs.app", "{broken");
    expect(loadAppPrefs().side).toEqual({ width: null, collapsed: null });
  });
});

describe("project view prefs", () => {
  it("defaults to horizontal tree, auto density, no low-interference, no version filter", () => {
    expect(loadProjectViewPrefs(PID)).toEqual({
      version: 1,
      layout: "h",
      density: "auto",
      lowInterference: false,
      versionId: null,
    });
  });

  it("per-project isolation", () => {
    saveProjectViewPrefs(PID, { density: "overview" });
    expect(loadProjectViewPrefs(PID).density).toBe("overview");
    expect(loadProjectViewPrefs("other-pid").density).toBe("auto");
  });

  it("rejects unknown enum values from storage", () => {
    // E5: "swimlane" became a real mode — use a value that stays junk.
    localStorage.setItem(`rm.prefs.${PID}`, JSON.stringify({ layout: "diagonal", density: 3 }));
    const p = loadProjectViewPrefs(PID);
    expect(p.layout).toBe("h");
    expect(p.density).toBe("auto");
  });

  it("persists the version filter across sessions (E 批 §7)", () => {
    saveProjectViewPrefs(PID, { versionId: "ver-uuid-1" });
    expect(loadProjectViewPrefs(PID).versionId).toBe("ver-uuid-1");
    // junk / absent → null, never a truthy non-string
    saveProjectViewPrefs(PID, { versionId: 3 as unknown as string });
    expect(loadProjectViewPrefs(PID).versionId).toBe(null);
  });
});
