/** Display labels for statuses/kinds (SPEC 4.3) and date formatting.
 *
 * Labels resolve through the i18n dictionary (DECISIONS §16): enum values
 * themselves stay the API's English literals, only the display mapping is
 * translated. Colors must never be the only state cue — labels always
 * accompany (SPEC 4.3). */

import type { NodeKind, NodeStatus, RelationKind } from "./types";
import { getLang, t } from "./i18n";

export function statusLabel(s: NodeStatus): string {
  return t(`status.${s}`);
}

export function kindLabel(k: NodeKind): string {
  return t(`kind.${k}`);
}

export function relationKindLabel(k: RelationKind): string {
  return t(`rel.${k}`);
}

export const STATUS_COLOR: Record<NodeStatus, string> = {
  unexplored: "var(--st-gray)",
  in_progress: "var(--st-blue)",
  promising: "var(--st-cyan)",
  supported: "var(--st-green)",
  not_supported: "var(--st-red)",
  inconclusive: "var(--st-yellow)",
};

export function fmtTime(iso: string): string {
  const locale = getLang() === "en" ? "en-US" : "zh-CN";
  try {
    return new Date(iso).toLocaleString(locale, {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export function fmtDate(iso: string): string {
  const locale = getLang() === "en" ? "en-US" : "zh-CN";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: "numeric", month: "2-digit", day: "2-digit",
    });
  } catch {
    return iso;
  }
}
