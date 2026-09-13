/** Token gate (SPEC 9): the bearer token lives only in page memory.
 *  No Cookie, no localStorage, no URL — a refresh requires re-entry. */

import { useState } from "react";
import api, { setToken } from "../lib/api";

export interface ProjectLite {
  id: string;
  name: string;
  objective: string;
  revision: number;
}

interface Props {
  deepProjectId?: string;
  onEnter: (projects: ProjectLite[], projectId: string | null, error?: string) => void;
}

export default function TokenGate({ deepProjectId, onEnter }: Props) {
  const [token, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function enter() {
    if (!token.trim()) return;
    setBusy(true);
    setErr("");
    try {
      setToken(token.trim());
      const list = await api.projects();
      onEnter(list.items, deepProjectId ?? list.items[0]?.id ?? null);
    } catch (e) {
      setToken(null);
      setErr(e instanceof Error ? e.message : "无法连接服务器");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="box">
        <h1>ResearchMap</h1>
        <div className="sub">轻量科研演化地图 · 输入访问令牌打开工作站</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            autoFocus
            placeholder="访问令牌（Bearer token）"
            value={token}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
          />
          <button className="primary" onClick={enter} disabled={busy}>
            {busy ? "打开…" : "打开"}
          </button>
        </div>
        {err && <div className="hint err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="note">
          令牌只保存在页面内存中，刷新后需要重新输入；不会写入 Cookie、localStorage 或 URL。
          本应用不需要任何模型 API Key。
        </div>
      </div>
    </div>
  );
}