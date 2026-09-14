/** Top bar (SPEC 3.1): project switch, search, new top-level route, secondary
 *  actions behind ⋯, connection info.
 *
 *  A09: single row at 1280×800 — the secondary actions collapsed into a ⋯
 *  menu, the search box flexes (min-width 240), the project select and the
 *  connection span ellipsize instead of wrapping.
 */

import { useEffect, useRef, useState } from "react";
import type { Project, SearchItem, CommitItem } from "../lib/types";
import { STATUS_LABEL, fmtTime } from "../lib/format";
import { getLang, setLang, useT } from "../lib/i18n";
import type { ProjectLite } from "../gate/TokenGate";

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
  const [searchFocus, setSearchFocus] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const showSearch = p.search.open || (searchFocus && p.search.q.trim());

  // Close on outside click only. The guard on `.menu` (which also wraps the
  // ⋯ button) is load-bearing: React may flush this effect inside the very
  // click that opened the menu, so an unguarded document listener would
  // close it on the opening click itself.
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [menuOpen]);

  return (
    <div className="topbar">
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

      <div className="searchbox">
        <input
          placeholder={t("topbar.search.placeholder")}
          value={p.search.q}
          onChange={(e) => p.search.setQ(e.target.value)}
          onFocus={() => setSearchFocus(true)}
          onBlur={() => setTimeout(() => { setSearchFocus(false); }, 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && p.search.results[0]) p.search.onPick(p.search.results[0]);
            if (e.key === "Escape") { p.search.onClose(); setSearchFocus(false); }
          }}
          style={{ width: "100%" }}
        />
        {showSearch && (
          <div className="pop" style={{ top: "100%", left: 0, right: 0 }}>
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
                }}
              >
                <b>{s.title}</b>
                <span style={{ color: "var(--ink-dim)" }}>
                  {" "}· {s.path.map((x) => x.title).join(" / ") || t("common.first.level.node")} · {STATUS_LABEL[s.status]}
                </span>
                <div className="muted">{s.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>

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
            {p.project && (
              <div className="pop-item" onClick={() => { setMenuOpen(false); p.onEditProject(); }}>
                {t("topbar.menu.project.settings")}
              </div>
            )}
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
                    <b>v{c.revision}</b> · {c.summary}
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

      <button onClick={p.onManualRefresh} title={t("topbar.refresh.title")}>{t("topbar.refresh")}</button>

      <span className="conn" title={t("topbar.actor.title")}>
        {p.actor ? t("topbar.actor", { actor: p.actor }) : "…"}
        {p.appVersion ? t("topbar.conn.version", { v: p.appVersion }) : ""}
        {p.project ? t("topbar.conn.project", { v: p.project.revision }) : ""}
      </span>
      <button onClick={p.onExit} title={t("topbar.exit.title")}>{t("topbar.exit")}</button>
    </div>
  );
}