/** Custom node: fixed-size main-tree card (SPEC 2.4 / 3.1).
 *  Cards show kind, status (label + color), title (≤2 lines), summary (≤2
 *  lines), direct child count and direct relation count. Never draggable /
 *  resizable in v0.1. */

import React from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CARD_W, CARD_H } from "../lib/layout";
import { STATUS_COLOR, kindLabel, statusLabel } from "../lib/format";
import type { GraphNode } from "../lib/types";

export interface CardData extends Record<string, unknown> {
  node: GraphNode;
  folded: boolean;
  hiddenCount: number;
  hasChildren: boolean;
  mark?: "new" | "changed" | undefined;
  badgeCount?: number;
  onToggleFold?: (id: string) => void;
  onContextMenu?: (id: string, e: React.MouseEvent) => void;
}

export const NodeCard = React.memo(function NodeCard(props: NodeProps) {
  const selected = props.selected;
  const d = props.data as CardData;
  const n = d.node;

  return (
    <div
      className={`rm-card ${selected ? "selected" : ""}${n.archived ? " archived" : ""}`}
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
        {n.archived && <span className="arch-pill">已归档</span>}
      </div>
      <div className="title" title={n.title}>{n.title}</div>
      <div className="summary" title={n.summary}>{n.summary || "（无摘要）"}</div>
      <div className="row3">
        <span>子 {n.child_count}</span>
        <span>关联 {n.relation_count}</span>
        <span className="tags">
          {n.tags.slice(0, 3).map((t) => (
            <span className="tag" key={t}>{t}</span>
          ))}
        </span>
      </div>
      {(d.mark === "new" || d.mark === "changed") && (
        <span className={d.mark === "new" ? "new-badge" : "update-badge"}>
          {d.mark === "new" ? "新增" : "已更新"}
        </span>
      )}
      {d.badgeCount ? (
        <span className="update-badge" style={{ right: d.mark ? 64 : 12 }}>
          分支内有更新 {d.badgeCount}
        </span>
      ) : null}
      {d.hasChildren && (
        <button
          className="fold-btn"
          title={d.folded ? `展开分支（隐藏 ${d.hiddenCount} 个直接子节点）` : "折叠分支"}
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