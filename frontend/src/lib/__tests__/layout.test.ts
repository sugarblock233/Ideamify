/** T02 unit tests: the main-tree layout is deterministic and the placed
 *  cards never overlap. B2 runs every structural contract in both canvas
 *  orientations ("h" left-to-right per SPEC 2.4, "v" top-to-bottom per
 *  DECISIONS §15); the mode-specific axis contracts are pinned per mode.
 *  Also pins fold semantics (SPEC 2.4: a fold hides the subtree but keeps
 *  the folded node itself visible, and the fold button reports how many
 *  direct children are hidden). */

import { describe, expect, it } from "vitest";
import {
  buildTreeData,
  cardsOverlap,
  computeLayout,
  draftPlacement,
  CARD_W,
  CARD_H,
  DRAFT_H,
  DRAFT_W,
  NODE_SIZE,
  NODE_SIZE_V,
  rootIdOf,
  type LayoutMode,
  type PlacedNode,
} from "../layout";
import type { GraphNode, NodeKind, NodeStatus } from "../types";

const PID = "p1";

function node(
  id: string,
  parent_id: string | null,
  order_index: number,
  extra: Partial<GraphNode> = {},
): GraphNode {
  return {
    id,
    parent_id,
    order_index,
    kind: "idea" as NodeKind,
    title: id,
    summary: "",
    status: "unexplored" as NodeStatus,
    tags: [],
    evidence_count: 0,
    child_count: 0,
    relation_count: 0,
    version_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: "t",
    ...extra,
  };
}

/** A small non-trivial tree:
 *
 *   (root) ─ a ─ a1, a2 (a2 has a2x)
 *            └ b ─ b1
 *            └ c
 */
function tree(): GraphNode[] {
  return [
    node("a", null, 0),
    node("b", null, 1),
    node("c", null, 2),
    node("a1", "a", 0),
    node("a2", "a", 1),
    node("b1", "b", 0),
    node("a2x", "a2", 0),
  ];
}

describe.each<LayoutMode>(["h", "v"])("computeLayout ×%s (B2)", (mode) => {
  const draw = (
    nodes: GraphNode[],
    folds: ReadonlySet<string> = new Set(),
    branchRoot: string | null = null,
  ) => computeLayout(PID, nodes, folds, branchRoot, mode);

  it("places the virtual root and every visible node", () => {
    const r = draw(tree());
    expect(r.positions.has(rootIdOf(PID))).toBe(true);
    for (const n of tree()) expect(r.positions.has(n.id)).toBe(true);
    expect([...r.visibleIds].sort()).toEqual(["a", "a1", "a2", "a2x", "b", "b1", "c"]);
  });

  it("is deterministic (same input ⇒ identical coordinates)", () => {
    const a = draw(tree());
    const b = draw(tree());
    expect(JSON.stringify([...a.positions])).toBe(JSON.stringify([...b.positions]));
  });

  it("never overlaps two placed cards", () => {
    const { positions } = draw(tree());
    const list = [...positions.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(cardsOverlap(list[i], list[j]), `${list[i].id} ↔ ${list[j].id}`).toBe(false);
      }
    }
  });

  it("places children exactly one depth gap along the depth axis", () => {
    const { positions } = draw(tree());
    const parent = positions.get("a")!;
    for (const kid of ["a1", "a2"]) {
      const c = positions.get(kid)!;
      // h: canvasX = d3.y − W/2 with d3.y = depth*NODE_SIZE[1] (SPEC 2.4)
      // v: canvasY = d3.y − H/2 with d3.y = depth*NODE_SIZE_V[1] (§15)
      if (mode === "h") {
        expect(c.x).toBeGreaterThan(parent.x);
        expect(c.x - parent.x).toBeCloseTo(NODE_SIZE[1], 3);
      } else {
        expect(c.y).toBeGreaterThan(parent.y);
        expect(c.y - parent.y).toBeCloseTo(NODE_SIZE_V[1], 3);
      }
    }
  });

  it("orders siblings by (order_index, id), not insertion order", () => {
    // shuffle the input array; canonical order must survive
    const shuffled = [...tree()].reverse();
    const { positions } = draw(shuffled);
    const a = positions.get("a")!, b = positions.get("b")!, c = positions.get("c")!;
    // siblings run along the sibling axis: +Y in h (axes swapped), +X in v
    const sib = (p: PlacedNode): number => (mode === "h" ? p.y : p.x);
    expect(sib(a)).toBeLessThan(sib(b));
    expect(sib(b)).toBeLessThan(sib(c));
  });

  it("folds keep the folded node visible, hide its whole subtree, and count hidden direct children", () => {
    const { positions, visibleIds } = draw(tree(), new Set(["a2"]));
    expect(positions.has("a2")).toBe(true); // the folded node itself stays
    expect(visibleIds.has("a2x")).toBe(false);
    expect(positions.has("a2x")).toBe(false); // and it is not placed
    // a and a1 remain
    expect(visibleIds.has("a")).toBe(true);
    expect(visibleIds.has("a1")).toBe(true);
    const a2 = positions.get("a2") as PlacedNode;
    expect(a2.hiddenCount).toBe(1); // a2x is the one hidden direct child
  });

  it("folding a top node hides all of its descendants", () => {
    const { visibleIds } = draw(tree(), new Set(["a"]));
    expect(visibleIds.has("a")).toBe(true);
    expect(visibleIds.has("a1")).toBe(false);
    expect(visibleIds.has("a2")).toBe(false);
    expect(visibleIds.has("a2x")).toBe(false);
    const a = draw(tree(), new Set(["a"])).positions.get("a")!;
    expect(a.hiddenCount).toBe(2); // a1 and a2 are hidden direct children
  });

  it("branch focus keeps only the chosen branch root's subtree", () => {
    const { visibleIds } = draw(tree(), new Set(), "a2");
    // branchRoot is "a2": only a2 + its descendants (a2x); a1, b, c are out.
    expect(visibleIds.has("a2")).toBe(true);
    expect(visibleIds.has("a2x")).toBe(true);
    expect(visibleIds.has("a1")).toBe(false);
    expect(visibleIds.has("b")).toBe(false);
    expect(visibleIds.has("c")).toBe(false);
    // the focused node's ancestors are NOT part of the branch tree (a is hidden)
    expect(visibleIds.has("a")).toBe(false);
  });
});

