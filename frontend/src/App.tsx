import { useMemo, useState } from "react";
import TokenGate, { type ProjectLite } from "./gate/TokenGate";
import Workspace from "./workspace/Workspace";
import { parseDeepLink } from "./lib/deeplink";
import { setToken } from "./lib/api";

export default function App() {
  const deep = useMemo(() => parseDeepLink(), []);
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
      <div className="gate">
        <div className="box">
          <h1>ResearchMap</h1>
          <div className="sub">没有可用项目，请在使用前创建一个。</div>
        </div>
      </div>
    );
  }

  return (
    <Workspace
      key={projectId}
      projectId={projectId}
      projects={projects}
      initialNodeId={deep.nodeId}
      onChangeProject={setProjectId}
      refreshProjectList={setProjects}
      onExit={() => {
        setToken(null);
        setAuthed(false);
        setProjectId(null);
      }}
    />
  );
}