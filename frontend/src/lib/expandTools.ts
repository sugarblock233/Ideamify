/** A6: pure fold-set batch tools behind the canvas view toolbar (方案 §2.3
 *  一键展开/折叠).
 *
 *  Semantics that are load-bearing:
 *  - Every tool REPLACES the whole fold set (one batch), never patches it —
 *    that is what makes single-step 恢复上次 (Workspace keeps a pre-batch
 *    snapshot) well-defined. Card-level manual folding does not snapshot.
 *  - branchRoot filtering is NEVER written: a branch-focused user gets tools
 *    computed inside the allowed subtree ("不清过滤" in e2e), and the returned
 *    set simply never mentions ids outside it.
 *  - Levels are relative to the visible tree top (the branch root itself, or
 *    top-level nodes otherwise), so "展开到第 2 层" inside a focused branch
 *    means two levels below the branch root.
 *  - The universe is the `nodes` array as passed (archived rows are already
 *    excluded by the fetch unless 显示已归档 is on); orphan parents are
 *    skipped exactly like buildTreeData does.
 */

import type { GraphNode } from "./types";

export interface FoldToolCtx {
  nodes: GraphNode[];
  branchRoot: string | null;
}

function childrenMap(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const present = new Set(nodes.map((n) => n.id));
  const kids = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    if (!n.parent_id || !present.has(n.parent_id)) continue;
    const list = kids.get(n.parent_id) ?? [];
    list.push(n);
    kids.set(n.parent_id, list);
  }
  return kids;
}

/** branchRoot's subtree (fixed-point BFS, same growth rule as buildTreeData).
 *  Returns null when no branch filter is active. */
function allowedSubtree({ nodes, branchRoot }: FoldToolCtx): Set<string> | null {
  if (!branchRoot) return null;
  const byId = new Set(nodes.map((n) => n.id));
  if (!byId.has(branchRoot)) return null;
  const allowed = new Set<string>([branchRoot]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (n.parent_id && allowed.has(n.parent_id) && !allowed.has(n.id)) {
        allowed.add(n.id);
        grew = true;
      }
    }
  }
  return allowed;
}

/** Relative depth (1 = the visible tree top(s)) for every node inside the
 *  allowed subtree. Outside nodes get no entry. */
function relativeLevels(ctx: FoldToolCtx): Map<string, number> {
  const kids = childrenMap(ctx.nodes);
  const allowed = allowedSubtree(ctx);
  const levels = new Map<string, number>();
  const inTree = (n: GraphNode) => !allowed || allowed.has(n.id);
  const present = new Set(ctx.nodes.map((n) => n.id));
  const queue: GraphNode[] = ctx.nodes.filter(
    (n) =>
      inTree(n) &&
      (ctx.branchRoot ? n.id === ctx.branchRoot : n.parent_id === null || !present.has(n.parent_id)),
  );
  for (const top of queue) levels.set(top.id, 1);
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    const d = levels.get(cur.id)!;
    for (const c of kids.get(cur.id) ?? []) {
      if (levels.has(c.id) || !inTree(c)) continue;
      levels.set(c.id, d + 1);
      queue.push(c);
    }
  }
  return levels;
}

/** 全部折叠 — fold every allowed node that has children; the canvas ends up
 *  showing only the branch tops. */
export function collapseAllFolds(ctx: FoldToolCtx): Set<string> {
  const allowed = allowedSubtree(ctx);
  const kids = childrenMap(ctx.nodes);
  const out = new Set<string>();
  for (const n of ctx.nodes) {
    if (allowed && !allowed.has(n.id)) continue;
    if ((kids.get(n.id)?.length ?? 0) > 0) out.add(n.id);
  }
  return out;
}

/** 展开到第 N 层 — fold only the nodes strictly beyond level N that have
 *  children. N is clamped to ≥ 1. */
export function expandToLevelFolds(ctx: FoldToolCtx, level: number): Set<string> {
  const clamp = Math.max(1, level);
  const kids = childrenMap(ctx.nodes);
  const levels = relativeLevels(ctx);
  const out = new Set<string>();
  for (const [id, d] of levels) {
    if (d <= clamp) continue;
    if ((kids.get(id)?.length ?? 0) > 0) out.add(id);
  }
  return out;
}

/** 展开选中节点所在分支 — drop every fold inside `root`'s subtree (root
 *  included: folding it hides the whole branch). Folds outside stay. */
export function expandSubtreeFolds(ctx: FoldToolCtx, root: string, folds: ReadonlySet<string>): Set<string> {
  const byId = new Set(ctx.nodes.map((n) => n.id));
  if (!byId.has(root)) return new Set(folds);
  const inSubtree = new Set<string>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of ctx.nodes) {
      if (n.parent_id && inSubtree.has(n.parent_id) && !inSubtree.has(n.id)) {
        inSubtree.add(n.id);
        grew = true;
      }
    }
  }
  const out = new Set<string>();
  for (const id of folds) if (!inSubtree.has(id)) out.add(id);
  return out;
}
