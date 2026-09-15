import { useCallback, useEffect, useMemo, useState } from "react";
import TokenGate from "./gate/TokenGate";
import ProjectDashboard from "./projects/ProjectDashboard";
import Workspace from "./workspace/Workspace";
import { parseDeepLink, replaceDeepLink } from "./lib/deeplink";
import api, { setToken, type ProjectLite } from "./lib/api";
import { ApiError } from "./lib/types";
import { useT } from "./lib/i18n";

export default function App() {
  const t = useT();
  const deep = useMemo(() => parseDeepLink(), []);
  const [entryNode, setEntryNode] = useState<string | null>(deep.nodeId ?? null);
  const [projectId, setProjectId] = useState<string | null>(deep.projectId ?? null);
  const [projects, setProjects] = useState<ProjectLite[]>([]);
  const [session, setSession] = useState<Awaited<ReturnType<typeof api.session>> | null>(null);
  const [phase, setPhase] = useState<"loading" | "gate" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [reauth, setReauth] = useState(false);
  const refresh = useCallback(async () => { setProjects((await api.projects()).items); }, []);
  const enter = useCallback(async () => {
    const info = await api.session();
    await refresh();
    setSession(info); setPhase("ready"); setReauth(false);
  }, [refresh]);
  const boot = useCallback(async () => {
    setPhase("loading"); setError("");
    try { await enter(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) setPhase("gate");
      else { setError(e instanceof Error ? e.message : t("gate.err.network")); setPhase("error"); }
    }
  }, [enter, t]);
  useEffect(() => { void boot(); }, [boot]);
  useEffect(() => {
    const handler = () => { if (phase === "ready") setReauth(true); };
    window.addEventListener("rm:unauthorized", handler);
    return () => window.removeEventListener("rm:unauthorized", handler);
  }, [phase]);
  function navigate(id: string | null) {
    setEntryNode(null); setProjectId(id);
    if (id) replaceDeepLink(id);
    else window.history.replaceState(null, "", "/");
  }
  function exit() {
    setToken(null); setSession(null); setProjects([]); setReauth(false);
    navigate(null); setPhase("gate");
  }
  if (phase === "loading" || phase === "error") return <div className="gate"><div className="box">
    <h1>ResearchMap</h1>
    {phase === "loading" ? <p role="status">{t("dashboard.loading")}</p>
      : <><p className="hint err" role="alert">{error}</p><button onClick={() => void boot()}>{t("dashboard.retry")}</button></>}
  </div></div>;
  if (phase === "gate") return <TokenGate onEnter={enter} />;
  return <>
    {/* A remote credential expiring does not unmount and discard an open draft. */}
    <div className="app-content" inert={reauth}>
      {projectId ? <Workspace key={projectId} projectId={projectId} projects={projects}
        initialNodeId={entryNode ?? undefined} onChangeProject={navigate} refreshProjectList={setProjects}
        onHome={() => { navigate(null); }} onExit={exit} localMode={session?.auth_mode === "local"} />
        : <ProjectDashboard projects={projects} actor={session?.actor ?? "researcher"}
          localMode={session?.auth_mode === "local"} onEnter={navigate} onRefresh={refresh}
          onExit={exit} />}
    </div>
    {reauth && <div className="reauth-overlay" role="dialog" aria-modal="true" aria-label={t("gate.subtitle")}>
      <TokenGate onEnter={enter} />
    </div>}
  </>;
}
