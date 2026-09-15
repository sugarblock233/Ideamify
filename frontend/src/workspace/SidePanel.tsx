/** Right panel: node detail + edit (save/cancel), relations list with
 *  pagination, node history with before/after (SPEC 3.2 / 3.3 / 3.5). */

import { Fragment, useEffect, useRef, useState } from "react";
import type {
  ChangeEntry,
  CommitDetail,
  CommitItem,
  EvidenceItem,
  NodeFull,
  NodeKind,
  NodeStatus,
  Project,
  RelationItem,
  RelationKind,
  ResearchVersion,
} from "../lib/types";
import { NODE_KINDS, NODE_STATUSES, RELATION_KINDS } from "../lib/types";
import { STATUS_COLOR, fmtTime, kindLabel, relationKindLabel, statusLabel } from "../lib/format";
import { MAX_CANVAS_RELATION, relationLabel } from "../lib/relations";
import { t, useT } from "../lib/i18n";
import MarkdownBody from "./MarkdownBody";
import { appendAttachmentRef } from "../lib/attachments";
import api from "../lib/api";
import { ApiError } from "../lib/types";
import type { FieldConflict } from "../lib/merge";

/* ------------------------------- draft ---------------------------------- */

export interface Draft {
  kind: NodeKind;
  title: string;
  summary: string;
  status: NodeStatus;
  rationale: string;
  finding: string;
  decision: string;
  scope: string;
  details_md: string;
  tags: string[];
  evidence: EvidenceItem[];
  /** E 批 §7：科研版本归属（id 数组；显式数组 = 整组替换） */
  version_ids: string[];
}

export function draftOf(n: NodeFull): Draft {
  return {
    kind: n.kind,
    title: n.title,
    summary: n.summary,
    status: n.status,
    rationale: n.rationale,
    finding: n.finding,
    decision: n.decision,
    scope: n.scope,
    details_md: n.details_md,
    tags: [...n.tags],
    evidence: JSON.parse(JSON.stringify(n.evidence)) as EvidenceItem[],
    version_ids: [...n.version_ids],
  };
}

/** A02/R02: localized labels for the three-way conflict comparison. */
export function draftFieldLabel(f: keyof Draft): string {
  return t(`fld.${f}`);
}

/** One field both you and someone else changed, with all three versions so
 *  the user can compare instead of being told "已保留你的值" after the fact. */
export type DraftConflict = FieldConflict<Draft>;

/** Human-readable rendering of any draft field for the comparison table.
 *  `versionNameOf` maps科研版本 id → name, so conflicts read as names, not UUIDs. */
export function formatDraftValue(
  field: keyof Draft,
  v: Draft[keyof Draft],
  versionNameOf?: (id: string) => string | null,
): string {
  if (field === "kind") return kindLabel(v as NodeKind);
  if (field === "status") return statusLabel(v as NodeStatus);
  if (field === "tags") {
    const tags = v as string[];
    return tags.length ? tags.join(t("common.list.sep")) : t("common.empty.paren");
  }
  if (field === "version_ids") {
    const ids = v as string[];
    if (!ids.length) return t("ver.unassigned");
    return ids.map((id) => versionNameOf?.(id) ?? id).join(t("common.list.sep"));
  }
  if (field === "evidence") {
    const e = v as EvidenceItem[];
    if (!e.length) return t("fmt.evidence.none");
    return e.map((x) => `${x.kind}｜${x.label || t("fmt.evidence.nolabel")}｜${x.value}`).join("\n");
  }
  const s = String(v ?? "");
  return s.trim() ? s : t("common.empty.paren");
}

/** maps科研版本 id → name, so conflicts read as names, not UUIDs */
export function versionNameOf(
  versions: ResearchVersion[],
): (id: string) => string | null {
  return (id) => versions.find((v) => v.id === id)?.name ?? null;
}

export function diffDraft(base: Draft, cur: Draft): Partial<Draft> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base) as (keyof Draft)[]) {
    if (JSON.stringify(base[k]) !== JSON.stringify(cur[k])) out[k] = cur[k];
  }
  return out as Partial<Draft>;
}

/* ------------------------------ panel props ----------------------------- */

export interface SidePanelProps {
  project: Project | null;
  node: NodeFull | null;
  loading: boolean;
  tab: "detail" | "relations" | "history";
  setTab: (t: "detail" | "relations" | "history") => void;
  /** E 批 §7：科研版本（展示顺序），创建/编辑表单的版本 chip 数据源 */
  versions: ResearchVersion[];

  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  dirty: boolean;
  /** A02: draft baseline is older than the loaded project revision. */
  draftStale: boolean;
  /** A02: the project revision this draft was read at. */
  draftBaseRev: number | null;
  draftErr: string | null;
  /** A02/R02: fields both sides changed; saving is blocked until each is
   *  resolved so nothing is submitted as if it had been reviewed. */
  conflicts: DraftConflict[];
  onResolveConflictField: (field: keyof Draft, choice: "local" | "server" | "manual") => void;
  onDiscardDraft: () => void;
  onSave: () => void;

  conflictRevision: number | null;
  onRebaseDraft: () => void;
  onResolveConflict: () => void;

  relations: RelationItem[];
  relHasMore: boolean;
  relCursor: string | null;
  includeArchived: boolean;
  setIncludeArchived: (b: boolean) => void;
  onRelPage: (cursor: string | null, append: boolean) => void;
  selectedRelationId: string | null;
  onPickRelation: (id: string | null) => void;
  onLocate: (nodeId: string, fromId?: string) => void;
  cameFrom: string | null;
  onBackToFrom: () => void;
  onCreateRelation: () => void;
  onCreateChild: () => void;
  onEditRelation: (r: RelationItem, fields: { kind: RelationKind; reason: string }) => void;
  onArchiveRelation: (r: RelationItem, reason: string) => void;
  onRestoreRelation: (r: RelationItem, reason: string) => void;

