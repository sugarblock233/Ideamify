/** A6: batch-fold tool semantics (方案 §2.3). The invariants the toolbar and
 *  恢复上次 depend on: tools return a REPLACING set, never mention ids outside
 *  the branch-allowed subtree, and levels are relative to the visible tree top. */

import { describe, expect, it } from "vitest";
import type { GraphNode } from "../types";
import {
  collapseAllFolds,
  expandSubtreeFolds,
  expandToLevelFolds,
} from "../expandTools";

let seq = 0;
function node(parent_id: string | null, childCount = 0): GraphNode {
  seq += 1;
  return {
    id: `n${seq}`,
    parent_id,
    order_index: seq,
    kind: "idea",
    title: `节点${seq}`,
    summary: "",
    status: "in_progress",
    tags: [],
    evidence_count: 0,
    child_count: childCount,
    relation_count: 0,
    version_ids: [],
    created_at: "",
    updated_at: "",
    created_by: "",
  } as GraphNode;
}

/** Linear chain n1 → n2 → … → nN (n1 is top-level). */
function chain(depth: number): { nodes: GraphNode[]; ids: string[] } {
  const nodes: GraphNode[] = [];
  const ids: string[] = [];
  for (let i = 0; i < depth; i++) {
    const n = node(i === 0 ? null : `n${seq}`);
    n.order_index = i;
    nodes.push(n);
    ids.push(n.id);
  }
  // child_count is informational in expandTools, keep it truthy above leaves
  for (let i = 0; i < nodes.length - 1; i++) nodes[i]!.child_count = 1;
  nodes[nodes.length - 1]!.child_count = 0;
  return { nodes, ids };
}

describe("collapseAllFolds", () => {
  it("folds every node with children, leaving tops visible", () => {
    const { nodes, ids } = chain(5);
    expect([...collapseAllFolds({ nodes, branchRoot: null })].sort()).toEqual(
      ids.slice(0, 4).sort(),
    );
  });

  it("never mentions ids outside a focused branch and folds inside it only", () => {
    const { nodes, ids } = chain(5);
    const branchRoot = ids[1]!; // n2..n5 inside; n1 outside
    const out = collapseAllFolds({ nodes, branchRoot });
    expect(out.has(ids[0]!)).toBe(false);
    expect([...out].sort()).toEqual([ids[1]!, ids[2]!, ids[3]!].sort());
  });

  it("is a full replacement: empty on a flat tree", () => {
    const { nodes } = chain(1);
    expect(collapseAllFolds({ nodes, branchRoot: null }).size).toBe(0);
  });
});

describe("expandToLevelFolds", () => {
  it("shows exactly level N and folds beyond it", () => {
    const { nodes, ids } = chain(5);
    // level 1: only the top needs its children hidden? No — fold set holds
    // nodes STRICTLY beyond level 1 that have children: n2, n3, n4.
    expect([...expandToLevelFolds({ nodes, branchRoot: null }, 1)].sort()).toEqual(
      [ids[1]!, ids[2]!, ids[3]!].sort(),
    );
    // level 3: n4 (level 4, has child) folded; n5 childless regardless.
    expect([...expandToLevelFolds({ nodes, branchRoot: null }, 3)]).toEqual([ids[3]!]);
    // level ≥ 4: nothing left to fold on a 5-chain
    expect(expandToLevelFolds({ nodes, branchRoot: null }, 4).size).toBe(0);
    // clamped: level 0 behaves as 1
    expect(expandToLevelFolds({ nodes, branchRoot: null }, 0)).toEqual(
      expandToLevelFolds({ nodes, branchRoot: null }, 1),
    );
  });

  it("levels are relative to the branch root when focused", () => {
    const { nodes, ids } = chain(5);
    // Inside branch n2 (levels: n2=1, n3=2, n4=3, n5=4): "level 2" folds n4+.
    const out = expandToLevelFolds({ nodes, branchRoot: ids[1]! }, 2);
    expect([...out]).toEqual([ids[3]!]);
    expect(out.has(ids[0]!)).toBe(false);
  });
});

describe("expandSubtreeFolds", () => {
  it("drops folds inside the subtree (root included), keeps outside folds", () => {
    const { nodes, ids } = chain(5);
    const folds = new Set([ids[0]!, ids[2]!, ids[4]!]);
    const out = expandSubtreeFolds({ nodes, branchRoot: null }, ids[2]!, folds);
    expect(out.has(ids[0]!)).toBe(true);
    expect(out.has(ids[2]!)).toBe(false);
    expect(out.has(ids[4]!)).toBe(false);
  });

  it("removes the root's own fold (it hides the whole branch)", () => {
    const { nodes, ids } = chain(5);
    const folds = new Set([ids[1]!]);
    expect(expandSubtreeFolds({ nodes, branchRoot: null }, ids[1]!, folds).size).toBe(0);
  });

  it("unknown root is a no-op clone", () => {
    const { nodes, ids } = chain(3);
    const folds = new Set([ids[0]!]);
    expect(expandSubtreeFolds({ nodes, branchRoot: null }, "missing", folds)).toEqual(folds);
  });
});