/** h keeps the SPEC 2.4 axis contract verbatim (it is the byte-identical
 *  orientation); v reverses the depth axis onto +Y. */
describe("computeLayout · h axis contract (SPEC 2.4)", () => {
  it("environments children cards horizontally deeper than their parent (depth grows along +X)", () => {
    const { positions } = computeLayout(PID, tree(), new Set(), null, "h");
    const parent = positions.get("a")!;
    for (const kid of ["a1", "a2"]) {
      const c = positions.get(kid)!;
      expect(c.x).toBeGreaterThan(parent.x);
      // depth gap is NODE_SIZE[1] = 380 (canvasX = d3.y − W/2, d3.y = depth*380)
      expect(c.x - parent.x).toBeCloseTo(380, 3);
    }
  });
});

describe("computeLayout v · mode constant (DECISIONS §15)", () => {
  it("spreads d3's(+X) sibling axis so same-depth top-levels share a row", () => {
    const { positions } = computeLayout(PID, tree(), new Set(), null, "v");
    const a = positions.get("a")!, b = positions.get("b")!, c = positions.get("c")!;
    // depth runs down (+Y), so top-level siblings line up in one row along
    // +X... sibling gaps grow with subtree widths (d3 separation), so pin
    // the row + order, not an exact step.
    expect(a.y).toBe(b.y);
    expect(b.y).toBe(c.y);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    // …and each card keeps the shared constant size in the vertical mode too
    const a1 = positions.get("a1")!, a2 = positions.get("a2")!;
    expect(a1.y - a.y).toBeCloseTo(NODE_SIZE_V[1], 3);
    expect(a2.y - a.y).toBeCloseTo(NODE_SIZE_V[1], 3);
    expect(a1.x).not.toBe(a2.x); // a1/a2 side by side, not stacked onto a
  });
});

describe("buildTreeData (folded-ancestor visibility)", () => {
  it("hides grandchildren even when the grandparent is not folded", () => {
    const { root, visibleIds } = buildTreeData(tree(), new Set(["a2"]), null);
    expect(root).not.toBeNull();
    expect(visibleIds.has("a2x")).toBe(false);
    expect(visibleIds.has("a2")).toBe(true);
  });
});