  organization: {
    parentOptions: { id: string | null; label: string }[];
    currentParent: string | null;
    onMove: (parent: string | null) => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    canUp: boolean;
    canDown: boolean;
    onArchive: (reason: string) => void;
    onRestore: (reason: string) => void;
  } | null;

  /** C2: an in-progress node-create draft (canvas draft card of C3 edits the
   *  same session). While set, the panel shows the create form instead of the
   *  selected node's detail. */
  createDraft: {
    parentId: string | null;
    parentLabel: string;
    fields: Draft;
    err: string | null;
    busy: boolean;
    onFields: (f: Draft) => void;
    onSave: () => void;
    onCancel: () => void;
  } | null;

  history: {
    commits: CommitItem[];
    detail: CommitDetail | null;
    hasMore?: boolean;
    onLoadMore?: () => void;
    /** B04: resolve historical parent ids to titles (graph may have moved on). */
    titleOf?: (id: string) => string | null;
    onSelect: (c: CommitItem) => void;
  };
}

/* --------------------------------- panel --------------------------------- */

export default function SidePanel(p: SidePanelProps) {
  const t = useT();
  const n = p.node;
  // C2: the create draft swaps the panel CONTENT but must not unmount the
  // detail view — DetailTab keeps `editing` in local state, and unmounting it
  // (early-return) would drop a user's open editor when they jot down a draft
  // node mid-edit. Hidden ≠ cancelled: same rule as ResizablePanel.
  return (
    <aside className="side">
      <div className="head">
        <div className="tabs" style={{ padding: 0, borderTop: "none", marginBottom: -12 }}>
          {p.createDraft ? (
            <button className="active">{t("tab.detail")}</button>
          ) : (
            <>
              <button className={p.tab === "detail" ? "active" : ""} onClick={() => p.setTab("detail")}>
                {t("tab.detail")}
              </button>
              <button className={p.tab === "relations" ? "active" : ""} onClick={() => p.setTab("relations")}>
                {t("tab.relations")}
              </button>
              <button className={p.tab === "history" ? "active" : ""} onClick={() => p.setTab("history")}>
                {t("tab.history")}
              </button>
            </>
          )}
        </div>
      </div>
      {p.createDraft && (
        <CreateDraftTab draft={p.createDraft} pid={p.project?.id ?? null} versions={p.versions} />
      )}
      {/* C2: the wrapped detail stays mounted (hidden) so an in-progress edit
          survives the draft session; e2e targets the draft pathline by testid
          to dodge the hidden duplicate. */}
      <div style={p.createDraft ? { display: "none" } : undefined}>
        {!n && (
          <div className="body">
            <div className="empty">
              {p.loading ? t("panel.loading") : t("panel.empty.select")}
            </div>
            <ProjectInfo project={p.project} />
          </div>
        )}
        {n && p.tab === "detail" && (
          <DetailTab p={p} n={n} />
        )}
        {n && p.tab === "relations" && <RelationsTab p={p} n={n} />}
        {n && p.tab === "history" && <HistoryTab n={n} history={p.history} />}
      </div>
    </aside>
  );
}

function ProjectInfo({ project }: { project: Project | null }) {
  const t = useT();
  if (!project) return null;
  return (
    <div className="muted" style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{project.name}</div>
      <div style={{ margin: "4px 0" }}>{project.objective}</div>
      <div>{t("panel.current.rev", { n: project.revision })}</div>
    </div>
  );
}

/* ------------------------------- detail ---------------------------------- */

