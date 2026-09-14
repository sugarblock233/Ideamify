/** Token gate (SPEC 9): the bearer token lives only in page memory.
 *  No Cookie, no localStorage, no URL — a refresh requires re-entry. */

import { useState } from "react";
import api, { setToken } from "../lib/api";
import { useT } from "../lib/i18n";

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
  const t = useT();
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
      // Server-provided error messages pass through untranslated (DECISIONS §16);
      // only the synthetic fallback is keyed.
      setErr(e instanceof Error ? e.message : t("gate.err.network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="box">
        <h1>ResearchMap</h1>
        <div className="sub">{t("gate.subtitle")}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="password"
            autoFocus
            placeholder={t("gate.token.placeholder")}
            value={token}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && enter()}
          />
          <button className="primary" onClick={enter} disabled={busy}>
            {busy ? t("gate.opening") : t("gate.open")}
          </button>
        </div>
        {err && <div className="hint err" style={{ marginTop: 10 }}>{err}</div>}
        <div className="note">{t("gate.note")}</div>
      </div>
    </div>
  );
}