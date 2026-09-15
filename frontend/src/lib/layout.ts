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
import type { GraphNode, ResearchVersion } from "./types";
import type { LayoutMode } from "./viewPrefs";
import { VERSION_FILTER_UNASSIGNED } from "./versionFilter";

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
  /** F04: set only on swimlane display instances — the business node whose
   *  card this instance mirrors (the instance's own canvas id is
   *  `${sharedOf}${SWIM_INSTANCE_SEP}${versionKey}`). */
  sharedOf?: string;
}

export interface LayoutResult {
  positions: Map<string, PlacedNode>;
  rootId: string;
  /** ids of visible (non-root) nodes */
  visibleIds: Set<string>;
  /** E5: lane geometry, set only when computeSwimlane produced this result. */
  swimlane?: SwimlaneGrid;
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

/* --------------------------- E5: version × route swimlanes ------------------ */

/** Lane geometry (plan E5): cards keep their canvas size everywhere.
 *  「行内步进 160」 = CARD_H + 16 within a cell; the rest are the same air
 *  ratios the tree layouts use. */
export const SWIM_COL_GAP = 96;
export const SWIM_ROW_GAP = 56;
export const SWIM_CELL_STEP = 160;
export const SWIM_HEADER_GAP = 48;

/** Screen-space lane headers (SwimlaneHeaders projects these like the
 *  overview layer does — canvas px + transform = screen px). */
export interface SwimlaneGrid {
  /** column headers left-to-right; label is the version name, the pseudo
   *  「未分配」 column sits at the END (plan E5). key is version id or the
   *  VERSION_FILTER_UNASSIGNED sentinel. */
  cols: { key: string; label: string; x: number }[];
  /** row headers top-to-bottom — one per top-level route. */
  rows: { id: string; title: string; y: number; height: number }[];
  /** grid bounds in canvas px (minX is the first column's left edge). */
  minX: number;
  minY: number;
}

/** E5: version × route swimlane layout. Rows are top-level routes (parent_id
 *  null) sorted (order_index, id); columns are research versions sorted
 *  (order_index, id) plus the 「未分配」 pseudo-column at the end.
 *  F04: a node assigned to several versions gets a DISPLAY INSTANCE per
 *  matched column — the canvas id of the extra instances is
 *  `${nodeId}${SWIM_INSTANCE_SEP}${versionKey}` while the first instance keeps
 *  the plain business id, so selection, details, counts-pinning and edits keep
 *  pointing at the same node. Under an active version filter the population is
 *  matched ∪ ancestors, and a node carrying the filtered version is shown in
 *  that version's column only (never back in its other lanes); nodes not
 *  carrying the filter (context anchors) keep the first-known-column rule.
 *  Nodes within a cell stack deterministically by (order_index, id) in
 *  SWIM_CELL_STEP steps. Tree edges are not drawn in this mode (plan E5);
 *  fold/branch state is deliberately ignored — the swimlane is the whole
 *  filtered population on one grid. Same (nodes, versions, order) ⇒ same
 *  coordinates. */
export const SWIM_INSTANCE_SEP = "@@swim@@";
export function computeSwimlane(
  projectId: string,
  nodes: GraphNode[],
  versions: ResearchVersion[],
  unassignedLabel: string,
  opts?: { activeVersion?: string | null },
): LayoutResult {
  const rootId = rootIdOf(projectId);
  const empty: LayoutResult = { positions: new Map(), rootId, visibleIds: new Set() };
  if (nodes.length === 0) return empty;

  // Columns: versions in display order, 「未分配」 pseudo-column last.
  const cols = [...versions]
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id))
    .map((v) => ({ key: v.id, label: v.name }));
  cols.push({ key: VERSION_FILTER_UNASSIGNED, label: unassignedLabel });
  const colIndex = new Map<string, number>();
  cols.forEach((c, i) => colIndex.set(c.key, i));

  // Rows: top-level routes of the (already filtered) node set. A node whose
  // ancestor chain is broken by the filter/archived hides anchors at the
  // highest node still present — it becomes its own row.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const routeOf = (n: GraphNode): GraphNode => {
    let cur = n;
    const seen = new Set<string>([n.id]);
    while (cur.parent_id && !seen.has(cur.parent_id) && byId.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      cur = byId.get(cur.parent_id)!;
    }
    return cur;
  };
  const rows = [...nodes.filter((n) => n.parent_id === null || !byId.has(n.parent_id))]
    .map((n) => routeOf(n))
    .filter((n, i, arr) => arr.findIndex((m) => m.id === n.id) === i)
    .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => rowIndex.set(r.id, i));

  // Deterministic stack order: global (order_index, id) fill. Two passes —
  // first decide every card's (row, col, slot), then lay out row bands with
  // the cumulative height of their own stack so tall lanes never bleed into
  // the next row.
  const ordered = [...nodes].sort(
    (a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id),
  );
  const slots = new Map<string, number>(); // `${rowIdx}:${colIdx}` → next card no

  const placed: { id: string; rIdx: number; cIdx: number; s: number; sharedOf?: string }[] = [];
  const stack = new Map<number, number>(); // rowIdx → max cards in the row
  for (const n of ordered) {
    const r = routeOf(n);
    const rIdx = rowIndex.get(r.id);
    if (rIdx === undefined) continue;
    const vids = n.version_ids ?? [];
    const matched = vids
      .map((v) => colIndex.get(v))
      .filter((c): c is number => c !== undefined);
    // F04: which columns should show this node?
    //  - active single-version filter: exactly that column for nodes carrying
    //    it (the report's must-have: a v1+v2 node filtered to v2 sits in the
    //    v2 lane, not back in v1); context nodes (surviving ancestors that
    //    don't carry the filter) keep the first-known-column rule.
    //  - otherwise: one display instance per matched column; none → 未分配.
    let cols: number[];
    if (opts?.activeVersion && opts.activeVersion !== VERSION_FILTER_UNASSIGNED) {
      const av = colIndex.get(opts.activeVersion);
      cols = av !== undefined && matched.includes(av) ? [av] : matched.slice(0, 1);
    } else {
      cols = matched.length > 0 ? [...matched].sort((a, b) => a - b) : [];
    }
    if (cols.length === 0) cols = [colIndex.get(VERSION_FILTER_UNASSIGNED)!];
    cols.forEach((cIdx, k) => {
      const cellKey = `${rIdx}:${cIdx}`;
      const s = slots.get(cellKey) ?? 0;
      slots.set(cellKey, s + 1);
      placed.push({
        // the first instance keeps the business id (selection/locate/unsaved
        // all resolve through it); extra instances get derivative ids
        id: k === 0 ? n.id : `${n.id}${SWIM_INSTANCE_SEP}${cols![k] === colIndex.get(VERSION_FILTER_UNASSIGNED) ? "u" : vids.find((v) => colIndex.get(v) === cols![k])}`,
        rIdx,
        cIdx,
        s,
        sharedOf: k === 0 ? undefined : n.id,
      });
      stack.set(rIdx, Math.max(stack.get(rIdx) ?? 0, s + 1));
    });
  }

  const positions = new Map<string, PlacedNode>();
  const visibleIds = new Set<string>();
  const rowTop = new Map<number, number>();
  let acc = SWIM_HEADER_GAP;
  for (let i = 0; i < rows.length; i++) {
    rowTop.set(i, acc);
    acc += (stack.get(i) ?? 1) * SWIM_CELL_STEP + SWIM_ROW_GAP;
  }
  for (const p of placed) {
    positions.set(p.id, {
      id: p.id,
      x: p.cIdx * (CARD_W + SWIM_COL_GAP),
      y: rowTop.get(p.rIdx)! + p.s * SWIM_CELL_STEP,
      width: CARD_W,
      height: CARD_H,
      hiddenCount: 0,
      depth: (byId.get(p.sharedOf ?? p.id)?.parent_id ?? null) === null ? 1 : 2,
      ...(p.sharedOf ? { sharedOf: p.sharedOf } : {}),
    });
    visibleIds.add(p.id);
  }

  const grid: SwimlaneGrid = {
    cols: cols.map((c, i) => ({ key: c.key, label: c.label, x: i * (CARD_W + SWIM_COL_GAP) })),
    rows: rows.map((r, i) => ({
      id: r.id,
      title: r.title,
      y: rowTop.get(i) ?? SWIM_HEADER_GAP,
      height: (stack.get(i) ?? 1) * SWIM_CELL_STEP,
    })),
    minX: 0,
    minY: 0,
  };
  return { positions, rootId, visibleIds, swimlane: grid };
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