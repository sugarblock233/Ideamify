/** E5 swimlane layout contract tests: deterministic grid, no overlaps,
 *  「未分配」 pseudo-column last, cell stacking by (order_index, id) — plus
 *  the plan's 1104-node timing gate (adopt only if < 250ms).
 */

import { describe, expect, it } from "vitest";
import {
  cardsOverlap,
  computeSwimlane,
  DRAFT_H,
  DRAFT_W,
  rootIdOf,
  SWIM_CELL_STEP,
  SWIM_HEADER_GAP,
  SWIM_INSTANCE_SEP,
  swimlaneDraftPlacement,
} from "../layout";
import { VERSION_FILTER_UNASSIGNED } from "../versionFilter";
import type { GraphNode, ResearchVersion } from "../types";
function node(
  id: string,
  parent_id: string | null,
  version_ids: string[],
  order_index = 0,
): GraphNode {
  return {
    id,
    parent_id,
    order_index,
    kind: "idea",
    title: id,
    summary: "",
    status: "unexplored",
    tags: [],
    evidence_count: 0,
    child_count: 0,
    relation_count: 0,
    version_ids,
    created_at: "",
    updated_at: "",
    created_by: "",
  };
}

const VERSIONS: ResearchVersion[] = [
  { id: "v1", name: "第一轮", order_index: 0, description: "", archived: false, created_at: "", updated_at: "" },
  { id: "v2", name: "第二轮", order_index: 1, description: "", archived: false, created_at: "", updated_at: "" },
];

/**  routes r1, r2; r1 children spread across v1 / v2 / unassigned */
function fixture(): GraphNode[] {
  return [
    node("r1", null, [], 0),
    node("r2", null, [], 1),
    node("a", "r1", ["v1"], 2),
    node("b", "r1", ["v2"], 3),
    node("c", "r1", [], 3),
    node("d", "a", ["v2"], 4), // deeper node rides its route's row
  ];
}

const PID = "swim-proj";
const draw = (nodes = fixture(), versions = VERSIONS) =>
  computeSwimlane(PID, nodes, versions, "未分配");

