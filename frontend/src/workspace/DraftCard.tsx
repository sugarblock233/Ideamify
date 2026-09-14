/** C3: the canvas card of an unsaved node-create draft (plan §10.2/§10.4).
 *
 *  A short edition surface bound to the SAME draft session the side panel
 *  edits — kind/status/title/summary here, every field there; typing on the
 *  card updates the panel and vice versa. Visually a dashed "ghost" of a
 *  real card, connected to its parent (or the virtual root) by a dashed temp
 *  edge that Canvas renders.
 *
 *  Enter commits the short edit (blurs, like a mini form) but must never fire
 *  during IME composition (Chinese input confirms candidates with Enter);
 *  ⌘/Ctrl+Enter saves. Buttons mirror the side panel's own savebar. */

import React, { useRef } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { DRAFT_W, DRAFT_H } from "../lib/layout";
import { kindLabel, statusLabel } from "../lib/format";
import { NODE_KINDS, NODE_STATUSES } from "../lib/types";
import type { Draft } from "./SidePanel";
import { useT } from "../lib/i18n";

export interface DraftData extends Record<string, unknown> {
  d: Draft;
  busy: boolean;
  err: string | null;
  /** B2: vertical tree — handles flip from left/right to top/bottom */
  v?: boolean;
  onFields: (patch: Partial<Draft>) => void;
  onSave: () => void;
  onCancel: () => void;
}

export const DraftCard = React.memo(function DraftCard(props: NodeProps) {
  const t = useT();
  const d = props.data as DraftData;
  const f = d.d;
  // IME guard: compositionstart/end brackets candidate editing; Safari fires
  // compositionend before the confirming keydown, Chrome after — isComposing
  // plus a trailing ref covers both orders.
  const composingRef = useRef(false);

  const onTitleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter") return;
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) return;
    e.preventDefault();
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (f.title.trim() && !d.busy) d.onSave();
    } else {
      e.currentTarget.blur(); // commit the short edit, keep editing on the card
    }
  };

  return (
    <div
      className={`rm-draft${d.busy ? " busy" : ""}`}
      style={{ width: DRAFT_W, height: DRAFT_H }}
    >
      <Handle type="target" position={d.v ? Position.Top : Position.Left} isConnectable={false} style={{ opacity: 0 }} />
      <Handle type="source" position={d.v ? Position.Bottom : Position.Right} isConnectable={false} style={{ opacity: 0 }} />
      <div className="row1">
        <select
          aria-label={t("fld.kind")}
          value={f.kind}
          onChange={(e) => d.onFields({ kind: e.target.value as Draft["kind"] })}
        >
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>{kindLabel(k)}</option>
          ))}
        </select>
        <select
          aria-label={t("fld.status")}
          value={f.status}
          onChange={(e) => d.onFields({ status: e.target.value as Draft["status"] })}
        >
          {NODE_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
        <span className="chip">{t("ws.draft.unsaved")}</span>
      </div>
      <textarea
        className="draft-title"
        placeholder={t("fld.title")}
        value={f.title}
        maxLength={80}
        rows={1}
        onPointerDown={(e) => e.stopPropagation()}
        onCompositionStart={() => (composingRef.current = true)}
        onCompositionEnd={() => (composingRef.current = false)}
        onKeyDown={onTitleKeyDown}
        onChange={(e) => d.onFields({ title: e.target.value })}
      />
      <textarea
        className="draft-summary"
        placeholder={t("fld.summary")}
        value={f.summary}
        maxLength={280}
        rows={2}
        onPointerDown={(e) => e.stopPropagation()}
        onChange={(e) => d.onFields({ summary: e.target.value })}
      />
      {d.err && <div className="draft-err">{d.err}</div>}
      <div className="draft-actions">
        <span className="draft-hint" aria-hidden>⌘/Ctrl+↵</span>
        <button
          className="primary"
          disabled={!f.title.trim() || d.busy}
          data-testid="draft-card-save"
          onClick={(e) => {
            e.stopPropagation();
            d.onSave();
          }}
        >
          {d.busy ? t("modal.creating") : t("modal.create")}
        </button>
        <button
          data-testid="draft-card-cancel"
          disabled={d.busy}
          onClick={(e) => {
            e.stopPropagation();
            d.onCancel();
          }}
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );
});
