/** Main-tree canvas (SPEC 2.4 / 2.5 / 3.x).

Viewport stability rules implemented here:
- layout is a pure function of (graph, folds, branchRoot); content-only
  changes never move coordinates;
- on a structural change the selected node's screen position is kept
  (anchor fallback: the virtual root), zoom unchanged;
- only first open, "适应当前图" and explicit user navigation (search /
  locate / branch focus) touch the viewport — never a poll or refresh.
*/

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { computeLayout, CARD_W, CARD_H, rootIdOf, type LayoutResult } from "../lib/layout";
import { STATUS_COLOR, STATUS_GLYPH } from "../lib/format";
import { resolveTier, type DetailTier } from "../lib/detailLevel";
import type { DensityMode } from "../lib/viewPrefs";
import type { GraphNode, NodeStatus, Project, RelationItem } from "../lib/types";
import { selectCanvasRelations } from "../lib/relations";
import { NodeCard, type CardData } from "./NodeCard";
import { RootCard, type RootData } from "./RootCard";
import OverviewLabels, { type OverviewLabelItem } from "./OverviewLabels";
import { RelationEdge, makeRelEdge } from "./RelationEdge";
import { deepLinkHref } from "../lib/deeplink";
import { useT } from "../lib/i18n";

export const nodeTypes = { card: NodeCard, root: RootCard };
const edgeTypes = { relation: RelationEdge };

/** A03/R03: the zoom at which a 280px card's body text is actually readable.
 *  First open and search-locate both land here, so "readable" means one thing
 *  in this app rather than being re-derived per entry point. */
export const READABLE_ZOOM = 0.7;

// Saved-view storage now lives in lib/viewPrefs.ts ( SavedView v2, per-layout
// slots). Re-exported here so the existing Canvas readers keep one import site.
import { loadSavedView, saveView } from "../lib/viewPrefs";

export { loadSavedView, saveView } from "../lib/viewPrefs";

export interface CanvasProps {
  projectId: string;
  project: Project | null;
  graph: GraphNode[];
  graphLoaded: boolean;
  selectedId: string | null;
  selectedRelationId: string | null;
  relations: RelationItem[]; // relations of the selected node (for canvas edges)
  folds: ReadonlySet<string>;
  branchRoot: string | null;
  onToggleFold: (id: string) => void;
  onBranchRoot: (id: string | null) => void;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onPickRelation: (id: string | null) => void;
  onAddChild: (parentId: string | null) => void;
  marks: { newIds: ReadonlySet<string>; changedIds: ReadonlySet<string>; badges: ReadonlyMap<string, number> };
  pendingLocate: { nodeId: string } | null;
  onLocated: () => void;
  pendingRevision: number | null;
  onLoadUpdates: () => void;
  fitSignal: number;
  onToast: (msg: string, kind?: "ok" | "err") => void;
  /** B1: density lock from rm.prefs.<pid> ("auto" = zoom-driven tiers) and the
   *  低干扰 choice — both browser prefs, never server state. */
  density: DensityMode;
  lowInterference: boolean;
}

