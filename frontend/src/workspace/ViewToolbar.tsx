/** A6: one-row canvas overlay for batch expand/collapse (方案 §2.3).
 *
 *  Presentational helpers wired to pure lib/expandTools.ts:
 *  - 全部展开 clears the whole fold set (the visible count is on the label);
 *  - the ▾ menu holds 展开到第 1–3 层, 展开选中节点的分支 and single-step
 *    恢复上次 (Workspace owns the pre-batch snapshot);
 *  - tools never write the branchRoot filter — "不清过滤" is asserted in e2e;
 *  - fitView is never called (the anchoring effect keeps the camera put).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buildTreeData } from "../lib/layout";
import {
  collapseAllFolds,
  expandSubtreeFolds,
  expandToLevelFolds,
} from "../lib/expandTools";
import { useT } from "../lib/i18n";
import type { GraphNode } from "../lib/types";

export interface ViewToolbarProps {
  nodes: GraphNode[];
  folds: ReadonlySet<string>;
  branchRoot: string | null;
  selectedId: string | null;
  /** replace the whole fold set as one batch (Workspace snapshots first) */
  onReplaceFolds: (next: ReadonlySet<string>) => void;
  onRestoreLast: () => void;
  canRestore: boolean;
}

export default function ViewToolbar(p: ViewToolbarProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Visible-node count (branchRoot-aware), same tree the canvas draws.
  const visibleN = useMemo(
    () => buildTreeData(p.nodes, p.folds, p.branchRoot).visibleIds.size,
    [p.nodes, p.folds, p.branchRoot],
  );

  // Close on outside click only (same guarded pattern as TopBar's ⋯ menu:
  // React may flush this effect inside the click that opened the menu).
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuOpen]);

  if (p.nodes.length === 0) return null;

  const ctx = { nodes: p.nodes, branchRoot: p.branchRoot };

  return (
    <div className="vtool" data-testid="view-toolbar">
      <button
        data-testid="vt-expand-all"
        title={t("a6.expand.all.title", { n: visibleN })}
        onClick={() => p.onReplaceFolds(new Set())}
      >
        {t("a6.expand.all", { n: visibleN })}
      </button>
      <button
        data-testid="vt-collapse-all"
        title={t("a6.collapse.all.title")}
        onClick={() => p.onReplaceFolds(collapseAllFolds(ctx))}
      >
        {t("a6.collapse.all")}
      </button>
      <div className="menu" ref={menuRef}>
        <button
          className={menuOpen ? "vt-menu open" : "vt-menu"}
          title={t("a6.more.title")}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ▾
        </button>
        {menuOpen && (
          <div className="pop" style={{ top: "100%", right: 0 }}>
            <div
              className="pop-item"
              data-testid="vt-level-1"
              onClick={() => { setMenuOpen(false); p.onReplaceFolds(expandToLevelFolds(ctx, 1)); }}
            >
              {t("a6.expand.level", { n: 1 })}
            </div>
            <div
              className="pop-item"
              data-testid="vt-level-2"
              onClick={() => { setMenuOpen(false); p.onReplaceFolds(expandToLevelFolds(ctx, 2)); }}
            >
              {t("a6.expand.level", { n: 2 })}
            </div>
            <div
              className="pop-item"
              data-testid="vt-level-3"
              onClick={() => { setMenuOpen(false); p.onReplaceFolds(expandToLevelFolds(ctx, 3)); }}
            >
              {t("a6.expand.level", { n: 3 })}
            </div>
            <div
              className={`pop-item${p.selectedId ? "" : " muted"}`}
              data-testid="vt-subtree"
              title={p.selectedId ? t("a6.expand.subtree.title") : ""}
              onClick={() => {
                if (!p.selectedId) return;
                setMenuOpen(false);
                p.onReplaceFolds(
                  expandSubtreeFolds(ctx, p.selectedId, p.folds),
                );
              }}
            >
              {t("a6.expand.subtree")}
            </div>
            <div
              className={`pop-item${p.canRestore ? "" : " muted"}`}
              data-testid="vt-restore"
              title={t("a6.restore.title")}
              onClick={() => {
                if (!p.canRestore) return;
                setMenuOpen(false);
                p.onRestoreLast();
              }}
            >
              {t("a6.restore")}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
