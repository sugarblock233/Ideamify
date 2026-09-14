/** Pure, deterministic main-tree layout (SPEC 2.4 / 2.5).

Input to layout is ONLY the main tree: `parent_id`, sibling `order_index` and
the fold set. Cross-branch relations NEVER enter this module. The same
(tree, order, folds) must always yield the same coordinates, and content
edits (title/summary/status/evidence/relations) never relayout — callers
only rerun this when the tree structure or folds change.

Two canvas orientations share this d3 geometry (DECISIONS §15): "h" is the
SPEC 2.4 left-to-right tree (axes swapped) and "v" is the top-to-bottom tree
(axes direct). Both keep the same CARD_W × CARD_H cards; only the d3 node
size and the mapping differ.

    h: canvasX = d3.y - CARD_W / 2      v: canvasX = d3.x - CARD_W / 2
       canvasY = d3.x - CARD_H / 2         canvasY = d3.y - CARD_H / 2
*/

import { hierarchy, tree, type HierarchyNode, type HierarchyPointNode } from "d3-hierarchy";
import type { GraphNode } from "./types";
import type { LayoutMode } from "./viewPrefs";

export type { LayoutMode } from "./viewPrefs";

export const CARD_W = 280;
export const CARD_H = 144;
/** [siblingGap, depthGap]; depth gap > card width so connectors fit. */
export const NODE_SIZE: [number, number] = [176, 380];
/** 纵向树 (DECISIONS §15): the depth axis runs down the canvas and siblings
 *  spread across, so the gaps re-balance — sibling axis 344 = card 280 + 64
 *  groove keeps the horizontal tree's 176:280 ≈ air ratio relative to the
 *  card (344:280), and the depth axis 208 = card height 144 + 64 connector
 *  band. Cards stay 280 × 144 in every mode. */
export const NODE_SIZE_V: [number, number] = [344, 208];
export const rootIdOf = (pid: string) => `project:${pid}`;

/** Per-mode placement strategy: d3's sibling/depth geometry is shared, only
 *  the node size and the canvas mapping differ. */
interface LayoutStrategy {
  nodeSize: [number, number];
  toCanvas: (d3x: number, d3y: number) => { x: number; y: number };
}

const TREE_STRATEGIES: Record<"h" | "v", LayoutStrategy> = {
  h: { nodeSize: NODE_SIZE, toCanvas: (d3x, d3y) => ({ x: d3y - CARD_W / 2, y: d3x - CARD_H / 2 }) },
  v: { nodeSize: NODE_SIZE_V, toCanvas: (d3x, d3y) => ({ x: d3x - CARD_W / 2, y: d3y - CARD_H / 2 }) },
};

export interface PlacedNode {
  id: string;
  x: number; // top-left canvas coordinate
  y: number;
  width: number;
  height: number;
  /** number of hidden (folded or branch-filtered) direct children */
  hiddenCount: number;
  depth: number;
}

export interface LayoutResult {
  positions: Map<string, PlacedNode>;
  rootId: string;
  /** ids of visible (non-root) nodes */
  visibleIds: Set<string>;
}

interface TreeLeaf {
  id: string;
  parent: string | null;
  hiddenDirect: number;
  children?: TreeLeaf[];
}

interface D3Node {
  id: string;
  hidden: number;
  children?: D3Node[];
}

