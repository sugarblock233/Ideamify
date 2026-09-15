/** Token gate (SPEC 9): the bearer token lives only in page memory.
 *  No Cookie, no localStorage, no URL — a refresh requires re-entry. */

import { useState } from "react";
import api, { setToken } from "../lib/api";
import { useT } from "../lib/i18n";

export type { ProjectLite } from "../lib/api";

interface Props {
  onEnter: () => Promise<void>;
}

export default function TokenGate({ onEnter }: Props) {
  const t = useT();
  const [token, setTokenInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function enter() {
    if (!token.trim() || busy) return;
    setBusy(true);
    setErr("");
    try {
      setToken(token.trim());
      await api.session();
      await onEnter();
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