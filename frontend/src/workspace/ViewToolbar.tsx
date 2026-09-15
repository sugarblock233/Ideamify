/** A6: one-row canvas overlay for batch expand/collapse (方案 §2.3).
 *
 *  Presentational helpers wired to pure lib/expandTools.ts:
 *  - 全部展开 clears the whole fold set (the visible count is on the label);
 *  - the ▾ menu holds 展开到第 1–3 层, 展开选中节点的分支, single-step
 *    恢复上次 (Workspace owns the pre-batch snapshot),
 *    the B2 layout switcher (横向/纵向/大纲, each with its own saved view),
 *    the B1 density lock (阅读/精简/概览/自动, DECISIONS §14) and the
 *    低干扰 toggle — view prefs, both written to rm.prefs.<pid> by Workspace.
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
import type { DensityMode, LayoutMode } from "../lib/viewPrefs";
import { VERSION_FILTER_UNASSIGNED } from "../lib/versionFilter";
import { useT } from "../lib/i18n";
import type { GraphNode, ResearchVersion } from "../lib/types";

export interface ViewToolbarProps {
  nodes: GraphNode[];
  folds: ReadonlySet<string>;
  branchRoot: string | null;
  selectedId: string | null;
  /** replace the whole fold set as one batch (Workspace snapshots first) */
  onReplaceFolds: (next: ReadonlySet<string>) => void;
  onRestoreLast: () => void;
  canRestore: boolean;
  /** B2: layout strategy — Workspace snapshots the outgoing layout's view */
  layout: LayoutMode;
  onSetLayout: (mode: LayoutMode) => void;
  /** B1/B4: density lock + 低干扰 (browser prefs owned by Workspace) */
  density: DensityMode;
  onSetDensity: (mode: DensityMode) => void;
  lowInterference: boolean;
  onToggleLowInterference: () => void;
  /** E 批 §7：版本筛选（跨布局共享，null=全部）。
   *  展开工具只吃过滤后的数组，绝不写这个值（同 branchRoot 的「不清过滤」）。 */
  versions: ResearchVersion[];
  versionId: string | null;
  onSetVersionId: (id: string | null) => void;
  /** 38: 打开科研版本管理弹窗（行内常驻，空版本列表也可达） */
  onManageVersions: () => void;
}

const DENSITY_ORDER: DensityMode[] = ["reading", "compact", "overview", "auto"];
const LAYOUTS: LayoutMode[] = ["h", "v", "outline", "swimlane"];

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

  /** F07: every one of these tools writes the fold set (or needs it for the
   *  count) — on the swimlane grid the folds are ignored, so the buttons
   *  would be clickable no-ops. Layout/density/低干扰/版本筛选 stay. */
  const treeTools = p.layout !== "swimlane";

  const ctx = { nodes: p.nodes, branchRoot: p.branchRoot };

  return (
    <div className="vtool" data-testid="view-toolbar">
      {treeTools && (
        <>
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
        </>
      )}
      <div className="menu" ref={menuRef}>
        <button
          className={menuOpen ? "vt-menu open" : "vt-menu"}
          title={t("a6.more.title")}
          data-testid="vt-menu"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ▾
        </button>
        {menuOpen && (
          <div className="pop" style={{ top: "100%", right: 0 }}>
            {treeTools && (
              <>
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
              </>
            )}
            {/* B2 layout switch: 横向树/纵向树/大纲. Menu clicks do NOT close
                the menu (density lock below relies on the same contract). */}
            <div className="pop-item dotmenu-line" data-testid="vt-layout" role="radiogroup" title={t("vt.layout.title")}>
              {LAYOUTS.map((m) => (
                <button
                  key={m}
                  className={p.layout === m ? "seg on" : "seg"}
                  data-testid={`vt-layout-${m}`}
                  onClick={() => { p.onSetLayout(m); }}
                >
                  {t(`layout.${m}`)}
                </button>
              ))}
            </div>
            {/* B4 density lock: 阅读/精简/概览/自动 — "auto" resolves tiers
                from zoom with hysteresis (lib/detailLevel.ts). */}
            <div className="pop-item dotmenu-line" data-testid="vt-density" role="radiogroup">
              {DENSITY_ORDER.map((m) => (
                <button
                  key={m}
                  className={p.density === m ? "seg on" : "seg"}
                  data-testid={`vt-density-${m}`}
                  onClick={() => { p.onSetDensity(m); }}
                >
                  {t(`density.${m}`)}
                </button>
              ))}
            </div>
            <div
              className={`pop-item dotmenu-line${p.lowInterference ? " on" : ""}`}
              data-testid="vt-low-interf"
              title={t("b1.low.title")}
              onClick={() => p.onToggleLowInterference()}
            >
              {p.lowInterference ? t("b1.low.off") : t("b1.low.on")}
            </div>
            {/* E 批 §7：版本筛选 — 全部/未分配/各版本。已归档版本仍可选带标记
                （其归属节点要能浏览）；筛选与折叠/分支互不覆写。
                38：行内常驻「管理」入口（科研版本创建/重命名/排序/归档），
                无版本时也渲染——否则新项目永远没有 UI 入口。 */}
            <div className="pop-item dotmenu-line" data-testid="vt-version" role="radiogroup" title={t("vt.version.title")}>
              {p.versions.length > 0 && (
                <>
                  <button
                    className={p.versionId === null ? "seg on" : "seg"}
                    data-testid="vt-version-all"
                    onClick={() => { p.onSetVersionId(null); }}
                  >
                    {t("vt.version.all")}
                  </button>
                  <button
                    className={p.versionId === VERSION_FILTER_UNASSIGNED ? "seg on" : "seg"}
                    data-testid="vt-version-unassigned"
                    onClick={() => { p.onSetVersionId(VERSION_FILTER_UNASSIGNED); }}
                  >
                    {t("vt.version.unassigned")}
                  </button>
                  {p.versions.map((v) => (
                    <button
                      key={v.id}
                      className={p.versionId === v.id ? "seg on" : "seg"}
                      data-testid={`vt-version-${v.id.slice(0, 8)}`}
                      onClick={() => { p.onSetVersionId(v.id); }}
                    >
                      {v.archived ? `${v.name}·${t("ver.archived")}` : v.name}
                    </button>
                  ))}
                </>
              )}
              <button
                className="seg"
                data-testid="vt-version-manage"
                title={t("ver.manage.title")}
                onClick={() => { p.onManageVersions(); }}
              >
                {t("ver.manage")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