function Inner(p: CanvasProps) {
  const t = useT();
  const flow = useReactFlow();
  const readyRef = useRef(false);
  const [hoveredRel, setHoveredRel] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  // A08: “稍后” only dismisses the banner — the pending update stays until the
  // user explicitly loads it. A newer revision re-opens the full banner.
  const [bannerDismissed, setBannerDismissed] = useState(false);
  useEffect(() => {
    if (p.pendingRevision == null) return;
    setBannerDismissed(false);
  }, [p.pendingRevision]);

  // ---- B1 information-density tier -----------------------------------------
  // The zoom is tracked in a ref (never React state) so panning/zooming does
  // not rerender cards per frame; only a tier CROSSING calls setTier, and Node
  // cards are memoized on their data so unchanged cards keep their props.
  const [tier, setTier] = useState<DetailTier>("reading");
  const tierRef = useRef(tier);
  tierRef.current = tier;
  const zoomRef = useRef<number | null>(null);

  const onMove = useCallback(() => {
    zoomRef.current = flow.getViewport().zoom;
    const next = resolveTier(tierRef.current, p.density, zoomRef.current);
    if (next !== tierRef.current) setTier(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.density, flow]);

  // An explicit lock re-resolves immediately against the last seen zoom.
  useEffect(() => {
    if (zoomRef.current == null) return;
    const next = resolveTier(tierRef.current, p.density, zoomRef.current);
    if (next !== tierRef.current) setTier(next);
  }, [p.density]);

  // ---- layout (pure, deterministic) --------------------------------------
  const layout: LayoutResult = useMemo(
    () => computeLayout(p.projectId, p.graph, p.folds, p.branchRoot),
    [p.projectId, p.graph, p.folds, p.branchRoot],
  );
  // structKey must change for ANY structural change — including same-count
  // re-parenting / sibling reordering — so positions (not just their count)
  // are part of the key.
  const structKey = useMemo(
    () =>
      JSON.stringify([...p.folds].sort()) +
      " " +
      (p.branchRoot ?? "") +
      " " +
      JSON.stringify([...layout.positions].map(([id, pl]) => [id, pl.x, pl.y])),
    [p.folds, p.branchRoot, layout],
  );

  const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const selectedRef = useRef<string | null>(null);
  const didInitialFit = useRef(false);

  useEffect(() => {
    selectedRef.current = p.selectedId;
  }, [p.selectedId]);

  // ---- RF nodes / edges ----------------------------------------------------
  const onToggleFold = useCallback(
    (id: string) => p.onToggleFold(id),
    [p.onToggleFold],
  );
  const onCtx = useCallback(
    (id: string, e: React.MouseEvent) =>
      setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: id }),
    [],
  );

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = [];
    const rootId = rootIdOf(p.projectId);
    if (layout.positions.has(rootId)) {
      const pos = layout.positions.get(rootId)!;
      out.push({
        id: rootId,
        type: "root",
        position: { x: pos.x, y: pos.y },
        // R03: cards are fixed-size by construction (layout reserves CARD_W ×
        // CARD_H). Stating that here matters beyond documentation: this is a
        // controlled `nodes` prop with no onNodesChange, so React Flow can
        // never write measured dimensions back — and anything reading
        // node.measured, the MiniMap included, would otherwise skip every node
        // and render an empty box.
        width: pos.width,
        height: pos.height,
        draggable: false,
        connectable: false,
        selectable: false,
        data: {
          name: p.project?.name ?? "…",
          objective: p.project?.objective ?? "",
          revision: p.project?.revision ?? 0,
        } as RootData,
      });
    }
    for (const n of p.graph) {
      const pos = layout.positions.get(n.id);
      if (!pos) continue;
      const mark = p.marks.newIds.has(n.id) ? "new" : p.marks.changedIds.has(n.id) ? "changed" : undefined;
      out.push({
        id: n.id,
        type: "card",
        position: { x: pos.x, y: pos.y },
        width: pos.width,
        height: pos.height,
        draggable: false,
        connectable: false,
        data: {
          node: n,
          folded: p.folds.has(n.id),
          hiddenCount: pos.hiddenCount,
          hasChildren: n.child_count > 0 || pos.hiddenCount > 0,
          mark,
          badgeCount: p.marks.badges.get(n.id),
          tier,
          low: p.lowInterference,
          onToggleFold,
          onContextMenu: onCtx,
        } as CardData,
      });
    }
    return out;
    // structKey covers graph/folds/branchRoot; marks/relations refresh data
    // without needing structural bookkeeping.
  }, [layout, p.graph, p.folds, p.marks, p.project, p.selectedId, onToggleFold, onCtx, tier, p.lowInterference]);

  // Selected node's direct relations eligible for canvas lines (≤ MAX_CANVAS_RELATION).
  const shownRels = useMemo(() => {
    if (!p.selectedId || !layout.visibleIds.has(p.selectedId)) return [];
    return selectCanvasRelations(p.relations, p.selectedId, layout.visibleIds, p.selectedRelationId).shown;
  }, [p.relations, p.selectedId, layout, p.selectedRelationId]);

  // B1: overview-layer items — the visible branch tops (tree top-level routes,
  // or the branch tops when a branch filter is on). Positions are layout px;
  // OverviewLabels projects them to screen space itself.
  const ovItems = useMemo<OverviewLabelItem[]>(() => {
    if (tier !== "overview") return [];
    const rootId = rootIdOf(p.projectId);
    const byId = new Map(p.graph.map((g) => [g.id, g]));
    const out: OverviewLabelItem[] = [];
    for (const [id, pos] of layout.positions) {
      if (id === rootId) continue;
      const gn = byId.get(id);
      if (!gn) continue;
      const isTop = gn.parent_id === null || (p.branchRoot !== null && gn.parent_id === p.branchRoot);
      if (!isTop) continue;
      out.push({ id, depth: 1, order: pos.y * 10000 + pos.x, x: pos.x, y: pos.y, title: gn.title });
    }
    return out;
  }, [tier, layout, p.graph, p.branchRoot, p.projectId]);

  const onZoomToNode = useCallback(
    (id: string) => {
      const pos = layout.positions.get(id);
      if (!pos) return;
      flow.setCenter(pos.x + CARD_W / 2, pos.y + CARD_H / 2, { zoom: READABLE_ZOOM, duration: 280 });
    },
    [layout, flow],
  );

  // The selected node's floating overview label (null when hidden out of the
  // visible tree, the virtual root, or outside the overview tier).
  const ovSelected = useMemo<OverviewLabelItem | null>(() => {
    if (tier !== "overview") return null;
    const rootId = rootIdOf(p.projectId);
    const sel = p.selectedId;
    if (!sel || sel === rootId || !layout.visibleIds.has(sel)) return null;
    const pos = layout.positions.get(sel);
    if (!pos) return null;
    const title = p.graph.find((g) => g.id === sel)?.title ?? "";
    return { id: sel, depth: 0, order: 0, x: pos.x, y: pos.y, title };
  }, [tier, layout, p.selectedId, p.graph, p.projectId]);

  const edges = useMemo<Edge[]>(() => {
    const out: Edge[] = [];
    const rootId = rootIdOf(p.projectId);
    for (const id of layout.positions.keys()) {
      if (id === rootId) continue;
      const gn = p.graph.find((g) => g.id === id);
      if (!gn) continue;
      // B03: top-level routes (and any visibly rooted card) connect to the
      // virtual root — the root is never an isolated island.
      if (gn.parent_id && layout.positions.has(gn.parent_id)) {
        out.push({ id: `t:${id}`, source: gn.parent_id, target: id, type: "default" });
      } else {
        out.push({ id: `t:${id}`, source: rootId, target: id, type: "default" });
      }
    }
    if (p.selectedId && layout.visibleIds.has(p.selectedId)) {
      for (const cr of shownRels) {
        if (!layout.positions.has(cr.sourceId) || !layout.positions.has(cr.targetId)) continue;
        out.push(
          makeRelEdge(
            `rel:${cr.relation.id}`,
            cr.sourceId,
            cr.targetId,
            cr.relation,
            p.selectedId,
            hoveredRel === cr.relation.id,
            p.selectedRelationId === cr.relation.id,
            setHoveredRel,
            (rid) => p.onPickRelation(rid),
            p.lowInterference,
          ),
        );
      }
    }
    return out;
  }, [layout, p.graph, p.selectedId, p.selectedRelationId, p.relations, hoveredRel, p.onPickRelation, p.projectId, shownRels, p.lowInterference]);

  // ---- viewport stability --------------------------------------------------
  useEffect(() => {
    if (!readyRef.current) return;
    const newPos = new Map<string, { x: number; y: number }>();
    for (const [id, pl] of layout.positions) newPos.set(id, { x: pl.x, y: pl.y });
    if (positionsRef.current.size > 0) {
      const rootId = rootIdOf(p.projectId);
      const anchor =
        selectedRef.current &&
        positionsRef.current.has(selectedRef.current) &&
        newPos.has(selectedRef.current)
          ? selectedRef.current
          : rootId;
      const o = positionsRef.current.get(anchor);
      const n = newPos.get(anchor);
      if (o && n && (o.x !== n.x || o.y !== n.y)) {
        const vp = flow.getViewport();
        flow.setViewport(
          { x: vp.x - (n.x - o.x) * vp.zoom, y: vp.y - (n.y - o.y) * vp.zoom, zoom: vp.zoom },
          { duration: 0 },
        );
      }
    }
    positionsRef.current = newPos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structKey]);

  // ---- locate (user navigation) --------------------------------------------
  useEffect(() => {
    if (!p.pendingLocate || !readyRef.current) return;
    const pos = layout.positions.get(p.pendingLocate.nodeId);
    if (!pos) {
      p.onLocated();
      return;
    }
    const vp = flow.getViewport();
    flow.setCenter(pos.x + CARD_W / 2, pos.y + CARD_H / 2, {
      zoom: Math.max(vp.zoom, READABLE_ZOOM),
      duration: 280,
    });
    p.onLocated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pendingLocate, structKey]);

  // ---- "适应当前图" (explicit user action only) ------------------------------
  useEffect(() => {
    if (p.fitSignal > 0 && readyRef.current) {
      flow.fitView({ padding: 0.1, duration: 250 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.fitSignal]);

  // ---- initial viewport (saved, or readable zoom anchored on the root) ------
  // A03/R03: first open without a saved view anchors on the virtual root at a
  // FIXED readable zoom. Fitting the root+routes bounding box (the previous
  // behaviour) cannot work: with two levels expanded, d3's sibling axis spreads
  // top-level routes by the size of their subtrees, so that box runs to
  // thousands of px and any true fit lands far below reading size — which the
  // old Math.max(0.4, …) floor then silently overrode, producing a viewport
  // that was neither fitted nor legible. Readability wins; the rest of the map
  // is one pan away, or one click on 「适应当前图」.
  // Fires once, and waits for the first non-trivial layout (the graph may
  // arrive post-mount).
  const paneRef = useRef<HTMLDivElement | null>(null);
  const onInit = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!readyRef.current || didInitialFit.current) return;
    if (layout.positions.size < 2) return;
    didInitialFit.current = true;
    const saved = loadSavedView(p.projectId).viewport;
    if (saved) {
      flow.setViewport(saved, { duration: 0 });
      return;
    }
    const anchorId = p.branchRoot ?? rootIdOf(p.projectId);
    const anchor = layout.positions.get(anchorId);
    if (!anchor) return;
    const w = paneRef.current?.clientWidth || 1000;
    const h = paneRef.current?.clientHeight || 700;
    const zoom = READABLE_ZOOM;
    const anchorCx = anchor.x + CARD_W / 2;
    const anchorCy = anchor.y + CARD_H / 2;

    // d3 places each route at the centre of its own subtree, so on a wide map
    // the nearest route can sit most of a screen away from the anchor. Aim the
    // camera at the midpoint of the two — which shows both whenever they fit —
    // but never further than keeps that route fully on screen. Routes beyond
    // it are one pan (or 「适应当前图」) away.
    let nearest = Infinity;
    for (const n of p.graph) {
      if (p.branchRoot ? n.parent_id !== p.branchRoot : n.parent_id !== null) continue;
      const pos = layout.positions.get(n.id);
      if (!pos) continue;
      const d = pos.y + CARD_H / 2 - anchorCy;
      if (Math.abs(d) < Math.abs(nearest)) nearest = d;
    }
    // layout px from the camera centre to the centre of a fully-visible card
    const reach = Math.max(h / (2 * zoom) - CARD_H / 2, 0);
    const shift = Number.isFinite(nearest)
      ? Math.max(nearest - reach, Math.min(nearest + reach, nearest / 2))
      : 0;

    // Bias the anchor left of centre: routes hang off it to the right (depth
    // axis), so they deserve the bulk of the viewport width.
    flow.setViewport(
      { x: w * 0.25 - anchorCx * zoom, y: h / 2 - (anchorCy + shift) * zoom, zoom },
      { duration: 0 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, p.graph, p.branchRoot, p.projectId]);

  const onMoveEnd = useCallback(() => {
    const v = loadSavedView(p.projectId);
    const vp = flow.getViewport();
    saveView(p.projectId, { ...v, viewport: { x: vp.x, y: vp.y, zoom: vp.zoom } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.projectId, flow]);

  const clearCtx = useCallback(() => setCtxMenu(null), []);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => p.onSelect(node.id),
    [p.onSelect],
  );
  const onPaneClick = useCallback(() => {
    clearCtx();
    p.onClearSelection();
  }, [p.onClearSelection, clearCtx]);

  return (
    <div style={{ width: "100%", height: "100%" }} onClick={() => ctxMenu && clearCtx()} ref={paneRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onInit={onInit}
        onMoveEnd={onMoveEnd}
        onMove={onMove}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        elementsSelectable
        minZoom={0.08}
        maxZoom={2.5}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} color="#c9ced6" />
        {/* Portrait, and no taller than the default: a left-to-right tree grows
            far taller than it is wide, so a landscape minimap spends most of
            its width on padding — but the widget floats over the canvas and
            swallows clicks, so its footprint must not grow either. */}
        <MiniMap
          pannable
          zoomable
          style={{ width: 120, height: 150 }}
          maskColor="rgba(29,36,48,0.12)"
          maskStrokeColor="#5c6675"
          maskStrokeWidth={2}
          nodeStrokeColor="#5c6675"
          nodeStrokeWidth={40}
          nodeColor={(n) => {
            if (n.type === "root") return "#9fb0c3";
            const d = (n.data as CardData)?.node;
            return d ? STATUS_COLOR[d.status] : "#cfd4dc";
          }}
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      {p.branchRoot && (
        <Breadcrumbs
          projectId={p.projectId}
          graph={p.graph}
          branchRoot={p.branchRoot}
          onBranchRoot={p.onBranchRoot}
        />
      )}

      {p.pendingRevision != null && !bannerDismissed && (
        <div className="banner" role="status">
          <span>
            {t("canvas.banner.pre")}<b>v{p.pendingRevision}</b>{t("canvas.banner.post")}
          </span>
          <button className="primary" onClick={p.onLoadUpdates}>
            {t("canvas.banner.load")}
          </button>
          <button
            onClick={() => setBannerDismissed(true)}
            title={t("canvas.banner.later.title")}
          >
            {t("canvas.banner.later")}
          </button>
        </div>
      )}
      {p.pendingRevision != null && bannerDismissed && (
        <div className="banner pending-chip" role="status">
          <span title={t("canvas.chip.title")}>{t("canvas.chip.text", { n: p.pendingRevision })}</span>
          <button className="primary" onClick={p.onLoadUpdates}>{t("canvas.chip.load")}</button>
          <button onClick={() => setBannerDismissed(false)} title={t("canvas.chip.expand.title")}>▸</button>
        </div>
      )}

      {(() => {
        const sel = p.selectedId ? p.graph.find((g) => g.id === p.selectedId) : undefined;
        if (!sel || sel.relation_count <= 0) return null;
        return (
          <div className="relcount-hint">
            {t("canvas.relcount", { shown: shownRels.length, total: sel.relation_count })}
          </div>
        );
      })()}

      {/* B1: the legend translates color+glyph back to labels while cards hide
          theirs (coarse tiers or 低干扰); the pop lists for the 6 enums. */}
      <LegendChip visible={tier !== "reading" || p.lowInterference} />

      {tier === "overview" && (
        <OverviewLabels items={ovItems} selected={ovSelected} onZoomIn={onZoomToNode} />
      )}

      {ctxMenu && (
        <CtxMenu
          menu={ctxMenu}
          projectId={p.projectId}
          graph={p.graph}
          folds={p.folds}
          onToggleFold={p.onToggleFold}
          onAddChild={p.onAddChild}
          onBranchRoot={p.onBranchRoot}
          onSelect={p.onSelect}
          onToast={p.onToast}
          onClose={clearCtx}
        />
      )}
    </div>
  );
}

export default function Canvas(p: CanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...p} />
    </ReactFlowProvider>
  );
}

