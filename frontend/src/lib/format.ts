/** Display labels for statuses/kinds (SPEC 4.3 / user message). */

import type { NodeKind, NodeStatus, RelationKind } from "./types";

export const STATUS_LABEL: Record<NodeStatus, string> = {
  unexplored: "未探索",
  in_progress: "进行中",
  promising: "有积极迹象",
  supported: "当前条件下支持",
  not_supported: "当前条件下不支持",
  inconclusive: "尚不能判断",
};

export const STATUS_COLOR: Record<NodeStatus, string> = {
  unexplored: "var(--st-gray)",
  in_progress: "var(--st-blue)",
  promising: "var(--st-cyan)",
  supported: "var(--st-green)",
  not_supported: "var(--st-red)",
  inconclusive: "var(--st-yellow)",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  question: "问题",
  idea: "想法",
  attempt: "尝试",
  finding: "发现",
};

export const RELATION_LABEL: Record<RelationKind, string> = {
  related: "相关",
  motivates: "启发",
  supports: "支持",
  contradicts: "反对/不支持",
  depends_on: "依赖",
};

/** Colors must never be the only state cue: labels always accompany. */
export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return iso;
  }
}