function DetailTab({ p, n }: { p: SidePanelProps; n: NodeFull }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  // B01: switching nodes always returns to the read view.
  useEffect(() => {
    setEditing(false);
  }, [n.id]);
  const d = p.draft ?? draftOf(n);
  const set = (patch: Partial<Draft>) => p.setDraft({ ...d, ...patch });

  const missing: string[] = [];
  if (d.status === "supported" || d.status === "not_supported") {
    if (!d.scope.trim()) missing.push(t("fld.scope.gate"));
    if (!d.finding.trim()) missing.push(t("fld.finding.gate"));
    if (!d.decision.trim()) missing.push(t("fld.decision.gate"));
    if (d.evidence.length === 0) missing.push(t("fld.evidence.gate"));
  }

  const pathText = n.path.length ? n.path.map((x) => x.title).join(" / ") : t("common.first.level.node");

  return (
    <div className="body">
      <div className="pathline">
        {pathText}
        {n.archived && <span style={{ color: "var(--st-red)" }}>{t("panel.archived.paren")}</span>}
      </div>
      <h2 style={{ marginBottom: 2 }}>
        {n.title}
        <span
          className="status-pill"
          style={{
            color: STATUS_COLOR[n.status],
            marginLeft: 8,
            background: "rgba(0,0,0,0.03)",
            fontSize: 12,
          }}
        >
          {kindLabel(n.kind)} · {statusLabel(n.status)}
        </span>
      </h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        {t("detail.updated", { time: fmtTime(n.updated_at), by: n.updated_by })}
      </div>

      {p.cameFrom && (
        <div className="hint" style={{ marginBottom: 6 }}>
          {t("detail.camefrom")}
          <button style={{ marginLeft: 8 }} onClick={p.onBackToFrom}>
            {t("detail.back.to.from")}
          </button>
        </div>
      )}
      {p.dirty && (
        <div className="hint">{t("detail.dirty.hint")}</div>
      )}
      {p.draftStale && (
        <div className="hint err">
          {t("detail.stale.hint", { base: String(p.draftBaseRev), server: String(p.project?.revision) })}
          <div style={{ margin: "6px 0", display: "flex", gap: 6 }}>
            <button onClick={p.onRebaseDraft} disabled={p.conflictRevision != null}>
              {t("detail.rebase.btn")}
            </button>
          </div>
          {t("detail.stale.nosave")}
        </div>
      )}
      {p.conflictRevision != null && (
        <div className="hint err">
          {t("detail.conflict.hint", { v: String(p.conflictRevision) })}
          <div style={{ margin: "6px 0", display: "flex", gap: 6 }}>
            <button onClick={p.onRebaseDraft}>{t("detail.rebase.btn")}</button>
            <button onClick={p.onDiscardDraft}>{t("detail.discard.btn")}</button>
          </div>
          {t("detail.conflict.nosilent")}
        </div>
      )}
      {p.conflicts.length > 0 && (
        <ConflictResolver
          conflicts={p.conflicts}
          onResolve={p.onResolveConflictField}
          versionNameOf={versionNameOf(p.versions)}
        />
      )}
      {p.draftErr && <div className="hint err">{p.draftErr}</div>}

      {missing.length > 0 && (
        <div className="hint">
          {t("detail.gate.hint", { status: statusLabel(d.status), items: missing.join(t("common.list.sep")) })}
        </div>
      )}

      {editing ? (
        <NodeFieldsForm d={d} set={set} pid={p.project?.id ?? null} versions={p.versions} />
      ) : (
        <ReadView n={n} />
      )}

      <div className="savebar">
        {editing ? (
          <>
            <button
              className="primary"
              onClick={p.onSave}
              disabled={!p.dirty || !d.title.trim() || p.draftStale || p.conflicts.length > 0}
              title={
                p.conflicts.length > 0
                  ? t("detail.save.blocked.conflicts", { n: p.conflicts.length })
                  : p.draftStale
                    ? t("detail.save.blocked.stale")
                    : undefined
              }
            >
              {t("modal.common.save")}
            </button>
            <button onClick={p.onDiscardDraft} disabled={!p.dirty}>
              {t("detail.cancel.revert")}
            </button>
            <button onClick={() => setEditing(false)}>{t("detail.collapse.edit")}</button>
          </>
        ) : (
          <>
            {p.dirty && <span className="chip">{t("detail.dirty.chip")}</span>}
            <button className="primary" onClick={() => setEditing(true)}>
              {t("detail.edit")}
            </button>
            <button onClick={p.onCreateChild} disabled={n.archived}>
              {t("detail.add.child")}
            </button>
          </>
        )}
      </div>

      {p.organization && <OrganizationTab org={p.organization} node={n} />}
      {n.archived && (
        <div style={{ marginTop: 10 }} className="hint err">
          {t("detail.archived.notice")}
        </div>
      )}
    </div>
  );
}

/* ---------------------- shared node fields form (C1) ---------------------- */

/** Controlled editor for every node content field, shared by the detail tab
 *  (editing an existing node) and the canvas draft session (C2: creating a
 *  node). Purely presentational — validation, gating and save live with the
 *  caller. */
