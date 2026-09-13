/** Workspace: all app state, commit pipeline, polling, marks, modals.
 *
 *  Browser writes go through the same backend commit path AI tools use
 *  (SPEC 6); this file only composes single/ multi-op requests and never
 *  writes straight to storage.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { uuidv4 } from "../lib/api";
import {
  ApiError,
  type CommitItem,
  type CommitOp,
  type CommitResponse,
  type GraphNode,
  type NodeFull,
  type NodeKind,
  type Project,
  type RelationItem,
  type RelationKind,
  type SearchItem,
} from "../lib/types";
import { STATUS_LABEL } from "../lib/format";
import { replaceDeepLink } from "../lib/deeplink";
import Canvas, { loadSavedView, saveView } from "./Canvas";
import SidePanel, { type Draft, draftOf, diffDraft } from "./SidePanel";
import TopBar, { type TopBarSearch } from "./TopBar";
import type { ProjectLite } from "../gate/TokenGate";

interface WorkspaceProps {
  projectId: string;
  projects: ProjectLite[];
  initialNodeId?: string;
  onChangeProject: (pid: string) => void;
  refreshProjectList: (list: ProjectLite[]) => void;
  onExit: () => void;
}

export default function Workspace({
  projectId: pid,
  projects,
  initialNodeId,
  onChangeProject,
  refreshProjectList,
  onExit,
}: WorkspaceProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [graph, setGraph] = useState<GraphNode[]>([]);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [actor, setActor] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [loadingAll, setLoadingAll] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(initialNodeId ?? null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [tab, setTab] = useState<"detail" | "relations" | "history">("detail");
  const [node, setNode] = useState<NodeFull | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftBase, setDraftBase] = useState<Draft | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [conflictRev, setConflictRev] = useState<number | null>(null);

  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [relHasMore, setRelHasMore] = useState(false);
  const [relCursor, setRelCursor] = useState<string | null>(null);
  const [incArch, setIncArch] = useState(false);

  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [commitDetail, setCommitDetail] = useState<import("../lib/types").CommitDetail | null>(null);

  const saved0 = useMemo(() => loadSavedView(pid), [pid]);
  const [folds, setFoldsRaw] = useState<ReadonlySet<string>>(new Set(saved0.folds));
  const [branchRoot, setBranchRoot] = useState<string | null>(saved0.branchRoot);

  const [pendingLocate, setPendingLocate] = useState<{ nodeId: string } | null>(null);
  const [pendingRev, setPendingRev] = useState<number | null>(null);
  const [marks, setMarks] = useState<{
    newIds: ReadonlySet<string>;
    changedIds: ReadonlySet<string>;
    badges: ReadonlyMap<string, number>;
  }>(emptyMarks());
  const [cameFrom, setCameFrom] = useState<string | null>(null);

  const [fitSignal, setFitSignal] = useState(0);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);

  const [createNodeParent, setCreateNodeParent] = useState<string | null | undefined>(undefined);
  const [modalProject, setModalProject] = useState<"" | "create" | "edit">("");
  const [createRelFrom, setCreateRelFrom] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentCommits, setRecentCommits] = useState<CommitItem[]>([]);

  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<SearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);

  const selectedRef = useRef<string | null>(null);
  const incArchRef = useRef(false);
  /** Always-fresh project snapshot so commit/polling closures never see a
   *  stale expected_revision (T19/T21). */
  const projRef = useRef<Project | null>(null);
  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);
  useEffect(() => {
    incArchRef.current = incArch;
  }, [incArch]);
  useEffect(() => {
    projRef.current = project;
  }, [project]);

  const dirty = useMemo(
    () =>
      !!(
        draft &&
        draftBase &&
        JSON.stringify(draft) !== JSON.stringify(draftBase)
      ),
    [draft, draftBase],
  );

  const ironToast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  /* ------------------------------ primitive loads ------------------------- */

  const loadNodeRelations = useCallback(
    async (id: string, inc: boolean, cursor: string | null, append: boolean) => {
      try {
        const r = await api.nodeRelations(pid, id, {
          cursor: cursor ?? undefined,
          includeArchived: inc,
          limit: 20,
        });
        setRelations((prev) => (append ? [...prev, ...r.items] : r.items));
        setRelHasMore(r.has_more);
        setRelCursor(r.next_cursor);
      } catch (e) {
        ironToast(e instanceof ApiError ? e.message : "关联加载失败", "err");
      }
    },
    [pid, ironToast],
  );

  const loadNodeCommits = useCallback(
    async (id: string) => {
      try {
        const r = await api.commits(pid, { nodeId: id, limit: 20 });
        setCommits(r.items);
        setCommitDetail(null);
      } catch {
        /* history is optional */
      }
    },
    [pid],
  );

  const syncAll = useCallback(async () => {
    const g = await api.graph(pid);
    setGraph(g.nodes);
    setGraphLoaded(true);
    setProject((p) => (p ? { ...p, revision: g.project_revision } : p));
    const sel = selectedRef.current;
    if (sel) {
      try {
        const nf = await api.node(pid, sel);
        setNode(nf);
      } catch {
        setNode(null);
        setDraft(null);
        setDraftBase(null);
      }
      await loadNodeRelations(sel, incArchRef.current, null, false);
    }
  }, [pid, loadNodeRelations]);

  /* -------------------------------- selection ----------------------------- */

  function guardLeave(targetId?: string | null): boolean {
    if (dirty && (targetId ?? null) !== selectedId) {
      return window.confirm("有未保存的草稿。离开当前节点草稿将丢失，确定继续？");
    }
    return true;
  }

  const selectNode = useCallback(
    async (id: string, opts: { locate?: boolean; silent?: boolean } = {}) => {
      if (!guardLeave(id)) return;
      setSelectedId(id);
      setSelectedRelationId(null);
      setTab("detail");
      setNode(null);
      setDraft(null);
      setDraftBase(null);
      setDraftErr(null);
      setRelations([]);
      setCommitDetail(null);
      if (!opts.silent) replaceDeepLink(pid, id);
      setNodeLoading(true);
      try {
        const nf = await api.node(pid, id);
        setNode(nf);
        const d0 = draftOf(nf);
        setDraft(d0);
        setDraftBase(d0);
        const proj = await api.project(pid);
        setProject((p) => (p ? { ...p, revision: proj.revision } : p));
      } catch (e) {
        ironToast(e instanceof ApiError ? e.message : "节点加载失败", "err");
      } finally {
        setNodeLoading(false);
      }
      loadNodeRelations(id, incArchRef.current, null, false);
      loadNodeCommits(id);
      if (opts.locate) setPendingLocate({ nodeId: id });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pid, ironToast, loadNodeRelations, loadNodeCommits, dirty],
  );

  const clearSelection = useCallback(() => {
    if (!guardLeave()) return;
    setSelectedId(null);
    setSelectedRelationId(null);
    setNode(null);
    setDraft(null);
    setDraftBase(null);
    setRelations([]);
    setCameFrom(null);
    replaceDeepLink(pid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid, dirty]);

  /** Expand needed ancestors, clear the branch filter when needed, locate. */
  const locateNode = useCallback(
    (id: string, fromId?: string) => {
      const byId = new Map(graph.map((n) => [n.id, n]));
      const inBranch = (id: string): boolean => {
        let cur: GraphNode | undefined = byId.get(id);
        while (cur) {
          if (cur.id === branchRoot) return true;
          cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
        }
        return false;
      };
      const nextFolds = new Set(folds);
      let cur = byId.get(id);
      while (cur?.parent_id) {
        nextFolds.delete(cur.parent_id);
        cur = byId.get(cur.parent_id);
      }
      const nextBranch = branchRoot && !inBranch(id) ? null : branchRoot;
      if (nextFolds.size !== folds.size) setFoldsRaw(nextFolds);
      if (nextBranch !== branchRoot) setBranchRoot(nextBranch);
      void fromId;
      void selectNode(id, { locate: true });
      if (fromId) setCameFrom(fromId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [graph, folds, branchRoot, selectNode],
  );

  const toggleFold = useCallback((id: string) => {
    setFoldsRaw((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* persist view state (folds / branch / viewport handled by Canvas) */
  useEffect(() => {
    const v = loadSavedView(pid);
    saveView(pid, { ...v, folds: [...folds], branchRoot });
  }, [folds, branchRoot, pid]);

  /* ------------------------------- first load ----------------------------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [sess, proj, g] = await Promise.all([
          api.session(),
          api.project(pid),
          api.graph(pid),
        ]);
        if (!alive) return;
        setActor(sess.actor);
        setAppVersion(sess.app_version);
        setProject({ ...proj, objective: proj.objective ?? "" } as Project);
        setGraph(g.nodes);
        setGraphLoaded(true);
        if (selectedRef.current) void selectNode(selectedRef.current);
      } catch (e) {
        ironToast(e instanceof ApiError ? e.message : "加载失败", "err");
      } finally {
        if (alive) setLoadingAll(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  /* ------------------------- polling for new revisions -------------------- */

  useEffect(() => {
    const tick = async () => {
      try {
        const proj = await api.project(pid);
        const cur = projRef.current?.revision ?? 0;
        if (proj.revision > cur) setPendingRev(proj.revision);
      } catch {
        /* transient network hiccup; next tick retries */
      }
    };
    const iv = window.setInterval(tick, 20000);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [pid]);

  async function loadUpdates() {
    const prev = graph;
    try {
      const g = await api.graph(pid);
      const prevMap = new Map(prev.map((n) => [n.id, n]));
      const newIds = new Set<string>();
      const changedIds = new Set<string>();
      for (const n of g.nodes) {
        const o = prevMap.get(n.id);
        if (!o) newIds.add(n.id);
        else if (o.updated_at !== n.updated_at || o.status !== n.status || o.title !== n.title) {
          changedIds.add(n.id);
        }
      }
      const byId = new Map(g.nodes.map((n) => [n.id, n]));
      const badges = new Map<string, number>();
      for (const id of [...newIds, ...changedIds]) {
        let cur = byId.get(id);
        while (cur?.parent_id) {
          const par = byId.get(cur.parent_id);
          if (!par) break;
          const underFold = [...folds].some((f) => isDescOrSelf(par.id, f, byId));
          const insideBranch = !branchRoot || isDescOrSelf(par.id, branchRoot, byId) || par.id === branchRoot;
          if (!underFold && insideBranch) {
            badges.set(par.id, (badges.get(par.id) ?? 0) + 1);
            break;
          }
          cur = par;
        }
      }
      setMarks({ newIds, changedIds, badges });
      setGraph(g.nodes);
      setProject((p) => (p ? { ...p, revision: g.project_revision } : p));
      setPendingRev(null);
      if (selectedRef.current) {
        try {
          const nf = await api.node(pid, selectedRef.current);
          setNode(nf);
          setProject((p) => (p ? { ...p, revision: nf.project_revision } : p));
          // T22: an in-progress draft is kept as-is; the user can then
          // "载入新版并重排草稿" (rebaseDraft) before saving.
          setDraft((d) => (d ? d : draftOf(nf)));
        } catch {
          /* node may have been archived away; next selection will 404-warn */
        }
        loadNodeRelations(selectedRef.current, incArchRef.current, null, false);
        loadNodeCommits(selectedRef.current);
      }
      ironToast("已载入最新记录", "ok");
    } catch (e) {
      ironToast(e instanceof ApiError ? e.message : "载入更新失败", "err");
    }
  }

  /** Three-way merge of the local draft onto the refreshed node:
   *  user-edited fields keep the user's value; untouched fields take the
   *  server's new value. Overlapping edits are reported, never silent. */
  async function rebaseDraft() {
    const sel = selectedId;
    if (!sel || !draft || !draftBase) return;
    try {
      const nf = await api.node(pid, sel);
      const serverDraft = draftOf(nf);
      const conflicts: string[] = [];
      const merged = { ...serverDraft } as Draft;
      for (const k of Object.keys(serverDraft) as (keyof Draft)[]) {
        const oldV = JSON.stringify(draftBase[k]);
        const userV = JSON.stringify(draft[k]);
        const srvV = JSON.stringify(serverDraft[k]);
        if (userV !== oldV) {
          (merged as Partial<Record<keyof Draft, unknown>>)[k] = draft[k];
          if (srvV !== oldV) conflicts.push(k);
        }
      }
      setNode(nf);
      setDraft(merged);
      setDraftBase(serverDraft);
      setProject((p) => (p ? { ...p, revision: nf.project_revision } : p));
      setConflictRev(null);
      setDraftErr(
        conflicts.length
          ? `以下字段你与他人同时修改，已保留你的值，请核对后再保存：${conflicts.join("、")}`
          : null,
      );
      ironToast("已载入新版并重排草稿", "ok");
    } catch (e) {
      ironToast(e instanceof ApiError ? e.message : "重载失败", "err");
    }
  }

  /* -------------------------------- commits ------------------------------- */

  async function commit(ops: CommitOp[], summary: string): Promise<CommitResponse | null> {
    const base = projRef.current;
    if (!base) return null;
    try {
      const res = await api.commit(pid, {
        request_id: uuidv4(),
        expected_revision: base.revision,
        summary,
        client_label: "researchmap-ui",
        operations: ops,
      });
      setConflictRev(null);
      setProject((p) => (p ? { ...p, revision: res.revision } : p));
      await syncAll();
      return res;
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        setConflictRev(e.currentRevision);
        setDraftErr(
          `版本冲突：服务器已更新到 v${e.currentRevision}。你的草稿完整保留；点“载入新版并重排草稿”后再保存，不会静默覆盖他人修改。`,
        );
        ironToast("版本冲突（已有他人提交）", "err");
        return null;
      }
      if (e instanceof ApiError) {
        const missing = e.details["missing"];
        setDraftErr(
          `${e.message}${Array.isArray(missing) ? `（缺失：${(missing as string[]).join("、")}）` : ""}`,
        );
      } else {
        setDraftErr(String(e));
      }
      ironToast(e instanceof ApiError ? e.message : "提交失败", "err");
      return null;
    }
  }

  const saveDraft = useCallback(async () => {
    if (!node || !draft || !draftBase || !dirty) return;
    const fields = diffDraft(draftBase, draft);
    if (Object.keys(fields).length === 0) return;
    const res = await commit(
      [{ op: "node.update", id: node.id, fields }],
      `更新节点：${draft.title}`,
    );
    if (res) {
      setDraftErr(null);
      ironToast(`已保存（v${res.revision}）`, "ok");
    }
    // after syncAll the node refetch also needs a fresh draft base
    if (res && selectedRef.current === node.id) {
      try {
        const nf = await api.node(pid, node.id);
        const d0 = draftOf(nf);
        setDraft(d0);
        setDraftBase(d0);
      } catch {
        /* keep draft */
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, draft, draftBase, dirty, pid, ironToast]);

  const discardDraft = useCallback(() => {
    if (draftBase) setDraft(draftBase);
    setDraftErr(null);
  }, [draftBase]);

  /* ------------------------------ node actions ----------------------------- */

  async function createNodeAction(parent: string | null, form: NewNodeForm) {
    const id = uuidv4();
    const op: CommitOp = {
      op: "node.create",
      id,
      kind: form.kind,
      title: form.title,
      summary: form.summary || "",
      status: form.status,
      tags: form.tags,
      ...(parent ? { parent_id: parent } : {}),
    };
    const res = await commit([op], `新增${parent ? "子节点" : "一级路线"}：${form.title}`);
    if (res) {
      setCreateNodeParent(undefined);
      ironToast(`已创建（v${res.revision}）`, "ok");
      void selectNode(id, { locate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }

  /* organization helpers */
  const parentOptions = useMemo(() => {
    if (!node) return [];
    const byId = new Map(graph.map((n) => [n.id, n]));
    const excluded = new Set<string>([node.id]);
    let cur = graph.find((n) => n.id === node.id);
    while (cur) {
      excluded.add(cur.id);
      cur = cur.parent_id ? byId.get(cur.parent_id) && byId.get(cur.parent_id)! : undefined;
    }
    // also exclude node's descendants
    const stack = [node.id];
    while (stack.length) {
      const x = stack.pop()!;
      for (const n of graph) if (n.parent_id === x) {
        excluded.add(n.id);
        stack.push(n.id);
      }
    }
    const pathOf = (id: string): string => {
      const parts: string[] = [];
      let c = byId.get(id);
      while (c) {
        parts.unshift(c.title);
        c = c.parent_id ? byId.get(c.parent_id) : undefined;
      }
      return parts.join(" / ");
    };
    const opts: { id: string | null; label: string }[] = [
      { id: null, label: "（项目一级节点）" },
    ];
    for (const n of graph) {
      if (excluded.has(n.id)) continue;
      opts.push({ id: n.id, label: `${pathOf(n.id)}` });
    }
    return opts;
  }, [graph, node]);

  const siblingInfo = useMemo(() => {
    if (!node) return null;
    const sib = graph
      .filter((n) => n.parent_id === node.parent_id)
      .sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
    const idx = sib.findIndex((n) => n.id === node.id);
    return { sib, idx };
  }, [graph, node]);

  async function moveNodeAction(parent: string | null) {
    if (!node) return;
    await commit([{ op: "node.move", id: node.id, parent_id: parent }], `移动归属：${node.title}`);
  }
  async function moveStepAction(dir: "up" | "down") {
    if (!node || !siblingInfo || siblingInfo.idx === -1) return;
    const { sib, idx } = siblingInfo;
    let afterId: string | null | undefined;
    if (dir === "up" && idx > 0) afterId = idx >= 2 ? sib[idx - 2].id : null;
    else if (dir === "down" && idx < sib.length - 1) afterId = sib[idx + 1].id;
    else return;
    await commit(
      [{ op: "node.move", id: node.id, parent_id: node.parent_id, after_id: afterId }],
      `${dir === "up" ? "上移" : "下移"}：${node.title}`,
    );
  }
  async function archiveNodeAction(reason: string) {
    if (!node) return;
    await commit([{ op: "node.archive", id: node.id, reason }], `归档节点：${node.title}`);
  }
  async function restoreNodeAction(reason: string) {
    if (!node) return;
    await commit([{ op: "node.restore", id: node.id, reason }], `恢复节点：${node.title}`);
  }

  /* ------------------------------ relation actions ------------------------- */

  async function createRelationAction(targetId: string, kind: RelationKind, reason: string) {
    if (!node) return;
    const res = await commit(
      [{ op: "relation.create", id: uuidv4(), source_id: node.id, target_id: targetId, kind, reason }],
      `建立关联：${node.title} ${kind} → ${targetId.slice(0, 8)}…`,
    );
    if (res) {
      setCreateRelFrom(null);
      setTab("relations");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }
  async function editRelationAction(r: RelationItem, f: { kind: RelationKind; reason: string }) {
    const fields: Record<string, unknown> = {};
    if (f.kind !== r.kind) fields.kind = f.kind;
    if (f.reason !== r.reason) fields.reason = f.reason;
    if (Object.keys(fields).length === 0) return;
    await commit([{ op: "relation.update", id: r.id, fields }], `修改关联：${r.kind}`);
  }
  async function archiveRelationAction(r: RelationItem, reason: string) {
    await commit([{ op: "relation.archive", id: r.id, reason }], `归档关联 ${r.kind}`);
  }
  async function restoreRelationAction(r: RelationItem, reason: string) {
    await commit([{ op: "relation.restore", id: r.id, reason }], `恢复关联 ${r.kind}`);
  }

  /* --------------------------------- exports --------------------------------- */

  async function exportProject() {
    try {
      const blob = await api.exportBlob(pid);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `researchmap-export-rev${project?.revision ?? 0}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      ironToast("导出完成（含归档记录与全部历史）", "ok");
    } catch (e) {
      ironToast(e instanceof ApiError ? e.message : "导出失败", "err");
    }
  }

  /* ---------------------------------- search --------------------------------- */

  useEffect(() => {
    const q = searchQ.trim();
    if (q.length < 1) {
      setSearchRes([]);
      setSearchTotal(0);
      return;
    }
    const t = window.setTimeout(async () => {
      setSearchLoading(true);
      try {
        const r = await api.search(pid, q, 30);
        setSearchRes(r.items);
        setSearchTotal(r.total);
      } catch {
        setSearchRes([]);
      } finally {
        setSearchLoading(false);
      }
    }, 280);
    return () => window.clearTimeout(t);
  }, [searchQ, pid]);

  const searchProp: TopBarSearch = {
    q: searchQ,
    setQ: setSearchQ,
    results: searchRes,
    loading: searchLoading,
    total: searchTotal,
    open: searchRes.length > 0 || (searchQ.trim().length > 0 && !searchLoading),
    onPick: (s) => {
      setSearchQ("");
      locateNode(s.id);
    },
    onClose: () => setSearchQ(""),
  };

  /* --------------------------------- recent -------------------------------- */
  async function openRecent() {
    setRecentOpen((v) => {
      if (!v) {
        void (async () => {
          try {
            const r = await api.commits(pid, { limit: 10 });
            setRecentCommits(r.items);
          } catch {
            setRecentCommits([]);
          }
        })();
      }
      return !v;
    });
  }
  function pickRecent(c: CommitItem) {
    setRecentOpen(false);
    const alive = new Set(graph.map((n) => n.id));
    const target = c.node_ids.find((id) => alive.has(id));
    if (target) locateNode(target);
    else void ironToast("该提交涉及的对象已归档", "err");
  }

  /* --------------------------------- render -------------------------------- */

  return (
    <div className="app">
      <TopBar
        actor={actor}
        appVersion={appVersion}
        project={project}
        projects={projects}
        currentProjectId={pid}
        onSwitchProject={(pid2) => {
          if (dirty && !window.confirm("有未保存草稿，切换项目将丢弃。继续？")) return;
          onChangeProject(pid2);
        }}
        onCreateProject={() => setModalProject("create")}
        onEditProject={() => setModalProject("edit")}
        onNewRoot={() => setCreateNodeParent(null)}
        onFit={() => setFitSignal((n) => n + 1)}
        onManualRefresh={() => {
          if (pendingRev != null) void loadUpdates();
          else void (async () => {
            try {
              const p2 = await api.project(pid);
              setProject((p) => (p ? { ...p, revision: p2.revision } : p));
              ironToast("记录目前无变化", "ok");
            } catch (e) {
              ironToast(e instanceof ApiError ? e.message : "刷新失败", "err");
            }
          })();
        }}
        onExport={() => void exportProject()}
        onExit={onExit}
        search={searchProp}
        recent={{ open: recentOpen, commits: recentCommits, toggle: () => void openRecent(), onPick: pickRecent }}
      />

      <div className="workspace">
        <div className="canvas-wrap">
          {loadingAll && <div className="empty" style={{ padding: 30 }}>正在加载项目…</div>}
          <Canvas
            projectId={pid}
            project={project}
            graph={graph}
            graphLoaded={graphLoaded}
            selectedId={selectedId}
            selectedRelationId={selectedRelationId}
            relations={relations}
            folds={folds}
            branchRoot={branchRoot}
            onToggleFold={toggleFold}
            onBranchRoot={setBranchRoot}
            onSelect={(id) => void selectNode(id)}
            onClearSelection={clearSelection}
            onPickRelation={(id) => setSelectedRelationId(id)}
            onAddChild={(par) => setCreateNodeParent(par)}
            marks={marks}
            pendingLocate={pendingLocate}
            onLocated={() => setPendingLocate(null)}
            pendingRevision={pendingRev}
            onLoadUpdates={() => void loadUpdates()}
            fitSignal={fitSignal}
            onToast={ironToast}
          />
          {toast && <div className={`toast ${toast.kind === "err" ? "err" : "ok"}`}>{toast.msg}</div>}
        </div>

        <SidePanel
          project={project}
          node={node}
          loading={nodeLoading}
          tab={tab}
          setTab={setTab}
          draft={draft}
          setDraft={setDraft}
          dirty={dirty}
          draftErr={draftErr}
          onDiscardDraft={discardDraft}
          onSave={() => void saveDraft()}
          conflictRevision={conflictRev}
          onRebaseDraft={() => void rebaseDraft()}
          onResolveConflict={() => setConflictRev(null)}
          relations={relations}
          relHasMore={relHasMore}
          relCursor={relCursor}
          includeArchived={incArch}
          setIncludeArchived={(b) => {
            setIncArch(b);
            if (selectedRef.current) loadNodeRelations(selectedRef.current, b, null, false);
          }}
          onRelPage={(cursor, append) => selectedRef.current && loadNodeRelations(selectedRef.current, incArchRef.current, cursor, append)}
          selectedRelationId={selectedRelationId}
          onPickRelation={(id) => setSelectedRelationId(id)}
          onLocate={(nid, fromId) => locateNode(nid, fromId)}
          cameFrom={cameFrom}
          onBackToFrom={() => {
            if (cameFrom) {
              void selectNode(cameFrom, { locate: true });
              setCameFrom(null);
            }
          }}
          onCreateRelation={() => node && setCreateRelFrom(node.id)}
          onEditRelation={(r, f) => void editRelationAction(r, f)}
          onArchiveRelation={(r, reason) => void archiveRelationAction(r, reason)}
          onRestoreRelation={(r, reason) => void restoreRelationAction(r, reason)}
          organization={
            node
              ? {
                  parentOptions,
                  currentParent: node.parent_id,
                  onMove: (par) => void moveNodeAction(par),
                  onMoveUp: () => void moveStepAction("up"),
                  onMoveDown: () => void moveStepAction("down"),
                  canUp: (siblingInfo?.idx ?? -1) > 0,
                  canDown:
                    siblingInfo != null && (siblingInfo?.idx ?? -1) < (siblingInfo?.sib.length ?? 0) - 1,
                  onArchive: (reason) => void archiveNodeAction(reason),
                  onRestore: (reason) => void restoreNodeAction(reason),
                }
              : null
          }
          history={{
            commits,
            detail: commitDetail,
            onSelect: async (c: CommitItem) => {
              try {
                setCommitDetail(await api.commitDetail(pid, c.id));
              } catch {
                /* ignore */
              }
            },
          }}
        />
      </div>

      {createNodeParent !== undefined && (
        <CreateNodeModal
          parentLabel={createNodeParent ? nodeTitleById(graph, createNodeParent) : "（项目一级节点）"}
          onClose={() => setCreateNodeParent(undefined)}
          onCreate={(form) => void createNodeAction(createNodeParent, form)}
        />
      )}
      {modalProject !== "" && project && (
        <ProjectModal
          mode={modalProject}
          project={project}
          onClose={() => setModalProject("")}
          onAction={async (name, objective) => {
            if (modalProject === "create") {
              const res = await api.createProject({
                request_id: uuidv4(),
                name,
                objective,
              });
              const list = await api.projects();
              refreshProjectList(list.items);
              setModalProject("");
              onChangeProject(res.id);
            } else {
              await commit(
                [{ op: "project.update", fields: { name, objective } }],
                "更新项目名称与目标",
              );
              setModalProject("");
            }
          }}
          onError={(e) => ironToast(e.message, "err")}
        />
      )}
      {createRelFrom && node && (
        <CreateRelationModal
          nodes={graph}
          fromId={createRelFrom}
          onClose={() => setCreateRelFrom(null)}
          onCreate={(t, k, r) => void createRelationAction(t, k, r)}
        />
      )}
    </div>
  );
}

/* helpers */

function emptyMarks() {
  return {
    newIds: new Set<string>() as ReadonlySet<string>,
    changedIds: new Set<string>() as ReadonlySet<string>,
    badges: new Map<string, number>() as ReadonlyMap<string, number>,
  };
}

function nodeTitleById(graph: GraphNode[], id: string): string {
  return graph.find((n) => n.id === id)?.title ?? id.slice(0, 8);
}

function isDescOrSelf(id: string, ancestorId: string, byId: Map<string, GraphNode>): boolean {
  let cur: GraphNode | undefined = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 1024) {
    if (cur.id === ancestorId) return true;
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return false;
}

/* ------------------------------- modals ----------------------------------- */

export interface NewNodeForm {
  kind: NodeKind;
  title: string;
  summary: string;
  status: import("../lib/types").NodeStatus;
  tags: string[];
}

function CreateNodeModal({
  parentLabel,
  onClose,
  onCreate,
}: {
  parentLabel: string;
  onClose: () => void;
  onCreate: (f: NewNodeForm) => void;
}) {
  const [kind, setKind] = useState<import("../lib/types").NodeKind>("idea");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<import("../lib/types").NodeStatus>("unexplored");
  const [tags, setTags] = useState("");
  const valid = title.trim().length >= 1 && title.trim().length <= 80;
  return (
    <Modal title={`新增节点 · 父级：${parentLabel}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 8 }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as NewNodeForm["kind"])}>
          <option value="question">问题</option>
          <option value="idea">想法</option>
          <option value="attempt">尝试</option>
          <option value="finding">发现（含观察/结果）</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as NewNodeForm["status"])}>
          {["unexplored", "in_progress", "promising", "supported", "not_supported", "inconclusive"].map((s) => (
            <option key={s} value={s}>{STATUS_LABEL[s as import("../lib/types").NodeStatus]}</option>
          ))}
        </select>
      </div>
      <label className="field">标题（1–80）</label>
      <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} autoFocus />
      <label className="field">摘要（一句话研究增量，0–280）</label>
      <textarea value={summary} maxLength={280} onChange={(e) => setSummary(e.target.value)} style={{ width: "100%" }} />
      <label className="field">标签（逗号分隔）</label>
      <input value={tags} onChange={(e) => setTags(e.target.value)} style={{ width: "100%" }} />
      <div className="mrow">
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!valid}
          onClick={() =>
            onCreate({
              kind,
              title: title.trim(),
              summary: summary.trim(),
              status,
              tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 10),
            })
          }
        >
          创建
        </button>
      </div>
    </Modal>
  );
}

function ProjectModal({
  mode,
  project,
  onClose,
  onAction,
  onError,
}: {
  mode: "create" | "edit";
  project: Project;
  onClose: () => void;
  onAction: (name: string, objective: string) => Promise<void>;
  onError: (e: Error) => void;
}) {
  const [name, setName] = useState(mode === "edit" ? project.name : "");
  const [objective, setObjective] = useState(mode === "edit" ? project.objective : "");
  const valid = name.trim().length >= 1 && name.trim().length <= 100 && objective.trim().length >= 1;
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={mode === "create" ? "创建项目" : "项目设置（名称与目标）"} onClose={onClose}>
      <label className="field">项目名（1–100）</label>
      <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} autoFocus />
      <label className="field">研究目标（1–4000）</label>
      <textarea value={objective} maxLength={4000} onChange={(e) => setObjective(e.target.value)} style={{ width: "100%", minHeight: 110 }} />
      <ModalFooter
        busy={busy}
        onCancel={onClose}
        canSubmit={valid && !busy}
        submitLabel={mode === "create" ? "创建项目" : "保存"}
        onSubmit={() => {
          setBusy(true);
          onAction(name.trim(), objective.trim()).catch(onError).finally(() => setBusy(false));
        }}
      />
    </Modal>
  );
}

function CreateRelationModal({
  nodes,
  fromId,
  onClose,
  onCreate,
}: {
  nodes: GraphNode[];
  fromId: string;
  onClose: () => void;
  onCreate: (targetId: string, kind: RelationKind, reason: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState<RelationKind>("related");
  const [reason, setReason] = useState("");
  const from = nodes.find((n) => n.id === fromId);
  const cands = nodes
    .filter((n) => n.id !== fromId)
    .filter((n) => {
      if (!filter.trim()) return true;
      const f = filter.toLowerCase();
      return (
        n.title.toLowerCase().includes(f) ||
        n.summary.toLowerCase().includes(f) ||
        n.tags.some((t) => t.toLowerCase().includes(f))
      );
    })
    .slice(0, 80);
  return (
    <Modal title={`新增关联 · 起点：${from?.title ?? ""}（方向：本节点 → 目标）`} onClose={onClose}>
      <label className="field">选择目标（输入关键词缩小范围）</label>
      <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="如：溶剂热 / 高压 / 催化剂" style={{ width: "100%" }} />
      <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: "100%", marginTop: 6 }}>
        <option value="">— 从 {cands.length} 个候选中选择 —</option>
        {cands.map((n) => {
          const pathTitle = pathTextOf(n, nodes);
          return <option key={n.id} value={n.id}>{n.title} · {pathTitle}</option>;
        })}
      </select>
      <label className="field">关系类型（方向固定：本节点 → 目标）</label>
      <select value={kind} onChange={(e) => setKind(e.target.value as RelationKind)} style={{ width: "100%" }}>
        <option value="related">相关 related（无向）</option>
        <option value="motivates">启发 motivates</option>
        <option value="supports">支持 supports</option>
        <option value="contradicts">反对/不支持 contradicts</option>
        <option value="depends_on">依赖 depends_on</option>
      </select>
      <label className="field">原因（一句话，1–500，必填）</label>
      <textarea value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} placeholder="例：该失败实验的负结果支持本节点的停止条件" />
      <div className="modal-actions">
        <button onClick={onClose}>取消</button>
        <button
          className="primary"
          disabled={!target || !reason.trim()}
          onClick={() => onCreate(target, kind, reason.trim())}
        >
          建立关联
        </button>
      </div>
      <div className="muted" style={{ marginTop: 8, fontSize: 11 }}>
        新增 supports / contradicts 不会自动改变任何节点状态；状态只能由研究者显式填写。
      </div>
    </Modal>
  );
}

function pathTextOf(n: GraphNode, nodes: GraphNode[]): string {
  const byId = new Map(nodes.map((x) => [x.id, x]));
  const parts: string[] = [];
  let c: GraphNode | undefined = n;
  while (c && parts.length < 6) {
    parts.unshift(c.title);
    c = c.parent_id ? byId.get(c.parent_id) : undefined;
  }
  return parts.join(" / ");
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalFooter({
  busy,
  onCancel,
  canSubmit,
  submitLabel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
}) {
  return (
    <div className="mrow">
      <button onClick={onCancel} disabled={busy}>取消</button>
      <button className="primary" disabled={!canSubmit} onClick={onSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}