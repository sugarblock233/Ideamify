/** B3: outline list view (DECISIONS §15).
 *
 *  Replaces the canvas when the layout pref is 大纲. Same pure tree source
 *  as the canvas (`buildTreeData`) so fold / branch-filter semantics are
 *  shared verbatim — every visible node of the same tree, as an indented
 *  row: status dot + glyph (language-independent coding, DECISIONS §14),
 *  a wrap-anywhere title, and the same fold-button semantics (onToggleFold
 *  from Workspace). The text is not CSS-truncated: an outline is where long
 *  titles live. Rows never go through layout.ts — coordinates don't exist
 *  here. Locate (search / deep link / side-panel 定位) scrolls the row into
 *  view and flashes it, working on the same commit whose ancestor expansion
 *  from locateNode landed, so no rAF dance is needed.
 */

import { useEffect, useMemo, useRef } from "react";
import { buildTreeData, CARD_W } from "../lib/layout";
import { STATUS_COLOR, STATUS_GLYPH, kindLabel, statusLabel } from "../lib/format";
import type { GraphNode } from "../lib/types";
import { useT } from "../lib/i18n";

export interface OutlineViewProps {
  nodes: GraphNode[];
  folds: ReadonlySet<string>;
  branchRoot: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleFold: (id: string) => void;
  pendingLocate: { nodeId: string } | null;
  onLocated: () => void;
  projectName: string;
  /** C3: the open node-create draft, shown as a read-only dashed row right
   *  after its parent's row (top-level drafts go last). Omitted when the
   *  parent's row is not rendered (folded away / branch-filtered) — the draft
   *  still lives in the side panel; the outline only mirrors visible rows. */
  draft: { parentId: string | null; title: string; kind: string; status: string } | null;
}

/** Structural slice of buildTreeData's TreeLeaf (unexported there). */
interface OutlineLeaf {
  id: string;
  hiddenDirect: number;
  children?: OutlineLeaf[];
}

interface OutlineRow {
  id: string;
  depth: number;
  folded: boolean;
  hiddenDirect: number;
  hasChildren: boolean;
  node: GraphNode;
}

export default function OutlineView(p: OutlineViewProps) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const flashTimer = useRef<number | null>(null);

  // Same tree builder the canvas draws — folds/branch-filter identical.
  const rows = useMemo<OutlineRow[]>(() => {
    const tree = buildTreeData(p.nodes, p.folds, p.branchRoot);
    const byId = new Map(p.nodes.map((n) => [n.id, n]));
    const out: OutlineRow[] = [];
    const walk = (leaf: OutlineLeaf, depth: number) => {
      const node = byId.get(leaf.id);
      if (node) {
        out.push({
          id: leaf.id,
          depth,
          folded: p.folds.has(leaf.id),
          hiddenDirect: leaf.hiddenDirect,
          hasChildren: (leaf.children?.length ?? 0) > 0,
          node,
        });
      }
      for (const child of leaf.children ?? []) walk(child, depth + 1);
    };
    if (tree.root) {
      for (const top of tree.root.children ?? []) walk(top, 0);
    }
    return out;
  }, [p.nodes, p.folds, p.branchRoot]);

  // Locate: scrollIntoView + flash. locateNode (Workspace) already expanded
  // the ancestors before pendingLocate is set, and rows recompute in the
  // same commit — so the row exists here without waiting for another frame.
  // If it doesn't (archived / stale locate), the locate just resolves.
  useEffect(() => {
    if (!p.pendingLocate) return;
    const id = p.pendingLocate.nodeId;
    const row = wrapRef.current?.querySelector<HTMLElement>(`[data-outline-id="${id}"]`);
    if (!row) {
      p.onLocated();
      return;
    }
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.classList.remove("flash");
    void row.offsetWidth; // restart the animation on a repeat locate
    row.classList.add("flash");
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => row.classList.remove("flash"), 3600);
    p.onLocated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pendingLocate, rows]);

  // C3: rows plus the read-only draft row. The draft renders right after its
  // parent's row at depth+1 (top-level: last, depth 0); if the parent's row
  // is not in the outline (folded away / branch-filtered) the draft is not
  // rendered either — the side panel remains its editor.
  const viewRows: (OutlineRow | { draftMarker: true; depth: number })[] = useMemo(() => {
    if (!p.draft) return rows;
    const out: (OutlineRow | { draftMarker: true; depth: number })[] = [];
    let placed = false;
    for (const r of rows) {
      out.push(r);
      if (p.draft.parentId === r.id) {
        out.push({ draftMarker: true, depth: r.depth + 1 });
        placed = true;
      }
    }
    if (!placed && p.draft.parentId === null) {
      out.push({ draftMarker: true, depth: 0 });
      placed = true;
    }
    return placed ? out : rows;
  }, [rows, p.draft]);

  return (
    <div className="outline-wrap" data-testid="outline-view" ref={wrapRef}>
      <div className="outline-head">
        <span className="outline-glyph" aria-hidden>◆</span>
        {p.projectName}
      </div>
      {viewRows.map((entry) =>
        "draftMarker" in entry ? (
          /* The draft row mirrors the side panel's unsaved session; clicking
             it edits nothing (plan §10.3: outline hosts no inline editing). */
          <div
            key="draft"
            className="outline-row draft"
            style={{ paddingLeft: 18 + entry.depth * 22 }}
          >
            <span className="outline-status" aria-hidden>
              <span className="dot" style={{ background: "var(--ink-dim)" }} />
            </span>
            <span className="outline-kind">{entry.depth >= 0 ? p.draft!.kind : ""}</span>
            <span className="outline-title" style={{ maxWidth: Math.round(CARD_W * 2.4) }}>
              {p.draft!.title || t("ws.draft.heading")}
            </span>
            <span className="chip">{t("ws.draft.unsaved")}</span>
          </div>
        ) : (
        <div
          key={entry.id}
          data-outline-id={entry.id}
          className={`outline-row${p.selectedId === entry.id ? " selected" : ""}`}
          style={{ paddingLeft: 18 + entry.depth * 22 }}
          onClick={() => p.onSelect(entry.id)}
        >
          {entry.hasChildren && (
            <button
              className="fold-btn ofold"
              title={entry.folded
                ? t("node.fold.expand.title", { n: entry.hiddenDirect })
                : t("node.fold.collapse.title")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                p.onToggleFold(entry.id);
              }}
            >
              {entry.folded ? `+${entry.hiddenDirect}` : "–"}
            </button>
          )}
          <span className="outline-status" title={statusLabel(entry.node.status)}>
            <span className="dot" style={{ background: STATUS_COLOR[entry.node.status] }} />
            <span
              className="outline-glyph"
              aria-hidden
              style={{ color: STATUS_COLOR[entry.node.status] }}
            >
              {STATUS_GLYPH[entry.node.status]}
            </span>
          </span>
          <span className="outline-kind">{kindLabel(entry.node.kind)}</span>
          <span className="outline-title" style={{ maxWidth: Math.round(CARD_W * 2.4) }}>
            {entry.node.title}
          </span>
          {entry.node.archived && <span className="arch-pill">{t("node.archived")}</span>}
          <span className="outline-tags">
            {entry.node.tags.slice(0, 3).map((tag) => (
              <span className="tag" key={tag}>{tag}</span>
            ))}
          </span>
        </div>
        )
      )}
    </div>
  );
}
