/** A03 unit tests: the first-open default fold set (SPEC 3.1 / A03).
 *
 * When a browser has no saved view for the project, the canvas shows only
 * the virtual project root plus the first two business levels: every node
 * at depth ≥ 2 that has children is folded (its subtree is hidden but still
 * expandable, via the fold handle); top-level routes (depth 1, parent null)
 * and leaves are never folded. */

import { describe, expect, it } from "vitest";
import { initialFolds } from "../layout";
import type { GraphNode, NodeKind, NodeStatus } from "../types";

function g(id: string, parent_id: string | null, child_count = 0): GraphNode {
  return {
    id,
    parent_id,
    order_index: 0,
    kind: "idea" as NodeKind,
    title: id,
    summary: "",
    status: "unexplored" as NodeStatus,
    tags: [],
    evidence_count: 0,
    child_count,
    relation_count: 0,
    version_ids: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    created_by: "t",
  };
}

describe("initialFolds (A03: first-open default fold)", () => {
  it("folds only depth ≥ 2 nodes that have children", () => {
    const nodes = [
      g("A", null, 3), // depth-1 route with children — stays expanded
      g("B", "A", 1), // depth 2, has a child → folded
      g("Bc", "B", 0), // depth-3 leaf — untouched (hidden anyway via B)
      g("C", "A", 0), // depth-2 leaf — nothing to hide
      g("D", null, 0), // top-level leaf — untouched
      g("E", "B", 2), // depth 3, has children → folded (deep work stays expandable)
      g("E1", "E", 0),
      g("E2", "E", 0),
    ];
    expect([...initialFolds(nodes)].sort()).toEqual(["B", "E"]);
  });

  it("is a pure function of the node list (same input → same set)", () => {
    const nodes = [g("A", null, 1), g("B", "A", 1), g("Bc", "B", 0)];
    expect(initialFolds(nodes).size).toBe(1);
    const again = initialFolds(nodes);
    expect([...again]).toEqual(["B"]);
    // calling twice costs a fresh walk; result is stable
    expect([...initialFolds(nodes)]).toEqual(["B"]);
  });

  it("returns an empty fold set for an empty graph", () => {
    expect(initialFolds([]).size).toBe(0);
  });

  it("walks terminate on unknown parents and on storage cycles", () => {
    // orphan: parent row missing — walk stops at undefined (depth 2 with a
    // child, so it folds; the node itself never renders anyway since layout
    // draws only nodes whose parent exists)
    const orphan = [g("A", null, 0), g("ghost", "no-such-parent", 1)];
    expect([...initialFolds(orphan)].sort()).toEqual(["ghost"]);
    // cycle: X → Y → X. The seen-set terminates the walk; both nodes resolve
    // to depth 2 with a child → both fold. No infinite loop.
    const cycle = [g("X", "Y", 1), g("Y", "X", 1)];
    expect([...initialFolds(cycle)].sort()).toEqual(["X", "Y"]);
  });

  it("deep chain: only intermediate levels fold, the last parent folds too", () => {
    const nodes = [
      g("L1", null, 1),
      g("L2", "L1", 1),
      g("L3", "L2", 1),
      g("L4", "L3", 1),
      g("L5", "L4", 0),
    ];
    // L1 is depth 1 (never folded); every level that has a child folds
    expect([...initialFolds(nodes)].sort()).toEqual(["L2", "L3", "L4"]);
  });
});