describe.each<LayoutMode>(["h", "v"])("draftPlacement ×%s (C3)", (mode) => {
  const layoutOf = (folds: ReadonlySet<string> = new Set(), branchRoot: string | null = null) =>
    computeLayout(PID, tree(), folds, branchRoot, mode);
  const rootId = rootIdOf(PID);

  it("docks a child draft beside its parent, clear of every placed card", () => {
    const { positions } = layoutOf();
    const anc = (id: string): string[] => {
      const byId = new Map(tree().map((n) => [n.id, n]));
      const chain: string[] = [];
      let cur = byId.get(id)?.parent_id ?? null;
      while (cur) { chain.push(cur); cur = byId.get(cur)?.parent_id ?? null; }
      return chain;
    };
    const tops = ["a", "b", "c"].map((id) => positions.get(id)!);
    const spot = draftPlacement(positions, "c", anc, rootId, mode as "h" | "v", tops);
    expect(spot).not.toBeNull();
    const s = spot!;
    expect(s.anchorId).toBe("c");
    // in the anchor's span direction: h → right of c, v → below c
    if (mode === "h") {
      expect(s.x).toBeGreaterThanOrEqual(tops[2].x + CARD_W);
      expect(s.y).toBeGreaterThanOrEqual(tops[2].y);
    } else {
      expect(s.y).toBeGreaterThanOrEqual(tops[2].y + CARD_H);
      expect(s.x).toBeGreaterThanOrEqual(tops[2].x);
    }
    // clear of all cards
    const rect = { x: s.x, y: s.y, width: DRAFT_W, height: DRAFT_H };
    for (const pos of positions.values()) {
      expect(
        rect.x < pos.x + pos.width && pos.x < rect.x + rect.width &&
        rect.y < pos.y + pos.height && pos.y < rect.y + rect.height,
      ).toBe(false);
    }
  });

  it("docks a top-level draft after the LAST route, not between routes", () => {
    const { positions } = layoutOf();
    const anc = () => [] as string[];
    const tops = ["a", "b", "c"].map((id) => positions.get(id)!);
    const spot = draftPlacement(positions, null, anc, rootId, mode as "h" | "v", tops)!;
    // h: below the last route's row; v: right of the last route's column
    if (mode === "h") expect(spot.y).toBeGreaterThan(tops[2].y);
    else expect(spot.x).toBeGreaterThan(tops[2].x);
    expect(spot.anchorId).toBe(rootId);
  });

  it("falls back to an ancestor when the parent is folded away", () => {
    // fold a2 → a2's subtree hidden; a draft under a2x must dock at a2's
    // nearest visible ancestor (a2 itself stays visible under a fold of a —
    // so fold "a" instead, which hides a1/a2/a2x behind a's fold button).
    const { positions, visibleIds } = layoutOf(new Set(["a"]));
    expect(visibleIds.has("a2x")).toBe(false);
    const anc = (id: string): string[] => {
      const byId = new Map(tree().map((n) => [n.id, n]));
      const chain: string[] = [];
      let cur = byId.get(id)?.parent_id ?? null;
      while (cur) { chain.push(cur); cur = byId.get(cur)?.parent_id ?? null; }
      return chain;
    };
    const tops = ["a", "b", "c"].map((tid) => positions.get(tid)!);
    const spot = draftPlacement(positions, "a2x", anc, rootId, mode as "h" | "v", tops)!;
    expect(spot.anchorId).toBe("a"); // nearest visible ancestor on canvas
  });

  it("is deterministic: same inputs, same spot", () => {
    const { positions } = layoutOf();
    const anc = () => [] as string[];
    const tops = ["a", "b", "c"].map((id) => positions.get(id)!);
    const s1 = draftPlacement(positions, "b", anc, rootId, mode as "h" | "v", tops);
    const s2 = draftPlacement(positions, "b", anc, rootId, mode as "h" | "v", tops);
    expect(s1).toEqual(s2);
  });

  it("empty canvas (F05): deterministic origin where the first root card lands", () => {
    const empty = new Map<string, PlacedNode>();
    const s = draftPlacement(empty, null, () => [], rootId, mode as "h" | "v", [])!;
    expect(s.x).toBe(-CARD_W / 2);
    expect(s.y).toBe(-CARD_H / 2);
    expect(draftPlacement(empty, "ghost", () => [], rootId, mode as "h" | "v", []))
      .toEqual(s); // no parent cards either — same origin
  });
});