/** Build d3 hierarchy input from the flat graph rows.

A node is visible when it is (a) inside `branchRoot`'s subtree (if set) and
(b) not under a folded ancestor. Folding a node keeps the node itself
visible but hides its whole subtree; hidden direct children are counted for
the fold handle. */
export function buildTreeData(
  nodes: GraphNode[],
  folds: ReadonlySet<string>,
  branchRoot: string | null,
): { root: TreeLeaf | null; visibleIds: Set<string> } {
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) byId.set(n.id, n);
  if (byId.size === 0) return { root: null, visibleIds: new Set() };

  // (a) allowed subtree when branch-focusing
  let allowed: Set<string> | null = null;
  if (branchRoot && byId.has(branchRoot)) {
    allowed = new Set<string>([branchRoot]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of byId.values()) {
        if (n.parent_id && allowed.has(n.parent_id) && !allowed.has(n.id)) {
          allowed.add(n.id);
          grew = true;
        }
      }
    }
  }

  const foldedAncestor = (id: string): boolean => {
    let cur = byId.get(id)?.parent_id ?? null;
    while (cur) {
      if (folds.has(cur)) return true;
      cur = byId.get(cur)?.parent_id ?? null;
    }
    return false;
  };
  const visibleOf = (n: GraphNode): boolean =>
    (!allowed || allowed.has(n.id)) && !foldedAncestor(n.id);

  const kidsOf = new Map<string, GraphNode[]>();
  for (const n of byId.values()) {
    if (!n.parent_id || !byId.has(n.parent_id)) continue;
    const list = kidsOf.get(n.parent_id) ?? [];
    list.push(n);
    kidsOf.set(n.parent_id, list);
  }
  for (const kids of kidsOf.values()) {
    // canonical sibling order (SPEC 2.4): (order_index, id)
    kids.sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
  }

  const isTopOfVisibleTree = (n: GraphNode): boolean =>
    // In branch-focus mode the branch root itself is the top of the shown
    // tree ( drawn as a first-level card; the breadcrumb exposes its place).
    branchRoot ? n.id === branchRoot : n.parent_id === null;

  const visibleTops = [...byId.values()]
    .filter((n) => isTopOfVisibleTree(n) && visibleOf(n))
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
  if (visibleTops.length === 0) return { root: null, visibleIds: new Set() };

  const mk = (n: GraphNode): TreeLeaf => {
    const kids = kidsOf.get(n.id) ?? [];
    const leaves = kids.filter(visibleOf).map(mk);
    return {
      id: n.id,
      parent: n.parent_id,
      hiddenDirect: kids.length - leaves.length,
      children: leaves.length ? leaves : undefined,
    };
  };

  const visible = new Set<string>();
  const go = (l: TreeLeaf): void => {
    visible.add(l.id);
    for (const c of l.children ?? []) go(c);
  };
  for (const t of visibleTops) go(mk(t));

  const root: TreeLeaf = {
    id: "root",
    parent: null,
    hiddenDirect: 0,
    children: visibleTops.map(mk),
  };
  return { root, visibleIds: visible };
}

/** Main-tree coordinates for one canvas orientation.
 *
 *  The default (mode "h") keeps the horizontal tree's original output
 *  byte-for-byte. "v" places the same tree top-to-bottom. "outline" never
 *  reaches layout (it renders its own list view, B3) but the type accepts it
 *  so callers can pass a LayoutMode straight through; a defensively mapped
 *  "outline" behaves like "h". */
export function computeLayout(
  projectId: string,
  nodes: GraphNode[],
  folds: ReadonlySet<string>,
  branchRoot: string | null,
  mode: LayoutMode = "h",
): LayoutResult {
  const rootId = rootIdOf(projectId);
  const empty: LayoutResult = { positions: new Map(), rootId, visibleIds: new Set() };
  if (nodes.length === 0) return empty;

  const { root, visibleIds } = buildTreeData(nodes, folds, branchRoot);
  if (!root) return empty;

  const strat = mode === "v" ? TREE_STRATEGIES.v : TREE_STRATEGIES.h;

  const toD3 = (l: TreeLeaf): D3Node => ({
    id: l.id,
    hidden: l.hiddenDirect,
    children: (l.children ?? []).map(toD3),
  });

  const hRoot = hierarchy<D3Node>(
    { id: rootId, hidden: 0, children: (root.children ?? []).map(toD3) },
    (d) => d.children,
  );
  // Children are pre-sorted to (order_index, id); d3 preserves that order.
  tree<D3Node>().nodeSize(strat.nodeSize)(hRoot);

  const positions = new Map<string, PlacedNode>();
  const walk = (h: HierarchyNode<D3Node>): void => {
    // tree() (TypedHierarchyPointNode) always fills x/y by the time it has
    // run; the narrow cast documents that contract.
    const p = h as HierarchyPointNode<D3Node>;
    const c = strat.toCanvas(p.x, p.y);
    positions.set(p.data.id, {
      id: p.data.id,
      x: c.x,
      y: c.y,
      width: CARD_W,
      height: CARD_H,
      hiddenCount: p.data.hidden,
      depth: p.depth,
    });
    for (const child of h.children ?? []) walk(child);
  };
  walk(hRoot);

  return { positions, rootId, visibleIds };
}

