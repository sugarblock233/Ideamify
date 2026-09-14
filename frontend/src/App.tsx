import { useMemo, useState } from "react";
import TokenGate, { type ProjectLite } from "./gate/TokenGate";
import Workspace from "./workspace/Workspace";
import { parseDeepLink } from "./lib/deeplink";
import api, { uuidv4, setToken } from "./lib/api";
import { ApiError } from "./lib/types";
import { useT } from "./lib/i18n";

/** A01: the empty state is a working screen, not a dead end — create the
 *  first project directly in the browser (same commit path as the UI), enter
 *  an existing project, or switch token. Input is preserved on errors. */
function EmptyProjects({
  projects,
  onEnter,
  onRefresh,
}: {
  projects: ProjectLite[];
  onEnter: (id: string) => void;
  onRefresh: (list: ProjectLite[]) => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const valid = name.trim().length >= 1 && name.trim().length <= 100 && objective.trim().length >= 1;

  const refresh = async () => {
    setRefreshing(true);
    try {
      onRefresh((await api.projects()).items);
    } catch {
      /* keep current list */
    } finally {
      setRefreshing(false);
    }
  };

  const create = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.createProject({
        request_id: uuidv4(),
        name: name.trim(),
        objective: objective.trim(),
      });
      const list = await api.projects();
      onRefresh(list.items);
      onEnter(res.id);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t("empty.create.err"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="box">
        <h1>ResearchMap</h1>
        <div className="sub">
          {projects.length ? t("empty.enter.or.create") : t("empty.none")}
        </div>
        {projects.map((pr) => (
          <button
            key={pr.id}
            style={{ width: "100%", textAlign: "left", marginBottom: 6 }}
            onClick={() => onEnter(pr.id)}
          >
            {t("empty.enter.btn", { name: pr.name, rev: pr.revision })}
          </button>
        ))}
        <div style={{ borderTop: "1px solid var(--line)", margin: "12px 0" }} />
        <label className="field">{t("empty.name.label")}</label>
        <input
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("empty.name.placeholder")}
        />
        <label className="field">{t("empty.objective.label")}</label>
        <textarea
          value={objective}
          maxLength={4000}
          onChange={(e) => setObjective(e.target.value)}
          style={{ minHeight: 80 }}
          placeholder={t("empty.objective.placeholder")}
        />
        {err && <div className="hint err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="mrow" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? t("empty.creating") : t("empty.create")}
          </button>
          <button onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? t("empty.refreshing") : t("empty.refresh")}
          </button>
        </div>
        <div className="note">{t("empty.note")}</div>
      </div>
    </div>
  );
}

export default function App() {
  const deep = useMemo(() => parseDeepLink(), []);
  // The deep-link node id is only for the URL's own project; entering a
  // project from the list never drags a foreign/stale node id along.
  const [entryNode, setEntryNode] = useState<string | null>(deep.nodeId ?? null);
  // "token" here only records presence; the value itself lives in lib/api memory.
  const [authed, setAuthed] = useState(false);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);

  if (!authed) {
    return (
      <TokenGate
        deepProjectId={deep.projectId}
        onEnter={(list, pid) => {
          setProjects(list);
          setAuthed(true);
          setProjectId(pid);
        }}
      />
    );
  }

  if (!projectId) {
    return (
      <EmptyProjects
        projects={projects}
        onEnter={(id) => {
          setEntryNode(null);
          setProjectId(id);
        }}
        onRefresh={setProjects}
      />
    );
  }

  return (
    <Workspace
      key={projectId}
      projectId={projectId}
      projects={projects}
      initialNodeId={entryNode ?? undefined}
      onChangeProject={(pid) => {
        setEntryNode(null);
        setProjectId(pid);
      }}
      refreshProjectList={setProjects}
      onExit={() => {
        setToken(null);
        setAuthed(false);
        setProjectId(null);
        setEntryNode(null);
      }}
    />
  );
}