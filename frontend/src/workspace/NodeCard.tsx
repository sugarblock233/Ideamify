/** Custom node: fixed-size main-tree card (SPEC 2.4 / 3.1).
 *  Cards show kind, status (label + color), title (≤2 lines), summary (≤2
 *  lines), direct child count and direct relation count. Never draggable /
 *  resizable in v0.1.
 *
 *  B1: `tier` picks the presentation tier (DECISIONS §14) — the card box is
 *  always CARD_W × CARD_H, tiers only change what is drawn (CSS classes
 *  `.tier-compact` / `.tier-overview` on styles.css). `low` is the 低干扰 mode
 *  (tags and relation/child counts hidden). */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CARD_W, CARD_H } from "../lib/layout";
import { STATUS_COLOR, STATUS_GLYPH, kindLabel, statusLabel } from "../lib/format";
import type { DetailTier } from "../lib/detailLevel";
import type { GraphNode } from "../lib/types";
import { useT } from "../lib/i18n";

export interface CardData extends Record<string, unknown> {
  node: GraphNode;
  folded: boolean;
  hiddenCount: number;
  hasChildren: boolean;
  mark?: "new" | "changed" | undefined;
  badgeCount?: number;
  tier?: DetailTier;
  low?: boolean;
  onToggleFold?: (id: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}

export const NodeCard = React.memo(function NodeCard(props: NodeProps) {
  const selected = props.selected;
  const t = useT();
  const d = props.data as CardData;
  const n = d.node;

  return (
    <div
      className={`rm-card tier-${d.tier ?? "reading"} ${selected ? "selected" : ""}${n.archived ? " archived" : ""}${d.low ? " low-interf" : ""}`}
      style={
        {
          borderLeftColor: STATUS_COLOR[n.status],
          width: CARD_W,
          height: CARD_H,
          "--st": STATUS_COLOR[n.status],
        } as React.CSSProperties
      }
      onContextMenu={(e) => {
        e.preventDefault();
        d.onContextMenu?.(n.id, e);
      }}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <div className="row1">
        <span className="kind-badge">{kindLabel(n.kind)}</span>
        <span
          className="status-pill"
          style={{ color: STATUS_COLOR[n.status], background: "rgba(0,0,0,0.03)" }}
        >
          <span className="dot" style={{ background: STATUS_COLOR[n.status] }} />
          {statusLabel(n.status)}
        </span>
        {n.archived && <span className="arch-pill">{t("node.archived")}</span>}
      </div>
      <div className="title" title={n.title}>{n.title}</div>
      <div className="summary" title={n.summary}>{n.summary || t("node.no.summary")}</div>
      <div className="row3">
        <span>{t("node.children.count", { n: n.child_count })}</span>
        <span>{t("node.relations.count", { n: n.relation_count })}</span>
        <span className="tags">
          {n.tags.slice(0, 3).map((t) => (
            <span className="tag" key={t}>{t}</span>
          ))}
        </span>
      </div>
      <div className="tier-glyph" aria-hidden>{STATUS_GLYPH[n.status]}</div>
      {(d.mark === "new" || d.mark === "changed") && (
        <span className={d.mark === "new" ? "new-badge" : "update-badge"}>
          {d.mark === "new" ? t("node.mark.new") : t("node.mark.changed")}
        </span>
      )}
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