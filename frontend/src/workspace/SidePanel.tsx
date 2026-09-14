/** Right panel: node detail + edit (save/cancel), relations list with
 *  pagination, node history with before/after (SPEC 3.2 / 3.3 / 3.5). */

import { Fragment, useEffect, useMemo, useState } from "react";
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
} from "../lib/types";
import { NODE_KINDS, NODE_STATUSES, RELATION_KINDS } from "../lib/types";
import { KIND_LABEL, RELATION_LABEL, STATUS_LABEL, fmtTime } from "../lib/format";
import { MAX_CANVAS_RELATION, relationLabel } from "../lib/relations";
import { renderMarkdown } from "../lib/markdown";
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
  };
}

/** A02/R02: Chinese labels for the three-way conflict comparison. */
export const DRAFT_FIELD_LABEL: Record<keyof Draft, string> = {
  kind: "类型",
  title: "标题",
  summary: "摘要",
  status: "状态",
  rationale: "为什么做 · 试法",
  finding: "直接观察",
  decision: "当前解释与决定",
  scope: "适用条件",
  details_md: "长说明",
  tags: "标签",
  evidence: "证据引用",
};

/** One field both you and someone else changed, with all three versions so
 *  the user can compare instead of being told "已保留你的值" after the fact. */
export type DraftConflict = FieldConflict<Draft>;

/** Human-readable rendering of any draft field for the comparison table. */
export function formatDraftValue(field: keyof Draft, v: Draft[keyof Draft]): string {
  if (field === "kind") return KIND_LABEL[v as NodeKind];
  if (field === "status") return STATUS_LABEL[v as NodeStatus];
  if (field === "tags") {
    const t = v as string[];
    return t.length ? t.join("、") : "（空）";
  }
  if (field === "evidence") {
    const e = v as EvidenceItem[];
    if (!e.length) return "（无证据）";
    return e.map((x) => `${x.kind}｜${x.label || "(无标签)"}｜${x.value}`).join("\n");
  }
  const s = String(v ?? "");
  return s.trim() ? s : "（空）";
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
  const n = p.node;
  return (
    <aside className="side">
      <div className="head">
        <div className="tabs" style={{ padding: 0, borderTop: "none", marginBottom: -12 }}>
          <button className={p.tab === "detail" ? "active" : ""} onClick={() => p.setTab("detail")}>
            详情
          </button>
          <button className={p.tab === "relations" ? "active" : ""} onClick={() => p.setTab("relations")}>
            关联
          </button>
          <button className={p.tab === "history" ? "active" : ""} onClick={() => p.setTab("history")}>
            历史
          </button>
        </div>
      </div>
      {!n && (
        <div className="body">
          <div className="empty">
            {p.loading ? "加载中…" : "选择一个节点查看详情。"}
          </div>
          <ProjectInfo project={p.project} />
        </div>
      )}
      {n && p.tab === "detail" && (
        <DetailTab p={p} n={n} />
      )}
      {n && p.tab === "relations" && <RelationsTab p={p} n={n} />}
      {n && p.tab === "history" && <HistoryTab n={n} history={p.history} />}
    </aside>
  );
}

function ProjectInfo({ project }: { project: Project | null }) {
  if (!project) return null;
  return (
    <div className="muted" style={{ marginTop: 16 }}>
      <div style={{ fontWeight: 600, color: "var(--ink)" }}>{project.name}</div>
      <div style={{ margin: "4px 0" }}>{project.objective}</div>
      <div>当前版本 v{project.revision}</div>
    </div>
  );
}

/* ------------------------------- detail ---------------------------------- */

