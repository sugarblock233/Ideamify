import { useEffect, useMemo, useRef, useState } from "react";
import api, { uuidv4, type ProjectLite } from "../lib/api";
import { getLang, setLang, useT } from "../lib/i18n";
import { fmtTime } from "../lib/format";

export default function ProjectDashboard({ projects, actor, localMode, onEnter, onRefresh, onExit }: {
  projects: ProjectLite[];
  actor: string;
  localMode: boolean;
  onEnter: (id: string) => void;
  onRefresh: () => Promise<void>;
  onExit: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [creating, setCreating] = useState(projects.length === 0);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [createError, setCreateError] = useState("");
  // Reuse the exact request on retry; an uncertain response cannot duplicate a project.
  const pending = useRef<{ request_id: string; name: string; objective: string } | null>(null);
  const valid = !!name.trim() && !!objective.trim();
  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return projects.filter((p) => `${p.name}\n${p.objective}`.toLocaleLowerCase().includes(q))
      .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name)
        : (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.name.localeCompare(b.name));
  }, [projects, query, sort]);
  async function refresh() {
    setRefreshing(true); setError("");
    try { await onRefresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t("gate.err.network")); }
    finally { setRefreshing(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function create() {
    if (!valid || busy) return;
    setBusy(true); setCreateError("");
    try {
      if (!pending.current || pending.current.name !== name.trim() || pending.current.objective !== objective.trim()) {
        pending.current = { request_id: uuidv4(), name: name.trim(), objective: objective.trim() };
      }
      const res = await api.createProject(pending.current);
      // Creation is already committed: a list-refresh failure must not turn
      // it into a failed creation or cause a second submission.
      await onRefresh().catch(() => {});
      onEnter(res.id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : t("empty.create.err"));
    } finally { setBusy(false); }
  }
  return (
    <div className="project-dashboard" data-testid="project-dashboard">
      <header className="dashboard-header">
        <span className="brand">ResearchMap</span>
        <div className="dashboard-account"><span title={actor}>{localMode ? t("dashboard.local") : t("topbar.actor", { actor })}</span>
          <button onClick={() => setLang(getLang() === "zh" ? "en" : "zh")}>
            {getLang() === "zh" ? "English" : "中文"}
          </button>
          {!localMode && <button onClick={onExit}>{t("topbar.exit")}</button>}
        </div>
      </header>
      <main className="dashboard-main">
        <div className="dashboard-intro"><div>
          <p className="dashboard-eyebrow">{t("dashboard.eyebrow")}</p>
          <h1>{t("dashboard.title")}</h1>
          <p className="muted">{t("dashboard.subtitle")}</p>
        </div><button className="primary" onClick={() => setCreating((v) => !v)} aria-expanded={creating}>
          {creating ? t("dashboard.close.create") : t("dashboard.new")}
        </button></div>
        {creating && <form className="project-create" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <h2>{t("empty.create")}</h2>
          <label className="field" htmlFor="project-name">{t("empty.name.label")}</label>
          <input id="project-name" autoFocus value={name} maxLength={100} disabled={busy}
            onChange={(e) => setName(e.target.value)} placeholder={t("empty.name.placeholder")} />
          <label className="field" htmlFor="project-objective">{t("empty.objective.label")}</label>
          <textarea id="project-objective" value={objective} maxLength={4000} disabled={busy}
            onChange={(e) => setObjective(e.target.value)} placeholder={t("empty.objective.placeholder")} />
          {createError && <div role="alert" className="hint err">{createError}</div>}
          <button className="primary" disabled={!valid || busy}>{t(busy ? "empty.creating" : "empty.create")}</button>
        </form>}
        <div className="dashboard-tools">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dashboard.search")} aria-label={t("dashboard.search")} />
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("dashboard.sort")}>
            <option value="recent">{t("dashboard.recent")}</option>
            <option value="name">{t("dashboard.name")}</option>
          </select>
          <button onClick={() => void refresh()} disabled={refreshing}>{t(refreshing ? "empty.refreshing" : "empty.refresh")}</button>
        </div>
        {error && <div role="alert" className="hint err">{error}</div>}
        <p className="dashboard-count" aria-live="polite">{t("dashboard.count", { n: visible.length, total: projects.length })}</p>
        {projects.length === 0 ? <div className="dashboard-empty"><h2>{t("empty.none")}</h2><p>{t("dashboard.empty.hint")}</p></div>
          : visible.length === 0 ? <div className="dashboard-empty"><h2>{t("dashboard.no.matches")}</h2>
            <button onClick={() => setQuery("")}>{t("dashboard.clear")}</button></div>
          : <div className="project-grid">{visible.map((p) => <button className="project-card" key={p.id}
              data-testid="project-card" onClick={() => onEnter(p.id)} aria-label={t("dashboard.enter", { name: p.name })}>
              <span className="project-card-symbol" aria-hidden="true">↗</span>
              <h2>{p.name}</h2><p className="project-objective" title={p.objective}>{p.objective}</p>
              <div className="project-card-meta"><span>{t("root.record", { n: p.revision })}</span>
                {p.updated_at && <time dateTime={p.updated_at}>{t("dashboard.updated", { time: fmtTime(p.updated_at) })}</time>}</div>
              <span className="project-card-enter">{t("dashboard.open.map")} <span aria-hidden="true">→</span></span>
            </button>)}</div>}
      </main>
    </div>
  );
}
