/** Which cross-branch dashed lines are drawn (SPEC 2.3).

Overview mode draws NO relation lines — only the main tree. With a selection
the canvas shows at most MAX_CANVAS_RELATION dashed lines touching the
selected node, and only when BOTH endpoints are inside the current visible
tree (folded / branch-filtered / archived targets draw no line — the sidebar
still lists them with locate). Ordering: the relation the user clicked in
the sidebar first, the rest by relation id (deterministic).
*/

import type { RelationItem } from "./types";

export const MAX_CANVAS_RELATION = 6;

export interface CanvasRelation {
  relation: RelationItem;
  sourceId: string;
  targetId: string;
  /** null when the kind is undirected */
  directed: boolean;
}

export function relationEndpoints(r: RelationItem, selfId: string): { sourceId: string; targetId: string } {
  return r.direction === "outgoing"
    ? { sourceId: selfId, targetId: r.other.id }
    : { sourceId: r.other.id, targetId: selfId };
}

export function isDirected(kind: RelationItem["kind"]): boolean {
  return kind !== "related";
}

export interface RelationSelection {
  shown: CanvasRelation[];
  /** total non-archived relations touching the node */
  total: number;
}

export function selectCanvasRelations(
  relations: RelationItem[],
  selfId: string,
  visibleIds: ReadonlySet<string>,
  selectedRelationId: string | null,
): RelationSelection {
  const live = relations.filter((r) => !r.archived);
  const inVisible = live.filter((r) => {
    const { sourceId, targetId } = relationEndpoints(r, selfId);
    return visibleIds.has(sourceId) && visibleIds.has(targetId);
  });
  const ordered = [...inVisible].sort((a, b) => {
    if (a.id === selectedRelationId) return -1;
    if (b.id === selectedRelationId) return 1;
    return a.id.localeCompare(b.id);
  });
  const shown = ordered.slice(0, MAX_CANVAS_RELATION).map((r) => ({
    relation: r,
    ...relationEndpoints(r, selfId),
    directed: isDirected(r.kind),
  }));
  return { shown, total: live.length };
}

/** Label shown on hover / single selection. */
export function relationLabel(r: RelationItem, selfTitle: string): string {
  const kind = r.kind;
  const out = r.direction === "outgoing";
  switch (kind) {
    case "related":
      return `相关：${r.other.title}`;
    case "motivates":
      return out ? `本节点启发 ${r.other.title}` : `${r.other.title} 启发本节点`;
    case "supports":
      return out ? `本节点支持 ${r.other.title}` : `${r.other.title} 支持本节点`;
    case "contradicts":
      return out ? `本节点反对 ${r.other.title}` : `${r.other.title} 反对本节点`;
    case "depends_on":
      return out ? `本节点依赖 ${r.other.title}` : `${r.other.title} 依赖本节点`;
  }
  void selfTitle;
  return kind;
}