function DetailTab({ p, n }: { p: SidePanelProps; n: NodeFull }) {
  const [editing, setEditing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewMd, setPreviewMd] = useState(false);
  // B01: switching nodes always returns to the read view.
  useEffect(() => {
    setEditing(false);
    setDetailsOpen(false);
    setPreviewMd(false);
  }, [n.id]);
  const d = p.draft ?? draftOf(n);
  const set = (patch: Partial<Draft>) => p.setDraft({ ...d, ...patch });

  const missing = useMemo(() => {
    if (d.status !== "supported" && d.status !== "not_supported") return [];
    const m: string[] = [];
    if (!d.scope.trim()) m.push("适用条件 scope");
    if (!d.finding.trim()) m.push("直接观察 finding");
    if (!d.decision.trim()) m.push("当前解释与决定 decision");
    if (d.evidence.length === 0) m.push("至少一条证据 evidence");
    return m;
  }, [d.status, d.scope, d.finding, d.decision, d.evidence]);

  const pathText = n.path.length ? n.path.map((x) => x.title).join(" / ") : "一级节点";

  return (
    <div className="body">
      <div className="pathline">
        {pathText}
        {n.archived && <span style={{ color: "var(--st-red)" }}>（已归档）</span>}
      </div>
      <h2 style={{ marginBottom: 2 }}>
        {n.title}
        <span
          className="status-pill"
          style={{
            color: "var(--st-red)",
            marginLeft: 8,
            background: "rgba(0,0,0,0.03)",
            fontSize: 12,
          }}
        >
          {KIND_LABEL[n.kind]} · {STATUS_LABEL[n.status]}
        </span>
      </h2>
      <div className="muted" style={{ marginBottom: 8 }}>
        更新于 {fmtTime(n.updated_at)} · 作者 {n.updated_by}
      </div>

      {p.cameFrom && (
        <div className="hint" style={{ marginBottom: 6 }}>
          你从关联目标定位过来。
          <button style={{ marginLeft: 8 }} onClick={p.onBackToFrom}>
            返回来源节点
          </button>
        </div>
      )}
      {p.dirty && (
        <div className="hint">有未保存的修改。切换节点或关闭面板会提醒；服务器版本变化不会覆盖草稿。</div>
      )}
      {p.draftStale && (
        <div className="hint err">
          本地草稿基于 v{p.draftBaseRev}，服务器已推进到 v{p.project?.revision}（期间有他人的提交）。
          <div style={{ margin: "6px 0", display: "flex", gap: 6 }}>
            <button onClick={p.onRebaseDraft} disabled={p.conflictRevision != null}>
              载入新版并重排草稿
            </button>
          </div>
          重排前不能保存，避免静默覆盖他人修改。
        </div>
      )}
      {p.conflictRevision != null && (
        <div className="hint err">
          提交时发生版本冲突：服务器已更新到 v{p.conflictRevision}，你的草稿仍完整保留。
          <div style={{ margin: "6px 0", display: "flex", gap: 6 }}>
            <button onClick={p.onRebaseDraft}>载入新版并重排草稿</button>
            <button onClick={p.onDiscardDraft}>放弃草稿</button>
          </div>
          不会静默以你的旧版本覆盖他人修改。
        </div>
      )}
      {p.conflicts.length > 0 && (
        <ConflictResolver conflicts={p.conflicts} onResolve={p.onResolveConflictField} />
      )}
      {p.draftErr && <div className="hint err">{p.draftErr}</div>}

      {missing.length > 0 && (
        <div className="hint">
          状态为“{STATUS_LABEL[d.status]}”要求填写：{missing.join("、")}。这只是记录完整性要求，不是自动科学审查。
        </div>
      )}

      {editing ? (
        <div className="editform">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="muted">编辑模式 —— 只提交你改动的字段</span>
          </div>

          <label className="field">类型 / 状态</label>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={d.kind} onChange={(e) => set({ kind: e.target.value as NodeKind })}>
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
        <select value={d.status} onChange={(e) => set({ status: e.target.value as NodeStatus })}>
          {NODE_STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
      </div>

      <label className="field">标题（1–80 字符）</label>
      <input value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} style={{ width: "100%" }} />

      <label className="field">摘要：一句话研究增量（0–280）</label>
      <textarea value={d.summary} maxLength={280} onChange={(e) => set({ summary: e.target.value })} style={{ width: "100%" }} />

      <label className="field">为什么做，试法是什么 rationale（0–2000）</label>
      <textarea value={d.rationale} maxLength={2000} onChange={(e) => set({ rationale: e.target.value })} style={{ width: "100%" }} />

      <label className="field">直接观察到了什么 finding（0–2000，未确认写未知）</label>
      <textarea value={d.finding} maxLength={2000} onChange={(e) => set({ finding: e.target.value })} style={{ width: "100%" }} />

      <label className="field">当前解释与下一步决定 decision（0–2000）</label>
      <textarea value={d.decision} maxLength={2000} onChange={(e) => set({ decision: e.target.value })} style={{ width: "100%" }} />

      <label className="field">适用条件 scope（0–1000，红/绿状态必填）</label>
      <textarea value={d.scope} maxLength={1000} onChange={(e) => set({ scope: e.target.value })} style={{ width: "100%" }} />

      <label className="field">标签（逗号分隔，每个 1–32 字符，最多 10 个）</label>
      <input
        value={d.tags.join(", ")}
        onChange={(e) =>
          set({
            tags: e.target.value.split(/[,，]/).map((t) => t.trim()).filter((t) => t && t.length <= 32).slice(0, 10),
          })
        }
        style={{ width: "100%" }}
      />

      <label className="field detail-label">
        长说明 details_md（Markdown，0–30000）
        <button
          style={{ marginLeft: 8, padding: "0 6px" }}
          onClick={() => { setDetailsOpen(!detailsOpen); setPreviewMd(false); }}
        >
          {detailsOpen ? "收起" : "展开"}
        </button>
      </label>
      {detailsOpen && (
        <>
          {previewMd ? (
            <div
              className="md-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(d.details_md) }}
            />
          ) : (
            <textarea
              value={d.details_md}
              maxLength={30000}
              onChange={(e) => set({ details_md: e.target.value })}
              style={{ width: "100%", minHeight: 140 }}
            />
          )}
          <button onClick={() => setPreviewMd(!previewMd)} style={{ marginTop: 6 }}>
            {previewMd ? "返回编辑（Markdown 渲染已禁用原始 HTML/脚本/外链图片）" : "预览渲染"}
          </button>
        </>
      )}

      <label className="field">证据引用（{d.evidence.length}/20）——只登记定位，系统不抓取、不执行、不代理读取</label>
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
            <option value="inline">inline 说明</option>
            <option value="url">url 链接</option>
            <option value="path">path 路径</option>
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
            placeholder={ev.kind === "url" ? "http(s)://…" : ev.kind === "path" ? "服务器/本机报告路径" : "一小段原始观察或说明"}
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
            title="删除"
            disabled={d.evidence.length === 0}
            onClick={() => set({ evidence: d.evidence.filter((_, j) => j !== i) })}
          >
            ✕
          </button>
        </div>
        <input
          className="evid-note"
          placeholder="note：限定语 / 可信度说明（如：样本少，不普适）"
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
          + 添加证据
        </button>
      )}
        </div>
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
                  ? `还有 ${p.conflicts.length} 个冲突字段未处理：先在上方逐项选择`
                  : p.draftStale
                    ? "草稿基于旧版本：先点「载入新版并重排草稿」"
                    : undefined
              }
            >
              保存
            </button>
            <button onClick={p.onDiscardDraft} disabled={!p.dirty}>
              取消（恢复原值）
            </button>
            <button onClick={() => setEditing(false)}>收起编辑</button>
          </>
        ) : (
          <>
            {p.dirty && <span className="chip">有未保存的修改</span>}
            <button className="primary" onClick={() => setEditing(true)}>
              编辑
            </button>
          </>
        )}
      </div>

      {p.organization && <OrganizationTab org={p.organization} node={n} />}
      {n.archived && (
        <div style={{ marginTop: 10 }} className="hint err">
          本节点已归档。恢复后相关 relations 才会重新渲染。
        </div>
      )}
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
}: {
  conflicts: DraftConflict[];
  onResolve: (field: keyof Draft, choice: "local" | "server" | "manual") => void;
}) {
  return (
    <div className="hint err conflict-box">
      <div>
        以下 {conflicts.length} 个字段你与他人同时修改，已保留你的值。请逐项对比后选择，
        全部处理完才能保存——不会静默按任何一方覆盖。
      </div>
      {conflicts.map((c) => (
        <div key={c.field} className="conflict-field">
          <div className="conflict-name">{c.label}</div>
          <div className="conflict-col">
            <span className="conflict-tag">读取时（共同起点）</span>
            <pre>{formatDraftValue(c.field, c.base)}</pre>
          </div>
          <div className="conflict-col">
            <span className="conflict-tag">你的草稿</span>
            <pre>{formatDraftValue(c.field, c.local)}</pre>
          </div>
          <div className="conflict-col">
            <span className="conflict-tag">服务器（他人已提交）</span>
            <pre>{formatDraftValue(c.field, c.server)}</pre>
          </div>
          <div className="conflict-actions">
            <button onClick={() => onResolve(c.field, "local")}>保留我的</button>
            <button onClick={() => onResolve(c.field, "server")}>采用服务器</button>
            <button onClick={() => onResolve(c.field, "manual")}>我自己合并</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------- read view (B01) ---------------------------- */

function ReadView({ n }: { n: NodeFull }) {
  const [detailsOpen, setDetailsOpen] = useState(n.details_md.trim().length > 0);
  const sections: [string, string][] = [
    ["摘要 summary", n.summary],
    ["为什么做 · 试法 rationale", n.rationale],
    ["直接观察 finding", n.finding],
    ["当前解释与决定 decision", n.decision],
    ["适用条件 scope", n.scope],
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
          <div className="readsec-label">标签 tags</div>
          <div className="readsec-body">{n.tags.join("、")}</div>
        </div>
      )}
      {n.evidence.length > 0 && (
        <div className="readsec">
          <div className="readsec-label">证据引用 evidence（{n.evidence.length}/20）</div>
          {n.evidence.map((ev, i) => (
            <EvidenceReadCard key={i} ev={ev} />
          ))}
        </div>
      )}
      {n.details_md.trim() && (
        <div className="readsec">
          <div className="readsec-label">
            长说明 details_md（Markdown）
            <button
              style={{ marginLeft: 8, padding: "0 6px" }}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              {detailsOpen ? "收起" : "展开"}
            </button>
          </div>
          {detailsOpen && (
            <div
              className="md-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(n.details_md) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EvidenceReadCard({ ev }: { ev: EvidenceItem }) {
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
          {ev.kind === "inline" ? "行内记录" : ev.kind === "url" ? "url 链接" : "path 路径"}
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
            <button className="evcopy" onClick={copy} title="复制内容">
              {copied ? "已复制 ✓" : "复制"}
            </button>
          )}
        </div>
      )}
      {ev.note && <div className="evnote muted">note：{ev.note}</div>}
    </div>
  );
}

/* ------------------------------ organization ------------------------------ */

function OrganizationTab({ org, node }: { org: NonNullable<SidePanelProps["organization"]>; node: NodeFull }) {
  const [parent, setParent] = useState<string | null>(org.currentParent);
  useEffect(() => setParent(org.currentParent), [org.currentParent]);
  const [showArchive, setShowArchive] = useState(false);
  const [archiveReason, setArchiveReasonLocal] = useState("");
  const isLeaf = node.child_count === 0;

  return (
    <div style={{ marginTop: 18, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <div className="field" style={{ margin: 0, marginBottom: 6 }}>组织与移动</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={org.onMoveUp} disabled={!org.canUp}>↑ 上移</button>
        <button onClick={org.onMoveDown} disabled={!org.canDown}>↓ 下移</button>
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
          移动归属
        </button>
      </div>
      {!node.archived && (
        <div style={{ marginTop: 8 }}>
          {!showArchive ? (
            <button
              className="danger"
              disabled={!isLeaf}
              title={isLeaf ? "" : "只能归档没有子节点的叶子节点"}
              onClick={() => setShowArchive(true)}
            >
              归档此节点（仅叶子）
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input
                placeholder="归档原因（必填）"
                value={archiveReason}
                onChange={(e) => setArchiveReasonLocal(e.target.value)}
                style={{ maxWidth: 260 }}
              />
              <button
                className="danger"
                disabled={!archiveReason.trim()}
                onClick={() => { org.onArchive(archiveReason.trim()); setShowArchive(false); setArchiveReasonLocal(""); }}
              >
                确认归档
              </button>
              <button onClick={() => setShowArchive(false)}>取消</button>
            </div>
          )}
          {!isLeaf && <div className="muted" style={{ marginTop: 4 }}>当前有子节点：请先移动或处理子节点，系统禁止级联删除。</div>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- relations -------------------------------- */

function RelationsTab({ p, n }: { p: SidePanelProps; n: NodeFull }) {
  return (
    <div className="body">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div className="muted">共 {n.relation_count} 条活跃关联</div>
        <label style={{ fontSize: 12 }}>
          <input type="checkbox" checked={p.includeArchived} onChange={(e) => p.setIncludeArchived(e.target.checked)} />
          显示已归档
        </label>
      </div>
      {p.cameFrom && (
        <div className="hint" style={{ marginBottom: 8 }}>
          你从关联目标定位过来。
          <button style={{ marginLeft: 8 }} onClick={p.onBackToFrom}>
            返回来源节点
          </button>
        </div>
      )}
      <button className="primary" onClick={p.onCreateRelation} style={{ marginBottom: 6 }}>
        + 新增关联（选择目标 → 类型 → 一句原因）
      </button>

      {p.relations.length === 0 && <div className="empty">该节点暂无直接关联。</div>}
      {p.relations.map((r) => (
        <RelationItemView key={r.id} r={r} p={p} />
      ))}
      {p.relHasMore && p.relCursor && (
        <div className="pager">
          <button onClick={() => p.onRelPage(p.relCursor, true)}>
            加载下一页（分页每页 20 条，完整可访问）
          </button>
        </div>
      )}
      {p.selectedRelationId && (
        <div className="muted" style={{ marginTop: 10 }}>
          提示：点击画布虚线或上方条目可单独查看该关系；画布最多显示 {MAX_CANVAS_RELATION} 条，超出部分在本列表可访问。
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

  const otherPath = r.other.path.length ? r.other.path.map((x) => x.title).join(" / ") : "一级节点";

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
        title="点我：在画布上单独显示这条关系线"
      >
        <span style={{ opacity: 0.65 }}>{arrow}</span> {relationLabel(r, p.node?.title ?? "")}
        {r.archived && <span className="arch">（已归档）</span>}
      </div>
      <div className="rpath">{otherPath}{r.other.archived ? "（节点已归档）" : ""}</div>
      <div className="muted" style={{ marginTop: 2 }}>{r.reason}</div>
      <div className="row">
        {!r.other.archived && (
          <button onClick={clickLocate}>定位</button>
        )}
        {!r.archived && !editing && (
          <button onClick={() => setEditing(true)}>编辑</button>
        )}
        {!r.archived && !showArchive && (
          <button className="danger" onClick={() => setShowArchive(true)}>归档关系</button>
        )}
        {r.archived && !showRestore && (
          <button onClick={() => setShowRestore(true)}>恢复关系</button>
        )}
      </div>

      {editing && (
        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <select value={kind} onChange={(e) => setKind(e.target.value as RelationKind)}>
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>{RELATION_LABEL[k]}</option>
              ))}
            </select>
            <input value={reason} maxLength={500} style={{ flex: 1 }} placeholder="一句原因（1–500）" onChange={(e) => setReason(e.target.value)} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="primary"
              disabled={!reason.trim() || (kind === r.kind && reason === r.reason)}
              onClick={() => { p.onEditRelation(r, { kind, reason: reason.trim() }); setEditing(false); }}
            >
              保存修改
            </button>
            <button onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      )}
      {!r.archived && showArchive && (
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <input placeholder="归档原因" value={archReason} maxLength={500} onChange={(e) => setArchReason(e.target.value)} />
          <button
            className="danger"
            disabled={!archReason.trim()}
            onClick={() => { p.onArchiveRelation(r, archReason.trim()); setShowArchive(false); setArchReason(""); }}
          >
            确认
          </button>
          <button onClick={() => setShowArchive(false)}>取消</button>
        </div>
      )}
      {r.archived && showRestore && (
        <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
          <input placeholder="恢复原因" value={restReason} maxLength={500} onChange={(e) => setRestReason(e.target.value)} />
          <button
            disabled={!restReason.trim()}
            onClick={() => { p.onRestoreRelation(r, restReason.trim()); setShowRestore(false); setRestReason(""); }}
          >
            确认恢复（需两端未归档）
          </button>
          <button onClick={() => setShowRestore(false)}>取消</button>
        </div>
      )}
    </div>
  );
}

/* -------------------------------- history --------------------------------- */

function HistoryTab({ n, history }: { n: NodeFull; history: SidePanelProps["history"] }) {
  const d = history.detail;
  const entry = d?.changes.find((c) => c.object_id === n.id) ?? null;
  return (
    <div className="body">
      <div className="muted" style={{ marginBottom: 8 }}>
        本节点的提交历史（含 other node 创建/移动等其他提交）。历史只记录不抹除；纠错请用新的提交。
      </div>
      {history.commits.length === 0 && <div className="empty">该节点暂无历史提交。</div>}
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
            {c.client_label ? `（${c.client_label}）` : ""}
          </div>
        </div>
      ))}
      {/* B04: paged history — every page is loadable, nothing is silently dropped */}
      {history.hasMore && (
        <div className="pager">
          <button onClick={() => history.onLoadMore?.()}>
            加载更多（每页 20 条，最早 v{history.commits[history.commits.length - 1]?.revision} 之前）
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
                  <div className="hint ok">本提交创建了该节点。原始快照：</div>
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
                <div className="hint">{entry.type === "node.archive" ? "本提交归档了该节点。" : "本提交恢复了该节点。"}</div>
              )}
            </>
          ) : (
            <div className="muted">该提交不涉及本节点字段（可能是关系或顺序调整）。</div>
          )}
          <button
            style={{ marginTop: 8 }}
            onClick={() => navigator.clipboard.writeText(JSON.stringify(d, null, 2))}
          >
            复制本次提交的 JSON
          </button>
        </div>
      )}
    </div>
  );
}

function CreateSnapshot({ entry }: { entry: ChangeEntry }) {
  // B04: node.create entries must show the created snapshot (the `after`
  // object), not just "the node was created".
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const all: [string, string][] = [
    ["标题", s(after.title)],
    ["类型", after.kind ? KIND_LABEL[after.kind as NodeKind] ?? s(after.kind) : ""],
    ["状态", after.status ? STATUS_LABEL[after.status as NodeStatus] ?? s(after.status) : ""],
    ["摘要", s(after.summary)],
    ["适用条件", s(after.scope)],
    ["观察", s(after.finding)],
  ];
  const rows = all.filter(([, v]) => v);
  if (rows.length === 0) return <div className="muted">（快照字段缺失）</div>;
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
    id == null ? "（一级）" : titleOf?.(id) ?? `${id.slice(0, 8)}…`;
  const bi = idx(before);
  const ai = idx(after);
  return (
    <div className="hint ok">
      位置变更：父级 {label(bPid)} ⇒ {label(aPid)}
      {bi != null || ai != null ? ` · 同级序号 ${bi ?? "—"} ⇒ ${ai ?? "—"}` : ""}
    </div>
  );
}

function s(v: unknown): string {
  return typeof v === "string" ? v : "";
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