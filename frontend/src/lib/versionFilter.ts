/** E 批 §7: version-scoped browsing — the node-array filter applied BEFORE
 *  buildTreeData in every view (tokenizer for the 版本 entry in ViewToolbar).
 *
 *  Semantics (方案 §7.3 line 155: 「为缺失的祖先显示上下文路径」):
 *  - the visible set is the matched nodes PLUS every ancestor on their chain,
 *    so the canvas tree stays connected — an assigned node's context route is
 *    always shown rather than silently dropping the node as an orphan;
 *  - anything else is out of view (SidePanel flags it 「当前视图外」 and can
 *    clear the filter; 方案 §6 line 108);
 *  - the filter is presentation-only: it never writes version_ids.
 */

export type VersionFilter = string | null;

/** Sentinel for the 「未分配」 pseudo-view. Chosen so it can never collide
 *  with a node/version id (both are UUIDs or node ids). */
export const VERSION_FILTER_UNASSIGNED = "__unassigned__";

export function filterNodesByVersion<
  T extends { id: string; parent_id: string | null; version_ids: string[] },
>(nodes: T[], versionId: VersionFilter): T[] {
  if (versionId == null) return nodes;
  const byId = new Map<string, T>();
  for (const n of nodes) byId.set(n.id, n);
  const out = new Set<string>();
  for (const n of nodes) {
    const matched =
      versionId === VERSION_FILTER_UNASSIGNED
        ? n.version_ids.length === 0
        : n.version_ids.includes(versionId);
    if (!matched) continue;
    out.add(n.id);
    // ancestor closure keeps the tree connected (context route, §7.3)
    let cur = n.parent_id;
    while (cur && !out.has(cur)) {
      const parent = byId.get(cur);
      if (!parent) break; // archived-and-hidden or dangling parent stops here
      out.add(cur);
      cur = parent.parent_id;
    }
  }
  return nodes.filter((n) => out.has(n.id));
}