/** Overlap predicate used by layout unit tests (T02 cards must not overlap). */
export function cardsOverlap(a: PlacedNode, b: PlacedNode): boolean {
  if (a.id === b.id) return false;
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** First-open default fold set (SPEC 3.1 / A03): when no saved view exists,
 *  show only the virtual root plus the first two business levels. Every node
 *  at depth ≥ 2 that has children is folded, so its subtree (depth ≥ 3) is
 *  hidden but still expandable. Depth 1 = top-level routes (parent null). */
export function initialFolds(nodes: GraphNode[]): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = new Map<string, number>();
  const depthOf = (start: GraphNode): number => {
    const hit = depth.get(start.id);
    if (hit !== undefined) return hit;
    let cur: GraphNode | undefined = start;
    const seen = new Set<string>([start.id]);
    let steps = 1;
    // Walk up to the top-level ancestor; repeats (impossible on a persisted
    // acyclic main tree) or unknown parents terminate the walk safely.
    while (cur && cur.parent_id && !seen.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      steps++;
      cur = byId.get(cur.parent_id);
    }
    depth.set(start.id, steps);
    return steps;
  };
  const out = new Set<string>();
  for (const n of nodes) {
    if (n.parent_id && n.child_count > 0 && depthOf(n) >= 2) out.add(n.id);
  }
  return out;
}

/* --------------------------- C3: draft placement --------------------------- */

/** The unsaved create-draft card is a canvas overlay, not a tree node: same
 *  card width, but roomier (kind/status selects + title + summary + actions). */
export const DRAFT_W = CARD_W;
export const DRAFT_H = 200;

export interface DraftPlacement {
  x: number;
  y: number;
  /** id of the visible card the draft docks to and the temp edge starts from
   *  (the parent itself, its nearest visible ancestor when folded away, or
   *  the virtual root for top-level drafts). */
  anchorId: string;
}

/** C3: deterministic canvas spot for the unsaved draft card (plan §10.3).
 *
 *  - child draft (h): one column right of its anchor at the anchor's row —
 *    the column where its siblings live; (v): one row below the anchor.
 *  - top-level draft: one row/column BELOW/AFTER the LAST visible top-level
 *    route, never between two routes.
 *  - Overlaps walk down (h) / right (v) in 12px steps until the draft rect is
 *    clear of every placed card. Same (positions, parentId) ⇒ same spot.
 *
 *  Returns null on an empty canvas — there is nothing to dock to yet; callers
 *  render the draft only in the side panel in that case. */
export function draftPlacement(
  positions: Map<string, PlacedNode>,
  parentId: string | null,
  /** the parent's ancestor chain, nearest first (folded-parent fallback) */
  ancestorsOf: (id: string) => string[],
  rootId: string,
  mode: "h" | "v",
  tops: { x: number; y: number }[],
): DraftPlacement | null {
  if (positions.size === 0) return null;
  let anchor: PlacedNode | undefined;
  if (parentId) {
    anchor = positions.get(parentId);
    if (!anchor) {
      for (const a of ancestorsOf(parentId)) {
        anchor = positions.get(a);
        if (anchor) break;
      }
    }
  }
  if (!anchor) anchor = positions.get(rootId);
  if (!anchor) return null; // anchor card not on canvas; nothing to dock to
  // tops ordered like the tree (caller sorts); "last" = farthest on the
  // sibling axis, which for both orientations is the max canvas coordinate.
  const lastTop =
    mode === "v"
      ? tops.reduce((m, p0) => (p0.x > m.x ? p0 : m), tops[0] ?? anchor)
      : tops.reduce((m, p0) => (p0.y > m.y ? p0 : m), tops[0] ?? anchor);

  let x: number;
  let y: number;
  if (parentId) {
    // 96 ≈ the h groove (380 − 280) minus a nudge; keeps the draft visually
    // inside the parent's column airspace instead of hugging the next column.
    x = mode === "v" ? anchor.x : anchor.x + CARD_W + 96;
    y = mode === "v" ? anchor.y + CARD_H + 96 : anchor.y;
  } else {
    x = mode === "v" ? lastTop.x + CARD_W + 96 : lastTop.x;
    y = mode === "v" ? lastTop.y : lastTop.y + CARD_H + 96;
  }
  const clear = (): boolean => {
    for (const pos of positions.values()) {
      if (
        x < pos.x + pos.width &&
        pos.x < x + DRAFT_W &&
        y < pos.y + pos.height &&
        pos.y < y + DRAFT_H
      ) {
        return false;
      }
    }
    return true;
  };
  // Bounded walk: determinism over premise — 240 steps × 12px outruns any
  // realistic column; if it ever gives up the draft may overlap, never vanish.
  for (let i = 0; i < 240 && !clear(); i++) {
    if (mode === "v") x += 12;
    else y += 12;
  }
  return {
    x,
    y,
    anchorId: parentId
      ? anchor.id === rootId
        ? rootId
        : anchor.id
      : rootId,
  };
}