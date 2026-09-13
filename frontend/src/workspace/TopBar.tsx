/** Top bar (SPEC 3.1): project switch, search, new top-level route, fit
 *  view, recent changes, export, connection info. */

import { useState } from "react";
import type { Project, SearchItem } from "../lib/types";
import { STATUS_LABEL, fmtTime } from "../lib/format";
import type { CommitItem } from "../lib/types";
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
  const [searchFocus, setSearchFocus] = useState(false);
  const showSearch = p.search.open || (searchFocus && p.search.q.trim());

  return (
    <div className="topbar">
      <span className="brand">ResearchMap</span>

      <select
        value={p.currentProjectId}
        onChange={(e) => p.onSwitchProject(e.target.value)}
        title="切换项目"
      >
        {p.projects.map((pr) => (
          <option key={pr.id} value={pr.id}>{pr.name}</option>
        ))}
      </select>
      <button onClick={p.onCreateProject} title="创建项目">+ 项目</button>
      {p.project && <button onClick={p.onEditProject} title="编辑项目名称与目标">项目设置</button>}

      <div style={{ position: "relative", flex: 1, maxWidth: 420 }}>
        <input
          placeholder="搜索标题/摘要/标签/观察/结论（中文子串可用）"
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
              搜索结果（点击 = 展开祖先并定位，不隐藏主树）{p.search.total ? ` · 共 ${p.search.total}` : ""}
            </div>
            {p.search.loading && <div className="pop-item">检索中…</div>}
            {!p.search.loading && p.search.results.length === 0 && (
              <div className="pop-item muted">无匹配（折叠不影响搜索覆盖）</div>
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
                  {" "}· {s.path.map((x) => x.title).join(" / ") || "一级节点"} · {STATUS_LABEL[s.status]}
                </span>
                <div className="muted">{s.summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={p.onNewRoot}>+ 一级路线</button>
      <button onClick={p.onFit} title="将视野调整到当前全图（仅手动触发）">适应当前图</button>

      <div style={{ position: "relative" }}>
        <button onClick={p.recent.toggle} title="最近的提交（定位到具体节点）">近期变化 ▾</button>
        {p.recent.open && (
          <div className="pop" style={{ top: "100%", right: 0 }}>
            <div className="pop-head">近期变化（新→旧）</div>
            {p.recent.commits.length === 0 && <div className="pop-item muted">暂无提交</div>}
            {p.recent.commits.map((c) => (
              <div key={c.id} className="pop-item" onClick={() => p.recent.onPick(c)}>
                <b>v{c.revision}</b> · {c.summary}
                <div className="muted">{fmtTime(c.created_at)} · {c.actor}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={p.onExport} title="下载完整项目 JSON（含归档与历史）">导出</button>
      <button onClick={p.onManualRefresh} title="手动检查记录是否变化">刷新</button>

      <div className="conn grow" />
      <span className="conn" title="本次会话的访问者身份（由令牌决定，不可伪造）">
        {p.actor ? `身份: ${p.actor}` : "…"}
        {p.appVersion ? ` · v${p.appVersion}` : ""}
        {p.project ? ` · 项目 v${p.project.revision}` : ""}
      </span>
      <button onClick={p.onExit} title="退出（清空页面内存中的令牌，需重新输入）">退出</button>
    </div>
  );
}