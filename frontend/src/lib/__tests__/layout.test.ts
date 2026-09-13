/** T02 unit tests: the main-tree layout is deterministic and the placed
 *  cards never overlap. Also pins the SPEC 2.4 axis contract
 *  (canvasX = d3.y − W/2, canvasY = d3.x − H/2) and fold semantics
 *  (SPEC 2.4: a fold hides the subtree but keeps the folded node itself
 *  visible, and the fold button reports how many direct children are hidden). */

import { describe, expect, it } from "vitest";
import {
  buildTreeData,
  cardsOverlap,
  computeLayout,
  rootIdOf,
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

describe("computeLayout", () => {
  it("places the virtual root and every visible node", () => {
    const r = computeLayout(PID, tree(), new Set(), null);
    expect(r.positions.has(rootIdOf(PID))).toBe(true);
    for (const n of tree()) expect(r.positions.has(n.id)).toBe(true);
    expect([...r.visibleIds].sort()).toEqual(["a", "a1", "a2", "a2x", "b", "b1", "c"]);
  });

  it("is deterministic (same input ⇒ identical coordinates)", () => {
    const a = computeLayout(PID, tree(), new Set(), null);
    const b = computeLayout(PID, tree(), new Set(), null);
    expect(JSON.stringify([...a.positions])).toBe(JSON.stringify([...b.positions]));
  });

  it("never overlaps two placed cards", () => {
    const { positions } = computeLayout(PID, tree(), new Set(), null);
    const list = [...positions.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        expect(cardsOverlap(list[i], list[j]), `${list[i].id} ↔ ${list[j].id}`).toBe(false);
      }
    }
  });

  it("environments children cards horizontally deeper than their parent " +
    "(canvasX = d3.y − W/2, depth grows along +X)", () => {
    const { positions } = computeLayout(PID, tree(), new Set(), null);
    const parent = positions.get("a")!;
    for (const kid of ["a1", "a2"]) {
      const c = positions.get(kid)!;
      expect(c.x).toBeGreaterThan(parent.x);
      // depth gap is NODE_SIZE[1] = 380 (canvasX = d3.y − W/2, d3.y = depth*380)
      expect(c.x - parent.x).toBeCloseTo(380, 3);
    }
  });

  it("orders siblings by (order_index, id), not insertion order", () => {
    // shuffle the input array; canonical order must survive
    const shuffled = [...tree()].reverse();
    const { positions } = computeLayout(PID, shuffled, new Set(), null);
    const a = positions.get("a")!, b = positions.get("b")!, c = positions.get("c")!;
    expect(a.y).toBeLessThan(b.y);
    expect(b.y).toBeLessThan(c.y);
  });
});

describe("computeLayout · folds (SPEC 2.4)", () => {
  it("keeps the folded node visible, hides its whole subtree, and counts hidden direct children", () => {
    const { positions, visibleIds } = computeLayout(PID, tree(), new Set(["a2"]), null);
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
    const { visibleIds } = computeLayout(PID, tree(), new Set(["a"]), null);
    expect(visibleIds.has("a")).toBe(true);
    expect(visibleIds.has("a1")).toBe(false);
    expect(visibleIds.has("a2")).toBe(false);
    expect(visibleIds.has("a2x")).toBe(false);
    const a = computeLayout(PID, tree(), new Set(["a"]), null).positions.get("a")!;
    expect(a.hiddenCount).toBe(2); // a1 and a2 are hidden direct children
  });
});

describe("computeLayout · branch focus (SPEC 2.4)", () => {
  it("keeps only the chosen branch root's subtree, plus the focused node's ancestors", () => {
    const { visibleIds } = computeLayout(PID, tree(), new Set(), "a2");
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

describe("buildTreeData (folded-ancestor visibility)", () => {
  it("hides grandchildren even when the grandparent is not folded", () => {
    const { root, visibleIds } = buildTreeData(tree(), new Set(["a2"]), null);
    expect(root).not.toBeNull();
    expect(visibleIds.has("a2x")).toBe(false);
    expect(visibleIds.has("a2")).toBe(true);
  });
});