describe("computeSwimlane", () => {
  it("places every node once on the grid", () => {
    const ns = fixture();
    const r = draw(ns);
    for (const n of ns) expect(r.positions.has(n.id)).toBe(true);
    expect(r.positions.has(rootIdOf(PID))).toBe(false); // no virtual root in a swimlane
    expect(r.visibleIds.size).toBe(ns.length);
  });

  it("never overlaps two placed cards", () => {
    const list = [...draw().positions.values()];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        expect(cardsOverlap(list[i], list[j]), `${list[i].id}↔${list[j].id}`).toBe(false);
  });

  it("columns follow version order with 「未分配」 last; header band above cards", () => {
    const r = draw(fixture());
    const g = r.swimlane!;
    expect(g.cols.map((c) => c.label)).toEqual(["第一轮", "第二轮", "未分配"]);
    expect(g.cols[0].key).toBe("v1");
    expect(g.cols[2].key).toBe(VERSION_FILTER_UNASSIGNED);
    const topY = Math.min(...[...r.positions.values()].map((p) => p.y));
    expect(g.minY).toBeLessThanOrEqual(topY);
  });

  it("each card lands in its first known version's column, route row", () => {
    const r = draw(fixture());
    const g = r.swimlane!;
    const colX = new Map(g.cols.map((c) => [c.key, c.x]));
    // "a" is v1 → first column; "b" is v2 → second; "c" unassigned → last
    expect(r.positions.get("a")!.x).toBe(colX.get("v1"));
    expect(r.positions.get("b")!.x).toBe(colX.get("v2"));
    expect(r.positions.get("c")!.x).toBe(colX.get(VERSION_FILTER_UNASSIGNED));
    // rows: r1's row for a/b/c (r1 itself on its own row, top), r2 after r1
    const rowY = new Map(g.rows.map((rw) => [rw.id, rw.y]));
    expect(r.positions.get("a")!.y).toBe(rowY.get("r1"));
    expect(r.positions.get("r1")!.y).toBe(rowY.get("r1"));
  });

  it("stacks cell-mates deterministically in SWIM_CELL_STEP steps", () => {
    const ns = [
      node("r1", null, [], 0),
      node("x1", "r1", ["v1"], 1),
      node("x2", "r1", ["v1"], 2),
      node("x3", "r1", ["v1"], 3),
    ];
    const r = draw(ns);
    const ys = ["x1", "x2", "x3"].map((id) => r.positions.get(id)!.y);
    expect(ys).toEqual([
      r.positions.get("r1")!.y,
      r.positions.get("r1")!.y + SWIM_CELL_STEP,
      r.positions.get("r1")!.y + SWIM_CELL_STEP * 2,
    ]);
    // row height covers the deepest stack
    expect(r.swimlane!.rows[0].height).toBeGreaterThanOrEqual(SWIM_CELL_STEP * 3);
  });

  it("is deterministic across runs (same nodes+versions ⇒ same coords)", () => {
    expect(JSON.stringify([...draw().positions]))
      .toBe(JSON.stringify([...draw(fixture()).positions]));
  });

  it("tolerates nodes without version_ids and with unknown version refs", () => {
    const ns = [node("g1", null, undefined as unknown as string[], 0), node("g2", "g1", ["ghost"], 1)];
    const r = draw(ns, []);
    expect(r.positions.get("g1")!.x).toBe(0); // the only (unassigned) column
    expect(r.positions.has("g2")).toBe(true);
  });

  it("cards do not collide pairwise on the stress fixture too", () => {
    const list = [...draw(fixture(), VERSIONS).positions.values()];
    expect(list.length).toBeGreaterThan(0);
    for (const a of list) for (const b of list) if (a !== b) expect(cardsOverlap(a, b)).toBe(false);
  });

  /* ---- F04: multi-version shared nodes get a display instance per lane ---- */

  function drawO(ns: GraphNode[], opts?: { activeVersion?: string | null }) {
    return computeSwimlane(PID, ns, VERSIONS, "未分配", opts);
  }

  it("shows a shared node once per matched column; the first instance keeps the business id", () => {
    const ns = [
      node("r1", null, [], 0),
      node("s1", "r1", ["v2", "v1"], 1), // shared v1+v2
      node("only1", "r1", ["v1"], 2),
    ];
    const r = draw(ns);
    const colX = new Map(r.swimlane!.cols.map((c) => [c.key, c.x]));
    // primary instance = business id, leftmost matched column (v1)
    expect(r.positions.get("s1")!.x).toBe(colX.get("v1"));
    // second display instance lands in v2, id derived, marked with sharedOf
    const extraId = `s1${SWIM_INSTANCE_SEP}v2`;
    expect(r.positions.has(extraId)).toBe(true);
    expect(r.positions.get(extraId)!.x).toBe(colX.get("v2"));
    expect(r.positions.get(extraId)!.sharedOf).toBe("s1");
    expect(r.positions.get("s1")!.sharedOf).toBeUndefined();
    // single-assignment nodes are not mirrored
    expect(r.positions.size).toBe(4);
    expect(r.visibleIds.has(extraId)).toBe(true);
  });

  it("under a single-version filter puts the filtered shared node in the filtered column only", () => {
    const ns = [
      node("r1", null, [], 0),
      node("s1", "r1", ["v1", "v2"], 1),
      node("ctx", "r1", ["v1"], 2), // context ancestor not carrying the filter
    ];
    const r = drawO(ns, { activeVersion: "v2" });
    const colX = new Map(r.swimlane!.cols.map((c) => [c.key, c.x]));
    expect(r.positions.get("s1")!.x).toBe(colX.get("v2"));
    expect([...r.positions.keys()].filter((k) => k.startsWith(`s1${SWIM_INSTANCE_SEP}`))).toEqual([]);
    // context keeps the first-known-column rule
    expect(r.positions.get("ctx")!.x).toBe(colX.get("v1"));
  });

  it("no filter: instances do not collide and stay deterministic", () => {
    const ns = [
      node("r1", null, [], 0),
      node("s1", "r1", ["v2", "v1"], 1),
    ];
    const a = draw(ns);
    const b = draw([...ns]);
    expect(JSON.stringify([...a.positions])).toBe(JSON.stringify([...b.positions]));
    const list = [...a.positions.values()];
    for (const x of list) for (const y of list) if (x !== y) expect(cardsOverlap(x, y)).toBe(false);
  });

  it("business-id counting stays deduplicated: every graph node still has a primary instance", () => {
    const ns = [
      node("r1", null, [], 0),
      node("s1", "r1", ["v1", "v2"], 1),
      node("s2", "r1", ["v1", "v2"], 2),
    ];
    const r = draw(ns);
    for (const n of ns) expect(r.positions.has(n.id)).toBe(true);
    // 3 nodes + 4 extra (2 shared × 2nd lane each... s1,s2 both have 2 lanes → 1 extra each)
    expect(r.positions.size).toBe(ns.length + 2);
  });
});

