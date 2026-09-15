/** Top bar (SPEC 3.1): project switch, search, new top-level route, secondary
 *  actions behind ⋯, connection info.
 *
 *  A09: single row at 1280×800 — the secondary actions collapsed into a ⋯
 *  menu, the search box flexes (min-width 220), the project select and the
 *  connection span ellipsize instead of wrapping.
 *
 *  A7: three adaptive tiers driven by the topbar's own box (element-level
 *  ResizeObserver + measure-on-render, not a window media query — browser
 *  zoom and font changes both land), stepping down on real overflow and up
 *  on freely spare room (hysteresis, see TIER_RAID_SPARE):
 *  - full: current single row (conn ellipsizes down to its min floor first);
 *  - more: 刷新 / conn / 退出 move into the ⋯ menu (conn as a read-only item);
 *  - icon: search collapses into an expandable entry (revealed in-row on
 *    click, never clipped) and the project select shortens (CSS
 *    `.topbar.tier-icon .project-sel`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Project, SearchItem, CommitItem } from "../lib/types";
import { fmtTime, statusLabel } from "../lib/format";
import { getLang, setLang, useT } from "../lib/i18n";
import type { ProjectLite } from "../gate/TokenGate";

export type TopBarTier = "full" | "more" | "icon";

export interface TopBarSearch {
  q: string;
  setQ: (v: string) => void;
  results: SearchItem[];
  loading: boolean;
  total: number;
  open: boolean;
  onPick: (s: SearchItem) => void;
  onClose: () => void;
}

export interface TopBarProps {
  actor: string | null;
  appVersion: string | null;
  project: Project | null;
  projects: ProjectLite[];
  currentProjectId: string;
  onSwitchProject: (pid: string) => void;
  onCreateProject: () => void;
  onEditProject: () => void;
  /** 38: 科研版本管理（⋯ 菜单入口，空项目也可达） */
  onManageVersions: () => void;
  onNewRoot: () => void;
  onFit: () => void;
  onManualRefresh: () => void;
  onExport: () => void;
  onShowAiAccess: () => void;
  /** B04: archived nodes are hidden unless this is on; it is how the UI reaches
   *  an archived node again in order to restore it. */
  showArchived: boolean;
  onToggleArchived: () => void;
  onExit: () => void;
  search: TopBarSearch;
  recent: {
    open: boolean;
    commits: CommitItem[];
    toggle: () => void;
    onPick: (c: CommitItem) => void;
  };
}

