/** Cross-branch relation edge (SPEC 2.3/2.4): dashed, behind cards, label
 *  only on hover or when the single relation is selected; undirected kinds
 *  have no arrow, directed kinds point at their target.

 *  Markers: for directed kinds we set `markerEnd` on the EDGE OBJECT (an
 *  EdgeMarker) — @xyflow/react v12 registers the SVG symbols itself in a
 *  shared <defs> and hands the resolved `url(#…)` string back as the
 *  `markerEnd` prop of the custom edge, which we forward to <BaseEdge/>.
 */

import {
  BaseEdge,
  getBezierPath,
  MarkerType,
  type Edge,
  type EdgeProps,
} from "@xyflow/react";
import { relationLabel } from "../lib/relations";
import type { RelationItem } from "../lib/types";

export interface RelData extends Record<string, unknown> {
  item: RelationItem;
  selfId: string;
  hovered: boolean;
  selected: boolean;
  low?: boolean;
  onHover?: (id: string | null) => void;
  onClick?: (id: string) => void;
}

export function RelationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
  markerEnd,
}: EdgeProps) {
  const d = data as RelData;
  const [path, labelX, labelY] = getBezierPath({
    sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition,
    curvature: 0.25,
  });
  const label =
    d.selected || (!d.low && d.hovered) ? relationLabel(d.item, "") : null;

  return (
    <g>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={d.item.kind !== "related" ? markerEnd : undefined}
        style={{
          stroke: d.selected ? "#274b8f" : "#a08c35",
          strokeWidth: d.selected ? 2 : 1.2,
          strokeDasharray: "6 5",
          ...style,
        }}
      />
      {/* hover strip: a duplicate fat invisible path for the pointer */}
      <path
        d={path}
        style={{ stroke: "transparent", strokeWidth: 14, fill: "none", cursor: "pointer" }}
        onMouseEnter={() => d.onHover?.(id)}
        onMouseLeave={() => d.onHover?.(null)}
        onClick={() => d.onClick?.(id)}
      >
        <title>{`${d.item.kind}：${d.item.reason}`}</title>
      </path>
      {label && (
        <g transform={`translate(${labelX}, ${labelY})`}>
          <foreignObject
            width={280}
            height={34}
            x={-140}
            y={-17}
            style={{ pointerEvents: "none" }}
          >
            <div className="relabel" style={{ width: "fit-content", margin: "0 auto", whiteSpace: "pre" }}>
              {label}
              {d.selected ? ` — ${d.item.reason}` : ""}
            </div>
          </foreignObject>
        </g>
      )}
    </g>
  );
}

export function makeRelEdge(
  id: string,
  sourceId: string,
  targetId: string,
  item: RelationItem,
  selfId: string,
  hovered: boolean,
  selected: boolean,
  onHover: (id: string | null) => void,
  onClick: (id: string) => void,
  /** B1 低干扰: suppress the transient hover label (an explicit selection
   *  still labels its relation — picking one is deliberate, not clutter). */
  lowInterference = false,
): Edge {
  return {
    id,
    source: sourceId,
    target: targetId,
    type: "relation",
    animated: false,
    markerEnd:
      item.kind !== "related"
        ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: selected ? "#274b8f" : "#a08c35" }
        : undefined,
    data: { item, selfId, hovered, selected, low: lowInterference, onHover, onClick } as RelData,
  };
}