/* ---- F05: the create-draft needs a visible spot on the swimlane grid ---- */

describe("swimlaneDraftPlacement (F05)", () => {
  const unassignedX = (r: ReturnType<typeof draw>) =>
    r.swimlane!.cols.find((c) => c.key === VERSION_FILTER_UNASSIGNED)!.x;

  it("empty grid: deterministic spot at the 未分配 origin (header band floor)", () => {
    const s1 = swimlaneDraftPlacement(new Map(), null, 0);
    const s2 = swimlaneDraftPlacement(new Map(), null, 0);
    expect(s1.x).toBe(0); // the only column sits at x=0 before any versions exist
    expect(s1.y).toBeGreaterThanOrEqual(SWIM_HEADER_GAP);
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });

  it("top-level draft: 未分配 column, below the deepest grid card", () => {
    const r = draw();
    const bottom = Math.max(...[...r.positions.values()].map((p) => p.y + p.height));
    const s = swimlaneDraftPlacement(r.positions, null, unassignedX(r));
    expect(s.x).toBe(unassignedX(r)); // a new route has no version yet
    expect(s.y).toBeGreaterThanOrEqual(bottom);
    // clear of every placed card
    for (const pos of r.positions.values())
      expect(
        s.x < pos.x + pos.width && pos.x < s.x + DRAFT_W &&
        s.y < pos.y + pos.height && pos.y < s.y + DRAFT_H,
      ).toBe(false);
  });

  it("child draft: one cell step below its parent's primary instance", () => {
    const r = draw();
    const parent = r.positions.get("a")!;
    const s = swimlaneDraftPlacement(r.positions, "a", unassignedX(r));
    expect(s.anchorId).toBe("a");
    expect(s.x).toBe(parent.x);
    expect(s.y).toBeGreaterThanOrEqual(parent.y + SWIM_CELL_STEP);
  });

  it("child draft with the parent off-grid falls back to the 未分配 dock", () => {
    const r = draw();
    const sTop = swimlaneDraftPlacement(r.positions, null, unassignedX(r));
    const s = swimlaneDraftPlacement(r.positions, "ghost", unassignedX(r));
    expect(s.anchorId).toBe("");
    expect(s.x).toBe(sTop.x);
    expect(s.y).toBeGreaterThanOrEqual(sTop.y);
  });
});

/* ---- 1104-node fixture: the plan adopts the swimlane only if layout stays
 * under 250ms on scripts/stress_test.py output. Same loud-missing gate as the
 * tree stress suite. */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const FIXTURE = fileURLToPath(new URL("./fixtures/stress-graph.json", import.meta.url));
if (existsSync(FIXTURE)) {
  const stress: GraphNode[] = (JSON.parse(readFileSync(FIXTURE, "utf-8")) as { nodes: GraphNode[] })
    .nodes.map((n) => ({ ...n, version_ids: n.version_ids ?? [] }));
  // One fake version for a third of the graph so lane packing is realistic.
  const withVersions = stress.map((n, i) =>
    n.parent_id === null ? n : { ...n, version_ids: i % 3 === 0 ? ["v1"] : [] },
  );
  const versions: ResearchVersion[] = [
    { id: "v1", name: "v1", order_index: 0, description: "", archived: false, created_at: "", updated_at: "" },
  ];

  describe("stress swimlane (E5)", () => {
    it(`lays out ${stress.length} nodes in < 250ms and without overlaps`, () => {
      const t0 = performance.now();
      const r = computeSwimlane("stress-proj", withVersions, versions, "未分配");
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(250);
      expect(r.positions.size).toBe(stress.length);
      const list = [...r.positions.values()];
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          expect(cardsOverlap(list[i], list[j])).toBe(false);
    });
  });
}