// ---------------------------------------------------------------------------

const LEGEND_ORDER: NodeStatus[] = [
  "unexplored",
  "in_progress",
  "promising",
  "supported",
  "not_supported",
  "inconclusive",
];

/** B1: status legend chip. Collapsed to a button while cards still show their
 *  labels; expands to the six status dots+glyphs whenever the coarse tiers or
 *  低干扰 hide them on the cards. Pure display — never a click-through layer. */
function LegendChip({ visible }: { visible: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!visible && !open) return null;
  return (
    <div className="legend" data-testid="legend">
      {open && (
        <div className="pop legend-pop">
          {LEGEND_ORDER.map((s) => (
            <div className="legend-row" key={s}>
              <span className="dot" style={{ background: STATUS_COLOR[s] }} />
              <span className="legend-glyph">{STATUS_GLYPH[s]}</span>
              <span>{t(`status.${s}`)}</span>
            </div>
          ))}
        </div>
      )}
      <button data-testid="legend-toggle" onClick={() => setOpen((v) => !v)}>
        {t("b1.legend")}
      </button>
    </div>
  );
}

function Breadcrumbs({
  graph,
  branchRoot,
  onBranchRoot,
  projectId,
}: {
  projectId: string;
  graph: GraphNode[];
  branchRoot: string;
  onBranchRoot: (id: string | null) => void;
}) {
  const t = useT();
  const byId = useMemo(() => new Map(graph.map((g) => [g.id, g])), [graph]);
  const chain: string[] = [];
  let cur = byId.get(branchRoot);
  while (cur) {
    chain.unshift(cur.id);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return (
    <div className="breadcrumbs">
      <a onClick={() => onBranchRoot(null)}>{t("canvas.breadcrumb.all")}</a>
      {chain.map((id, i) => (
        <React.Fragment key={id}>
          <span> / </span>
          <a onClick={() => onBranchRoot(id)}>{byId.get(id)?.title ?? id.slice(0, 6)}</a>
          {void i}
        </React.Fragment>
      ))}
      <span style={{ color: "#98a2b0" }}>{t("canvas.breadcrumb.branch")}</span>
      <a
        title={t("canvas.breadcrumb.back.title")}
        onClick={() => {
          onBranchRoot(null);
          window.history.pushState(null, "", deepLinkHref(projectId));
        }}
      >
        ✕
      </a>
    </div>
  );
}

function CtxMenu({
  menu,
  projectId,
  graph,
  folds,
  onToggleFold,
  onAddChild,
  onBranchRoot,
  onSelect,
  onClose,
  onToast,
}: {
  menu: { x: number; y: number; nodeId: string };
  projectId: string;
  graph: GraphNode[];
  folds: ReadonlySet<string>;
  onToggleFold: (id: string) => void;
  onAddChild: (parentId: string | null) => void;
  onBranchRoot: (id: string | null) => void;
  onSelect: (id: string) => void;
  onToast: (msg: string, kind?: "ok" | "err") => void;
  onClose: () => void;
}) {
  const t = useT();
  const n = graph.find((g) => g.id === menu.nodeId);
  if (!n) return null;
  const items: { label: string; run: () => void }[] = [
    { label: t("ctx.open.details"), run: () => { onSelect(n.id); onClose(); } },
    { label: t("ctx.add.child"), run: () => { onAddChild(n.id); onClose(); } },
    { label: folds.has(n.id) ? t("ctx.expand.branch") : t("ctx.collapse.branch"), run: () => { onToggleFold(n.id); onClose(); } },
    { label: t("ctx.only.branch"), run: () => { onBranchRoot(n.id); onClose(); } },
    {
      label: t("ctx.copy.deeplink"),
      run: () => {
        navigator.clipboard
          .writeText(`${window.location.origin}${deepLinkHref(projectId, n.id)}`)
          .then(() => onToast(t("ctx.deeplink.copied"), "ok"))
          .catch(() => onToast(t("common.copy.fail"), "err"));
        onClose();
      },
    },
  ];
  return (
    <div className="ctx" style={{ left: menu.x, top: menu.y }} onClick={onClose}>
      {items.map((it) => (
        <div key={it.label} onClick={() => it.run()}>
          {it.label}
        </div>
      ))}
    </div>
  );
}