export function NodeFieldsForm({
  d,
  set,
  pid,
  versions,
}: {
  d: Draft;
  set: (patch: Partial<Draft>) => void;
  pid: string | null;
  /** E 批 §7：可选（旧调用点可不传）；传入后显示科研版本 chip 多选 */
  versions?: ResearchVersion[];
}) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewMd, setPreviewMd] = useState(false);
  // D1: 「插入表格」的行列输入（简单 prompt 状态；确认后追加 Markdown 模板）
  const [tbl, setTbl] = useState<{ rows: number; cols: number } | null>(null);
  // D3: 图片上传（插入按钮 + 粘贴）。上传即暂存（staged），随草稿保存时
  // 由提交事务翻转 attached；取消草稿则留给 30 天 GC 兜底。
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [upBusy, setUpBusy] = useState(false);
  const [upErr, setUpErr] = useState<string | null>(null);
  const uploadFile = (file: File) => {
    if (!pid || upBusy) return;
    if (!/^image\//i.test(file.type)) {
      setUpErr(t("att.upload.notimage"));
      return;
    }
    setUpBusy(true);
    setUpErr(null);
    api
      .uploadAttachment(pid, file)
      .then((att) => {
        set({ details_md: appendAttachmentRef(d.details_md, att.id, att.original_name ?? file.name) });
      })
      .catch((e: unknown) => {
        setUpErr(e instanceof ApiError ? `${t("att.upload.failed")} ${e.message}` : t("att.upload.failed"));
      })
      .finally(() => setUpBusy(false));
  };
  const onPasteMd = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const img = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      uploadFile(img);
    }
  };
  return (
    <div className="editform">
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted">{t("edit.mode.hint")}</span>
      </div>

      <label className="field">{t("edit.kindstatus")}</label>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={d.kind} onChange={(e) => set({ kind: e.target.value as NodeKind })}>
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>{kindLabel(k)}</option>
          ))}
        </select>
        <select value={d.status} onChange={(e) => set({ status: e.target.value as NodeStatus })}>
          {NODE_STATUSES.map((s) => (
            <option key={s} value={s}>{statusLabel(s)}</option>
          ))}
        </select>
      </div>

      <label className="field">{t("edit.field.title")}</label>
      <input value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.summary")}</label>
      <textarea value={d.summary} maxLength={280} onChange={(e) => set({ summary: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.rationale")}</label>
      <textarea value={d.rationale} maxLength={2000} onChange={(e) => set({ rationale: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.finding")}</label>
      <textarea value={d.finding} maxLength={2000} onChange={(e) => set({ finding: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.decision")}</label>
      <textarea value={d.decision} maxLength={2000} onChange={(e) => set({ decision: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.scope")}</label>
      <textarea value={d.scope} maxLength={1000} onChange={(e) => set({ scope: e.target.value })} style={{ width: "100%" }} />

      <label className="field">{t("edit.field.tags")}</label>
      <input
        value={d.tags.join(", ")}
        onChange={(e) =>
          set({
            tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter((t) => t && t.length <= 32).slice(0, 10),
          })
        }
        style={{ width: "100%" }}
      />

      <label className="field">{t("ver.label")}</label>
      {(!versions || versions.length === 0) ? (
        <div className="muted" data-testid="ver-none">{t("ver.none.yet")}</div>
      ) : (
        <div className="ver-chips">
          {versions.map((v) => {
            const on = d.version_ids.includes(v.id);
            // 已归档版本不再可选，但既有归属仍显示（保留 on 态），避免分配悄无声息消失
            return (
              <button
                key={v.id}
                type="button"
                className={`chip ver-chip${on ? " on" : ""}`}
                data-testid={`ver-chip-${v.id.slice(0, 8)}`}
                aria-pressed={on}
                disabled={v.archived}
                title={v.description || v.name}
                onClick={() =>
                  set({
                    version_ids: on
                      ? d.version_ids.filter((x) => x !== v.id)
                      : [...d.version_ids, v.id],
                  })
                }
              >
                {v.archived ? `${v.name}·${t("ver.archived")}` : v.name}
              </button>
            );
          })}
        </div>
      )}

      <label className="field detail-label">
        {t("edit.field.details")}
        <button
          style={{ marginLeft: 8, padding: "0 6px" }}
          onClick={() => { setDetailsOpen(!detailsOpen); setPreviewMd(false); }}
        >
          {detailsOpen ? t("common.collapse") : t("common.expand")}
        </button>
      </label>
      {detailsOpen && (
        <>
          {previewMd ? (
            <MarkdownBody md={d.details_md} />
          ) : (
            <>
            <textarea
              value={d.details_md}
              maxLength={30000}
              onChange={(e) => set({ details_md: e.target.value })}
              onPaste={onPasteMd}
              data-testid="md-editor"
              style={{ width: "100%", minHeight: 140 }}
            />
            {/* D3: 粘贴图片依赖 textarea 聚焦；隐藏 input 只吃按钮触发 */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="md-image-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadFile(f);
                e.target.value = "";
              }}
            />
            </>
          )}
          <button onClick={() => setPreviewMd(!previewMd)} style={{ marginTop: 6 }}>
            {previewMd ? t("edit.preview.back") : t("edit.preview.go")}
          </button>
          {!previewMd && (tbl ? (
            // D1: 行列内联输入（简单确认，不用 window.prompt——e2e 可达）
            <span className="md-tbl-form">
              <input
                type="number"
                min={1}
                max={12}
                aria-label={t("edit.table.rows")}
                value={tbl.rows}
                onChange={(e) => setTbl({ ...tbl, rows: clampN(e.target.value, tbl.rows) })}
                style={{ width: 56 }}
              />
              <input
                type="number"
                min={1}
                max={12}
                aria-label={t("edit.table.cols")}
                value={tbl.cols}
                onChange={(e) => setTbl({ ...tbl, cols: clampN(e.target.value, tbl.cols) })}
                style={{ width: 56 }}
              />
              <button
                data-testid="md-table-confirm"
                onClick={() => {
                  set({ details_md: appendTable(d.details_md, tbl.cols, tbl.rows) });
                  setTbl(null);
                }}
              >
                {t("common.confirm")}
              </button>
              <button onClick={() => setTbl(null)}>{t("common.cancel")}</button>
            </span>
          ) : (
            <button
              data-testid="md-table-insert"
              onClick={() => setTbl({ rows: 3, cols: 3 })}
              style={{ marginLeft: 6 }}
            >
              {t("edit.table.insert")}
            </button>
          ))}
          {!previewMd && (
            <button
              data-testid="md-image-insert"
              onClick={() => fileRef.current?.click()}
              disabled={!pid || upBusy}
              title={!pid ? t("att.upload.noproject") : undefined}
              style={{ marginLeft: 6 }}
            >
              {upBusy ? t("att.uploading") : t("att.insert")}
            </button>
          )}
          {upErr && (
            <div className="hint err" data-testid="md-upload-err" style={{ marginTop: 4 }}>
              {upErr}
            </div>
          )}
        </>
      )}

      <label className="field">{t("edit.evidence.label", { n: d.evidence.length })}</label>
      {d.evidence.map((ev, i) => (
        <Fragment key={i}>
          <div className="evid-row">
          <select
            value={ev.kind}
            onChange={(e) => {
              const evs = [...d.evidence];
              evs[i] = { ...ev, kind: e.target.value as EvidenceItem["kind"] };
              set({ evidence: evs });
            }}
          >
            <option value="inline">{t("edit.ev.inline")}</option>
            <option value="url">{t("edit.ev.url")}</option>
            <option value="path">{t("edit.ev.path")}</option>
          </select>
          <input
            placeholder="label"
            value={ev.label}
            maxLength={120}
            onChange={(e) => {
              const evs = [...d.evidence];
              evs[i] = { ...ev, label: e.target.value };
              set({ evidence: evs });
            }}
          />
          <input
            placeholder={ev.kind === "url" ? t("edit.ev.ph.url") : ev.kind === "path" ? t("edit.ev.ph.path") : t("edit.ev.ph.inline")}
            value={ev.value}
            maxLength={4000}
            onChange={(e) => {
              const evs = [...d.evidence];
              evs[i] = { ...ev, value: e.target.value };
              set({ evidence: evs });
            }}
          />
          <button
            className="x"
            title={t("common.delete.title")}
            disabled={d.evidence.length === 0}
            onClick={() => set({ evidence: d.evidence.filter((_, j) => j !== i) })}
          >
            ✕
          </button>
        </div>
        <input
          className="evid-note"
          placeholder={t("edit.ev.note.ph")}
          maxLength={500}
          value={ev.note}
          onChange={(e) => {
            const evs = [...d.evidence];
            evs[i] = { ...ev, note: e.target.value };
            set({ evidence: evs });
          }}
        />
        </Fragment>
      ))}
      {d.evidence.length < 20 && (
        <button
          onClick={() =>
            set({ evidence: [...d.evidence, { kind: "inline", label: "", value: "", note: "" }] })
          }
        >
          {t("edit.ev.add")}
        </button>
      )}
    </div>
  );
}

/* --------------------- node-create draft view (C2/C3) --------------------- */

/** C2: side-panel half of the draft session — the full field set for an
 *  unsaved node. The canvas draft card (C3) binds the same session for
 *  title/kind/status/short summary. */
function CreateDraftTab({
  draft,
  pid,
  versions,
}: {
  draft: NonNullable<SidePanelProps["createDraft"]>;
  pid: string | null;
  versions: ResearchVersion[];
}) {
  const t = useT();
  const d = draft.fields;
  const set = (patch: Partial<Draft>) => draft.onFields({ ...d, ...patch });
  const missing: string[] = [];
  if (d.status === "supported" || d.status === "not_supported") {
    if (!d.scope.trim()) missing.push(t("fld.scope.gate"));
    if (!d.finding.trim()) missing.push(t("fld.finding.gate"));
    if (!d.decision.trim()) missing.push(t("fld.decision.gate"));
    if (d.evidence.filter((e) => e.label.trim() || e.value.trim()).length === 0)
      missing.push(t("fld.evidence.gate"));
  }
  // A06 客户端闸口：红/绿状态下缺要项时禁用创建（与服务端 _check_confirmed
  // 同一闸口，与旧弹窗行为一致——点击前拦住，而不是等服务端 422）。
  const blocked =
    !d.title.trim() || draft.busy || (missing.length > 0 && (d.status === "supported" || d.status === "not_supported"));
  return (
    <div className="body">
      <div className="pathline" data-testid="draft-pathline">
        {draft.parentId ? (
          <>
            {t("ws.draft.under.parent")} {draft.parentLabel}
          </>
        ) : (
          t("ws.draft.parent.root")
        )}
      </div>
      <h2 style={{ marginBottom: 2 }} data-testid="draft-heading">
        {t("ws.draft.heading")}
        <span className="chip" style={{ marginLeft: 8 }}>{t("ws.draft.unsaved")}</span>
      </h2>
      {draft.err && <div className="hint err">{draft.err}</div>}
      {missing.length > 0 && (
        <div className="hint">
          {t("detail.gate.hint", { status: statusLabel(d.status), items: missing.join(t("common.list.sep")) })}
        </div>
      )}
      <NodeFieldsForm d={d} set={set} pid={pid} versions={versions} />
      <div className="savebar">
        <button className="primary" onClick={draft.onSave} disabled={blocked} data-testid="draft-save">
          {draft.busy ? t("modal.creating") : t("modal.create")}
        </button>
        <button onClick={draft.onCancel} disabled={draft.busy}>
          {t("detail.cancel.revert")}
        </button>
      </div>
    </div>
  );
}

/* ------------------------- conflict resolution (R02) ------------------------ */

/** A02/R02: per-field three-way comparison. Shows what the field looked like
 *  when you started editing (读取时), what you typed, and what the other actor
 *  committed — then lets you pick. Until every row is resolved the save button
 *  stays disabled, so an overlapping edit can never be submitted unreviewed. */
function ConflictResolver({
  conflicts,
  onResolve,
  versionNameOf,
}: {
  conflicts: DraftConflict[];
  onResolve: (field: keyof Draft, choice: "local" | "server" | "manual") => void;
  versionNameOf?: (id: string) => string | null;
}) {
  const t = useT();
  return (
    <div className="hint err conflict-box">
      <div>
        {t("conflict.intro", { n: conflicts.length })}
      </div>
      {conflicts.map((c) => (
        <div key={c.field} className="conflict-field">
          <div className="conflict-name">{c.label}</div>
          <div className="conflict-col">
            <span className="conflict-tag">{t("conflict.tag.base")}</span>
            <pre>{formatDraftValue(c.field, c.base, versionNameOf)}</pre>
          </div>
          <div className="conflict-col">
            <span className="conflict-tag">{t("conflict.tag.local")}</span>
            <pre>{formatDraftValue(c.field, c.local, versionNameOf)}</pre>
          </div>
          <div className="conflict-col">
            <span className="conflict-tag">{t("conflict.tag.server")}</span>
            <pre>{formatDraftValue(c.field, c.server, versionNameOf)}</pre>
          </div>
          <div className="conflict-actions">
            <button onClick={() => onResolve(c.field, "local")}>{t("conflict.keep.mine")}</button>
            <button onClick={() => onResolve(c.field, "server")}>{t("conflict.use.server")}</button>
            <button onClick={() => onResolve(c.field, "manual")}>{t("conflict.manual")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- read view (B01) ---------------------------- */

function ReadView({ n }: { n: NodeFull }) {
  const t = useT();
  const [detailsOpen, setDetailsOpen] = useState(n.details_md.trim().length > 0);
  const sections: [string, string][] = [
    [t("read.sec.summary"), n.summary],
    [t("read.sec.rationale"), n.rationale],
    [t("read.sec.finding"), n.finding],
    [t("read.sec.decision"), n.decision],
    [t("read.sec.scope"), n.scope],
  ].filter(([, v]) => v && v.trim().length > 0) as [string, string][];
  return (
    <div className="readview">
      {sections.map(([label, v]) => (
        <div key={label} className="readsec">
          <div className="readsec-label">{label}</div>
          <div className="readsec-body">{v}</div>
        </div>
      ))}
      {n.tags.length > 0 && (
        <div className="readsec">
          <div className="readsec-label">{t("read.sec.tags")}</div>
          <div className="readsec-body">{n.tags.join(t("common.list.sep"))}</div>
        </div>
      )}
      {n.evidence.length > 0 && (
        <div className="readsec">
          <div className="readsec-label">{t("read.sec.evidence", { n: n.evidence.length })}</div>
          {n.evidence.map((ev, i) => (
            <EvidenceReadCard key={i} ev={ev} />
          ))}
        </div>
      )}
      {n.details_md.trim() && (
        <div className="readsec">
          <div className="readsec-label">
            {t("read.sec.details")}
            <button
              style={{ marginLeft: 8, padding: "0 6px" }}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              {detailsOpen ? t("common.collapse") : t("common.expand")}
            </button>
          </div>
          {detailsOpen && (
            <MarkdownBody md={n.details_md} />
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceReadCard({ ev }: { ev: EvidenceItem }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  // B02: url only becomes an anchor for http(s); everything else is plain text.
  const isSafeUrl = ev.kind === "url" && /^https?:\/\//i.test(ev.value.trim());
  const copy = () =>
    navigator.clipboard
      .writeText(ev.value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  return (
    <div className="evid-card">
      <div className="evhead">
        <span className="evkind">
          {ev.kind === "inline" ? t("read.ev.inline") : ev.kind === "url" ? t("read.ev.url") : t("read.ev.path")}
        </span>
        {ev.label && <b>{ev.label}</b>}
      </div>
      {ev.value && (
        <div className="evvalue">
          {isSafeUrl ? (
            <a href={ev.value} target="_blank" rel="noopener noreferrer">
              {ev.value}
            </a>
          ) : (
            <span className="evtext">{ev.value}</span>
          )}
          {!isSafeUrl && (
            <button className="evcopy" onClick={copy} title={t("read.ev.copy.title")}>
              {copied ? t("read.ev.copied") : t("read.ev.copy")}
            </button>
          )}
        </div>
      )}
      {ev.note && <div className="evnote muted">{t("read.ev.note", { note: ev.note })}</div>}
    </div>
  );
}

/* ------------------------------ organization ------------------------------ */

function OrganizationTab({ org, node }: { org: NonNullable<SidePanelProps["organization"]>; node: NodeFull }) {
  const t = useT();
  const [parent, setParent] = useState<string | null>(org.currentParent);
  useEffect(() => setParent(org.currentParent), [org.currentParent]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReasonLocal] = useState("");
  const [showRestoreNode, setShowRestoreNode] = useState(false);
  const [restoreNodeReason, setRestoreNodeReason] = useState("");
  const isLeaf = node.child_count === 0;

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="field" style={{ margin: 0, marginBottom: 6 }}>{t("org.title")}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={org.onMoveUp} disabled={!org.canUp}>{t("org.move.up")}</button>
        <button onClick={org.onMoveDown} disabled={!org.canDown}>{t("org.move.down")}</button>
        <select
          value={parent ?? ""}
          onChange={(e) => setParent(e.target.value === "" ? null : e.target.value)}
          style={{ maxWidth: 220 }}
        >
          {org.parentOptions.map((o) => (
            <option key={o.id ?? "top"} value={o.id ?? ""}>{o.label}</option>
          ))}
        </select>
        <button
          disabled={parent === org.currentParent}
          onClick={() => org.onMove(parent)}
        >
          {t("org.move.btn")}
        </button>
      </div>
      {!node.archived && (
        <div style={{ marginTop: 8 }}>
          {!showArchive ? (
            <button
              className="danger"
              disabled={!isLeaf}
              title={isLeaf ? "" : t("org.archive.leafonly.title")}
              onClick={() => setShowArchive(true)}
            >
              {t("org.archive.btn")}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder={t("org.archive.reason.ph")}
                value={archiveReason}
                onChange={(e) => setArchiveReasonLocal(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <button
                className="danger"
                disabled={!archiveReason.trim()}
                onClick={() => { org.onArchive(archiveReason.trim()); setShowArchive(false); setArchiveReasonLocal(""); }}
              >
                {t("org.archive.confirm")}
              </button>
              <button onClick={() => setShowArchive(false)}>{t("common.cancel")}</button>
            </div>
          )}
          {!isLeaf && <div className="muted" style={{ marginTop: 4 }}>{t("org.archive.blocked")}</div>}
        </div>
      )}
      {/* B04: the inverse of archive. Node archiving is only reversible from the
          UI at all because the canvas can show archived nodes — otherwise an
          archived node has no reachable entry point (R09/B04 note). */}
      {node.archived && (
        <div style={{ marginTop: 8 }}>
          {!showRestoreNode ? (
            <button className="primary" onClick={() => setShowRestoreNode(true)}>
              {t("org.restore.btn")}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder={t("org.restore.reason.ph")}
                value={restoreNodeReason}
                onChange={(e) => setRestoreNodeReason(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <button
                className="primary"
                disabled={!restoreNodeReason.trim()}
                onClick={() => {
                  org.onRestore(restoreNodeReason.trim());
                  setShowRestoreNode(false);
                  setRestoreNodeReason("");
                }}
              >
                {t("org.restore.confirm")}
              </button>
              <button onClick={() => setShowRestoreNode(false)}>{t("common.cancel")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- relations -------------------------------- */

function RelationsTab({ p, n }: { p: SidePanelProps; n: NodeFull }) {
  const t = useT();
  return (
    <div className="body">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="muted">{t("rel.count", { n: n.relation_count })}</div>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={p.includeArchived} onChange={(e) => p.setIncludeArchived(e.target.checked)} />
          {t("rel.show.archived")}
        </label>
      </div>
      {p.cameFrom && (
        <div className="hint" style={{ marginBottom: 8 }}>
          {t("detail.camefrom")}
          <button style={{ marginLeft: 8 }} onClick={p.onBackToFrom}>
            {t("detail.back.to.from")}
          </button>
        </div>
      )}
      <button className="primary" onClick={p.onCreateRelation} style={{ marginBottom: 6 }}>
        {t("rel.create.btn")}
      </button>

      {p.relations.length === 0 && <div className="empty">{t("rel.empty")}</div>}
      {p.relations.map((r) => (
        <RelationItemView key={r.id} r={r} p={p} />
      ))}
      {p.relHasMore && p.relCursor && (
        <div className="pager">
          <button onClick={() => p.onRelPage(p.relCursor, true)}>
            {t("rel.loadmore")}
          </button>
        </div>
      )}
      {p.selectedRelationId && (
        <div className="muted" style={{ marginTop: 10 }}>
          {t("rel.canvas.hint", { max: MAX_CANVAS_RELATION })}
        </div>
      )}
    </div>
  );
}

function RelationItemView({ r, p }: { r: RelationItem; p: SidePanelProps }) {
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<RelationKind>(r.kind);
  const [reason, setReason] = useState(r.reason);
  const [showArchive, setShowArchive] = useState(false);
  const [archReason, setArchReason] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [restReason, setRestReason] = useState("");
  const t = useT();

  const otherPath = r.other.path.length ? r.other.path.map((x) => x.title).join(" / ") : t("common.first.level.node");

  const arrow = r.direction === "outgoing" ? "→" : "←";
  const clickLocate = () => {
    if (r.other.archived) return;
    p.onLocate(r.other.id, p.node?.id);
  };

  return (
    <div className={`rel-item ${p.selectedRelationId === r.id ? "selected" : ""}`}>
      <div
        className="rtitle"
        onClick={() => p.onPickRelation(p.selectedRelationId === r.id ? null : r.id)}
        title={t("rel.item.pick.title")}
      >
        <span style={{ opacity: 0.65 }}>{arrow}</span> {relationLabel(r, p.node?.title ?? "")}
        {r.archived && <span className="arch">{t("panel.archived.paren")}</span>}
      </div>
      <div className="rpath">{otherPath}{r.other.archived ? t("rel.item.other.archived") : ""}</div>
      <div className="muted" style={{ marginTop: 2 }}>{r.reason}</div>
      <div className="row">
        {!r.other.archived && (
          <button onClick={clickLocate}>{t("rel.locate")}</button>
        )}
        {!r.archived && !editing && (
          <button onClick={() => setEditing(true)}>{t("detail.edit")}</button>
        )}
        {!r.archived && !showArchive && (
          <button className="danger" onClick={() => setShowArchive(true)}>{t("rel.archive.btn")}</button>
        )}
        {r.archived && !showRestore && (
          <button onClick={() => setShowRestore(true)}>{t("rel.restore.btn")}</button>
        )}
      </div>

      {editing && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>{relationKindLabel(k)}</option>
              ))}
            </select>
            <input value={reason} maxLength={500} style={{ flex: 1 }} placeholder={t("rel.edit.reason.ph")} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="primary"
              disabled={!reason.trim() || (kind === r.kind && reason === r.reason)}
              onClick={() => { p.onEditRelation(r, { kind, reason: reason.trim() }); setEditing(false); }}
            >
              {t("rel.edit.save")}
            </button>
            <button onClick={() => setEditing(false)}>{t("common.cancel")}</button>
          </div>
        </div>
      )}
      {!r.archived && showArchive && (
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <input placeholder={t("rel.archive.reason.ph")} value={archReason} maxLength={500} onChange={(e) => setArchReason(e.target.value)} />
          <button
            className="danger"
            disabled={!archReason.trim()}
            onClick={() => { p.onArchiveRelation(r, archReason.trim()); setShowArchive(false); setArchReason(""); }}
          >
            {t("common.confirm")}
          </button>
          <button onClick={() => setShowArchive(false)}>{t("common.cancel")}</button>
        </div>
      )}
      {r.archived && showRestore && (
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <input placeholder={t("rel.restore.reason.ph")} value={restReason} maxLength={500} onChange={(e) => setRestReason(e.target.value)} />
          <button
            disabled={!restReason.trim()}
            onClick={() => { p.onRestoreRelation(r, restReason.trim()); setShowRestore(false); setRestReason(""); }}
          >
            {t("rel.restore.confirm")}
          </button>
          <button onClick={() => setShowRestore(false)}>{t("common.cancel")}</button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- history --------------------------------- */

function HistoryTab({ n, history }: { n: NodeFull; history: SidePanelProps["history"] }) {
  const t = useT();
  const d = history.detail;
  const entry = d?.changes.find((c) => c.object_id === n.id) ?? null;
  return (
    <div className="body">
      <div className="muted" style={{ marginBottom: 8 }}>
        {t("hist.intro")}
      </div>
      {history.commits.length === 0 && <div className="empty">{t("hist.empty")}</div>}
      {history.commits.map((c) => (
        <div
          className="hist-item"
          key={c.id}
          style={{ cursor: "pointer" }}
          onClick={() => history.onSelect(c)}
        >
          <div className="hsum">
            v{c.revision} · {c.summary}
          </div>
          <div className="muted">
            {fmtTime(c.created_at)} · {c.actor}
            {c.client_label ? t("hist.client.paren", { label: c.client_label }) : ""}
          </div>
        </div>
      ))}
      {/* B04: paged history — every page is loadable, nothing is silently dropped */}
      {history.hasMore && (
        <div className="pager">
          <button onClick={() => history.onLoadMore?.()}>
            {t("hist.loadmore", { v: history.commits[history.commits.length - 1]?.revision })}
          </button>
        </div>
      )}

      {d && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            v{d.revision} · {d.summary}
          </div>
          <div className="muted" style={{ marginBottom: 6 }}>
            {fmtTime(d.created_at)} · {d.actor} · request {d.request_id.slice(0, 8)}…
          </div>
          {entry ? (
            <>
              {entry.type === "node.create" && (
                <>
                  <div className="hint ok">{t("hist.created")}</div>
                  <CreateSnapshot entry={entry} />
                </>
              )}
              {entry.type === "node.update" && (
                <div>
                  {Object.entries((entry.changed ?? {}) as Record<string, { before: unknown; after: unknown }>).map(
                    ([k, v]) => (
                      <div className="diff-row" key={k}>
                        <span className="k">{k}</span>
                        <span className="v">
                          <span className="b">{copyable(v.before)}</span> ⇒{" "}
                          <span className="a">{copyable(v.after)}</span>
                        </span>
                      </div>
                    ),
                  )}
                </div>
              )}
              {entry.type === "node.move" && <MoveLine entry={entry} titleOf={history.titleOf} />}
              {(entry.type === "node.archive" || entry.type === "node.restore") && (
                <div className="hint">{entry.type === "node.archive" ? t("hist.archived") : t("hist.restored")}</div>
              )}
            </>
          ) : (
            <div className="muted">{t("hist.notouch")}</div>
          )}
          <button
            style={{ marginTop: 8 }}
            onClick={() => navigator.clipboard.writeText(JSON.stringify(d, null, 2))}
          >
            {t("hist.copy.json")}
          </button>
        </div>
      )}
    </div>
  );
}

function CreateSnapshot({ entry }: { entry: ChangeEntry }) {
  const t = useT();
  // B04: node.create entries must show the created snapshot (the `after`
  // object), not just "the node was created".
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const all: [string, string][] = [
    [t("fld.title"), s(after.title)],
    [t("fld.kind"), after.kind ? kindLabel(after.kind as NodeKind) ?? s(after.kind) : ""],
    [t("fld.status"), after.status ? statusLabel(after.status as NodeStatus) ?? s(after.status) : ""],
    [t("fld.summary"), s(after.summary)],
    [t("fld.scope"), s(after.scope)],
    [t("snap.finding"), s(after.finding)],
  ];
  const rows = all.filter(([, v]) => v);
  if (rows.length === 0) return <div className="muted">{t("snap.empty")}</div>;
  return (
    <div className="snap">
      {rows.map(([k, v]) => (
        <div className="diff-row" key={k}>
          <span className="k">{k}</span>
          <span className="v a">{copyable(v)}</span>
        </div>
      ))}
    </div>
  );
}

function MoveLine({ entry, titleOf }: { entry: ChangeEntry; titleOf?: (id: string) => string | null }) {
  const t = useT();
  // B04: the backend stores node.move as before/after OBJECTS
  // ({parent_id, order_index}); legacy string fields are tolerated too.
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const parentOf = (o: Record<string, unknown>, legacyKey: string): string | null => {
    if (typeof o.parent_id === "string" && o.parent_id) return o.parent_id;
    const legacy = entry[legacyKey];
    return typeof legacy === "string" && legacy ? legacy : null;
  };
  const bPid = parentOf(before, "before_parent");
  const aPid = parentOf(after, "after_parent");
  const idx = (o: Record<string, unknown>): number | null =>
    typeof o.order_index === "number" ? (o.order_index as number) : null;
  const label = (id: string | null): string =>
    id == null ? t("hist.top.level") : titleOf?.(id) ?? `${id.slice(0, 8)}…`;
  const bi = idx(before);
  const ai = idx(after);
  return (
    <div className="hint ok">
      {t("hist.move", { before: label(bPid), after: label(aPid) })}
      {bi != null || ai != null ? t("hist.move.order", { before: bi ?? "—", after: ai ?? "—" }) : ""}
    </div>
  );
}

/* ---- D1: Markdown 表格模板 ---- */

const clampN = (raw: string, fallback: number): number => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(12, Math.max(1, n));
};

/** 追加一个 GFM 表格模板到 details_md 末尾（列数 cols、数据行 rows，含表头）。 */
export function appendTable(md: string, cols: number, rows: number): string {
  const c = Math.min(12, Math.max(1, cols));
  const r = Math.min(12, Math.max(1, rows));
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out: string[] = [];
  out.push("");
  out.push(line(Array.from({ length: c }, (_, i) => `列${i + 1}`)));
  out.push(line(Array.from({ length: c }, () => " --- ")));
  for (let i = 0; i < r; i++) out.push(line(Array.from({ length: c }, () => "")));
  const base = md && !md.endsWith("\n") ? md + "\n" : md ?? "";
  return base + out.join("\n") + "\n";
}

function s(v: unknown): string {  return typeof v === "string" ? v : "";
}

function copyable(v: unknown): string {
  if (v == null) return "∅";
  if (typeof v === "string") return v || "∅";
  try {
    // B04: no truncation — long field values stay fully readable/copyable
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