export default function TopBar(p: TopBarProps) {
  const t = useT();
  const [tier, setTier] = useState<TopBarTier>("full");
  const [searchFocus, setSearchFocus] = useState(false);
  const [iconSearchOpen, setIconSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const iconSearchRef = useRef<HTMLDivElement>(null);
  const showSearch = p.search.open || (searchFocus && p.search.q.trim());

  // --- A7 tier measurement -------------------------------------------------
  const barRef = useRef<HTMLDivElement>(null);
  const tierRef = useRef(tier);
  tierRef.current = tier;
  // .scrollWidth is max(clientWidth, content) — it can never report spare
  // room, so the step-UP decision needs the remembered natural width of the
  // tier above (captured on every step-DOWN, where scrollWidth == natural).
  const naturalW = useRef<Partial<Record<TopBarTier, number>>>({});
  const [, bump] = useState(0);

  // After every render: content changes and box changes both feed
  // scrollWidth. Overflow (.topbar is nowrap) means the row genuinely does
  // not fit → remember its natural width for the tier above and drop one
  // tier per pass; enough width for the remembered natural of the tier above
  // → step back up. Hysteresis is inherited from the recorded naturals, so
  // this cannot oscillate.
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const over = el.scrollWidth - el.clientWidth;
    const cur = tierRef.current;
    if (over > 4) {
      naturalW.current[cur] = el.scrollWidth;
      if (cur === "full") setTier("more");
      else if (cur === "more") setTier("icon");
    } else {
      const up: TopBarTier | null = cur === "full" ? null : cur === "more" ? "full" : "more";
      const need = up ? naturalW.current[up] : undefined;
      if (up && need != null && el.clientWidth >= need - 2) setTier(up);
    }
  });

  // The topbar's own box (window resize, browser zoom, font size) — observe
  // the element and nudge a re-render so the effect above re-measures.
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => bump((n) => n + 1));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Close popovers on outside click only. The guard on `.menu` (which also
  // wraps the ⋯ button) is load-bearing: React may flush this effect inside
  // the very click that opened the menu, so an unguarded document listener
  // would close it on the opening click itself.
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuOpen]);
  useEffect(() => {
    if (!iconSearchOpen) return;
    const h = (e: MouseEvent) => {
      // The opening click replaces the toggle, so its target is a detached
      // node never caught by contains() — ignore detached targets.
      if (!(e.target instanceof Node) || !e.target.isConnected) return;
      if (iconSearchRef.current && !iconSearchRef.current.contains(e.target as Node)) {
        setIconSearchOpen(false);
      }
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [iconSearchOpen]);

  // --- shared search fragments (rendered full-tier inline or icon-tier in a
  // popover; the same state drives both, only one is mounted at a time) ---
  const searchInput = (
    <input
      placeholder={t("topbar.search.placeholder")}
      value={p.search.q}
      autoFocus={tier === "icon"}
      onChange={(e) => p.search.setQ(e.target.value)}
      onFocus={() => setSearchFocus(true)}
      onBlur={() => setTimeout(() => { setSearchFocus(false); }, 150)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && p.search.results[0]) p.search.onPick(p.search.results[0]);
        if (e.key === "Escape") { p.search.onClose(); setSearchFocus(false); if (tier === "icon") setIconSearchOpen(false); }
      }}
      style={{ width: "100%", minWidth: 0 }}
    />
  );
  const resultList = (
    <>
      <div className="pop-head">
        {t("topbar.search.head")}
        {p.search.total ? t("topbar.search.count", { n: p.search.total }) : ""}
      </div>
      {p.search.loading && <div className="pop-item">{t("topbar.search.loading")}</div>}
      {!p.search.loading && p.search.results.length === 0 && (
        <div className="pop-item muted">{t("topbar.search.empty")}</div>
      )}
      {p.search.results.map((s) => (
        <div
          key={s.id}
          className="pop-item"
          onMouseDown={(e) => {
            e.preventDefault();
            p.search.onPick(s);
            if (tier === "icon") setIconSearchOpen(false);
          }}
        >
          <b>{s.title}</b>
          <span style={{ color: "var(--ink-dim)" }}>
            {" "}· {s.path.map((x) => x.title).join(" / ") || t("common.first.level.node")} · {statusLabel(s.status)}
          </span>
          <div className="muted">{s.summary}</div>
        </div>
      ))}
    </>
  );

  const connText = (
    <>
      {p.actor ? t("topbar.actor", { actor: p.actor }) : "…"}
      {p.appVersion ? t("topbar.conn.version", { v: p.appVersion }) : ""}
      {p.project ? t("topbar.conn.project", { v: p.project.revision }) : ""}
    </>
  );

  return (
    <div className={`topbar${tier === "full" ? "" : ` tier-${tier}`}`} ref={barRef}>
      <span className="brand">ResearchMap</span>

      <select
        className="project-sel"
        value={p.currentProjectId}
        onChange={(e) => p.onSwitchProject(e.target.value)}
        title={t("topbar.switch.project")}
      >
        {p.projects.map((pr) => (
          <option key={pr.id} value={pr.id}>{pr.name}</option>
        ))}
      </select>
      <button onClick={p.onCreateProject} title={t("topbar.new.project.title")}>{t("topbar.new.project")}</button>

      {tier === "icon" ? (
        // A7: search as an expandable entry — revealed in-row (never a
        // clipping side-anchored popover at 540px). The ref'd wrapper holds
        // BOTH states so the opening click (whose target is the toggle the
        // compact box replaces) is still contained by the outside-click guard
        // — same load-bearing pattern as the ⋯ menu above.
        <div className="menu" ref={iconSearchRef}>
          {iconSearchOpen ? (
            <div className="searchbox compact-search" style={{ flex: "0 0 210px" }}>
              {searchInput}
              {showSearch && (
                <div className="pop" style={{ top: "100%", left: 0, right: 0, minWidth: 0, width: "100%" }}>
                  {resultList}
                </div>
              )}
            </div>
          ) : (
            <button
              className="icon-search-btn"
              data-testid="topbar-search-toggle"
              title={t("a7.search.title")}
              onClick={() => setIconSearchOpen(true)}
            >
              🔍
            </button>
          )}
        </div>
      ) : (
        <div className="searchbox">
          {searchInput}
          {showSearch && (
            <div className="pop" style={{ top: "100%", left: 0, right: 0 }}>
              {resultList}
            </div>
          )}
        </div>
      )}

      <button onClick={p.onNewRoot}>{t("topbar.new.route")}</button>

      <div className="menu" ref={menuRef}>
        <button
          className={menuOpen ? "dotmenu open" : "dotmenu"}
          onClick={() => setMenuOpen((v) => !v)}
          title={t("topbar.more.title")}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="pop" style={{ top: "100%", right: 0 }}>
            {tier !== "full" && (
              <>
                {/* conn demoted to a read-only item at more/icon tiers */}
                <div className="pop-item topbar-conn-item" style={{ pointerEvents: "none", whiteSpace: "normal" }}>
                  {connText}
                </div>
                <div className="pop-item dotmenu-line" onClick={() => { setMenuOpen(false); p.onManualRefresh(); }}>
                  {t("topbar.refresh")}
                </div>
                <div className="pop-item" onClick={() => { setMenuOpen(false); p.onExit(); }} title={t("topbar.exit.title")}>
                  {t("topbar.exit")}
                </div>
              </>
            )}
            {p.project && (
              <div className="pop-item" onClick={() => { setMenuOpen(false); p.onEditProject(); }}>
                {t("topbar.menu.project.settings")}
              </div>
            )}
            <div className="pop-item" data-testid="topbar-versions" onClick={() => { setMenuOpen(false); p.onManageVersions(); }}>
              {t("ver.manage")}
            </div>
            <div className="pop-item" onClick={() => { setMenuOpen(false); p.onFit(); }}>
              {t("topbar.menu.fit")}
            </div>
            <div
              className={`pop-item dotmenu-line${p.showArchived ? " on" : ""}`}
              onClick={() => p.onToggleArchived()}
            >
              {p.showArchived ? t("topbar.menu.hide.archived") : t("topbar.menu.show.archived")}
            </div>
            <div className={`pop-item dotmenu-line${p.recent.open ? " on" : ""}`} onClick={() => p.recent.toggle()}>
              {t("topbar.menu.recent")}
            </div>
            {p.recent.open && (
              <>
                {p.recent.commits.length === 0 && <div className="pop-item muted sub">{t("topbar.menu.no.commits")}</div>}
                {p.recent.commits.map((c) => (
                  <div
                    key={c.id}
                    className="pop-item sub"
                    onClick={() => {
                      p.recent.onPick(c);
                      setMenuOpen(false);
                    }}
                  >
                    <b>{t("topbar.recent.rev", { n: c.revision })}</b> · {c.summary}
                    <div className="muted">{fmtTime(c.created_at)} · {c.actor}</div>
                  </div>
                ))}
              </>
            )}
            <div
              className="pop-item"
              onClick={() => {
                setMenuOpen(false);
                p.onExport();
              }}
              title={t("topbar.menu.export.title")}
            >
              {t("topbar.menu.export")}
            </div>
            <div className="pop-item" onClick={() => { setMenuOpen(false); p.onShowAiAccess(); }}>
              {t("topbar.menu.ai")}
            </div>
            <div
              className="pop-item dotmenu-line"
              data-testid="lang-toggle"
              onClick={() => { setMenuOpen(false); setLang(getLang() === "zh" ? "en" : "zh"); }}
            >
              {getLang() === "zh" ? t("topbar.menu.lang.to_en") : t("topbar.menu.lang.to_zh")}
            </div>
          </div>
        )}
      </div>

      {tier === "full" && (
        <button onClick={p.onManualRefresh} title={t("topbar.refresh.title")}>{t("topbar.refresh")}</button>
      )}

      {tier === "full" && (
        <span className="conn" title={t("topbar.actor.title")}>
          {connText}
        </span>
      )}
      {tier === "full" && (
        <button onClick={p.onExit} title={t("topbar.exit.title")}>{t("topbar.exit")}</button>
      )}
    </div>
  );
}
