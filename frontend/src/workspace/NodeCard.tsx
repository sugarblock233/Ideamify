/** Custom node: fixed-size main-tree card (SPEC 2.4 / 3.1).
 *  Cards show kind, status (label + color), title (≤2 lines), summary (≤2
 *  lines), direct child count and direct relation count. Never draggable /
 *  resizable in v0.1.
 *
 *  B1: `tier` picks the presentation tier (DECISIONS §14) — the card box is
 *  always CARD_W × CARD_H, tiers only change what is drawn (CSS classes
 *  `.tier-compact` / `.tier-overview` on styles.css). `low` is the 低干扰 mode
 *  (tags and relation/child counts hidden). `v` flips the (invisible) edge
 *  handles to top/bottom for the vertical tree — edges must anchor at the
 *  connector band, which in that orientation runs along the card's height. */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CARD_W, CARD_H } from "../lib/layout";
import { STATUS_COLOR, STATUS_GLYPH, kindLabel, statusLabel } from "../lib/format";
import type { DetailTier } from "../lib/detailLevel";
import type { GraphNode, NodeKind, NodeStatus } from "../lib/types";
import { useT } from "../lib/i18n";

export interface CardData extends Record<string, unknown> {
  node: GraphNode;
  folded: boolean;
  hiddenCount: number;
  hasChildren: boolean;
  mark?: "new" | "changed" | undefined;
  /** C3 §10.2: the selected node carries this unsaved edit draft → show a
   *  未保存 flag on the card itself, so the live-edit state is visible on the
   *  map and not only in the panel. */
  unsaved?: boolean;
  /** F06: live preview of an in-flight edit draft — the card renders these
   *  draft values instead of the saved ones until save/cancel. Display only:
   *  layout keeps its coordinates (text-only edits never re-layout). */
  preview?: { title: string; summary: string; kind: NodeKind; status: NodeStatus };
  /** F04: swimlane shared-set badge — " v1 · v2" on a node assigned to more
   *  than one research version; every display instance shows it. */
  shared?: string;
  badgeCount?: number;
  tier?: DetailTier;
  low?: boolean;
  /** B2: vertical tree — handles flip from left/right to top/bottom */
  v?: boolean;
  onToggleFold?: (id: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}

export const NodeCard = React.memo(function NodeCard(props: NodeProps) {
  const selected = props.selected;
  const t = useT();
  const d = props.data as CardData;
  const n = d.node;
  // F06: while an edit draft is open, the card mirrors the draft (kind/status
  // pills and the text); saved values stay underneath for the title attr.
  const shown = {
    kind: d.preview?.kind ?? n.kind,
    status: d.preview?.status ?? n.status,
    title: d.preview ? d.preview.title : n.title,
    summary: d.preview ? d.preview.summary : n.summary,
  };

  return (
    <div
      className={`rm-card tier-${d.tier ?? "reading"} ${selected ? "selected" : ""}${n.archived ? " archived" : ""}${d.low ? " low-interf" : ""}`}
      style={
        {
          borderLeftColor: STATUS_COLOR[shown.status],
          width: CARD_W,
          height: CARD_H,
          "--st": STATUS_COLOR[shown.status],
        } as React.CSSProperties
      }
      onContextMenu={(e) => {
        e.preventDefault();
        d.onContextMenu?.(n.id, e);
      }}
    >
      <Handle type="target" position={d.v ? Position.Top : Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={d.v ? Position.Bottom : Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <div className="row1">
        <span className="kind-badge">{kindLabel(shown.kind)}</span>
        <span
          className="status-pill"
          style={{ color: STATUS_COLOR[shown.status], background: "rgba(0,0,0,0.03)" }}
        >
          <span className="dot" style={{ background: STATUS_COLOR[shown.status] }} />
          {statusLabel(shown.status)}
        </span>
        {n.archived && <span className="arch-pill">{t("node.archived")}</span>}
        {d.shared && (
          <span className="shared-pill" data-testid="shared-badge" title={t("node.shared.among", { lanes: d.shared })}>
            {d.shared}
          </span>
        )}
      </div>
      <div className="title" title={n.title}>{shown.title}</div>
      <div className="summary" title={n.summary}>{shown.summary || t("node.no.summary")}</div>
      <div className="row3">
        <span>{t("node.children.count", { n: n.child_count })}</span>
        <span>{t("node.relations.count", { n: n.relation_count })}</span>
        <span className="tags">
          {n.tags.slice(0, 3).map((t) => (
            <span className="tag" key={t}>{t}</span>
          ))}
        </span>
      </div>
      <div className="tier-glyph" aria-hidden>{STATUS_GLYPH[shown.status]}</div>
      {(d.mark === "new" || d.mark === "changed") && (
        <span className={d.mark === "new" ? "new-badge" : "update-badge"}>
          {d.mark === "new" ? t("node.mark.new") : t("node.mark.changed")}
        </span>
      )}
      {d.unsaved && <span className="unsaved-badge">{t("ws.draft.unsaved")}</span>}
      {d.badgeCount ? (
        <span className="update-badge" style={{ right: d.mark ? 64 : 12 }}>
          {t("node.badge.updates", { n: d.badgeCount })}
        </span>
      ) : null}
      {d.hasChildren && (
        <button
          className="fold-btn"
          title={d.folded ? t("node.fold.expand.title", { n: d.hiddenCount }) : t("node.fold.collapse.title")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            d.onToggleFold?.(n.id);
          }}
        >
          {d.folded ? `+${d.hiddenCount}` : "–"}
        </button>
      )}
    </div>
  );
});