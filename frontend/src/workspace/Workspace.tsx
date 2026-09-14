/** Workspace: all app state, commit pipeline, polling, marks, modals.
 *
 *  Browser writes go through the same backend commit path AI tools use
 *  (SPEC 6); this file only composes single/ multi-op requests and never
 *  writes straight to storage.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { uuidv4 } from "../lib/api";
import { initialFolds } from "../lib/layout";
import { preserveUndecided, threeWayMerge } from "../lib/merge";
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
import SidePanel, {
  DRAFT_FIELD_LABEL,
  type Draft,
  type DraftConflict,
  draftOf,
  diffDraft,
} from "./SidePanel";
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
  /** B04: archived nodes are hidden by default. Without this toggle a node
   *  archived in the browser would be unreachable (the graph and search both
   *  filter it out), so there would be no way back — see restoreNodeAction. */
  const [showArchived, setShowArchived] = useState(false);
  // Every graph read after the first one (commit sync, manual refresh, toggle)
  // has to agree with the first one about archived nodes, or the toggle would
  // silently snap back on the next commit.
  const showArchivedRef = useRef(showArchived);
  useEffect(() => {
    showArchivedRef.current = showArchived;
  }, [showArchived]);
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
  /** A02: the project revision the draft was read at — commits of this draft
   *  must use THIS baseline, never a later global revision. */
  const [draftBaseRev, setDraftBaseRev] = useState<number | null>(null);
  const [draftErr, setDraftErr] = useState<string | null>(null);
  /** A02/R02: fields both you and someone else changed, with all three
   *  versions. Non-empty blocks saving until every one is resolved. */
  const [draftConflicts, setDraftConflicts] = useState<DraftConflict[]>([]);
  const [conflictRev, setConflictRev] = useState<number | null>(null);

  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [relHasMore, setRelHasMore] = useState(false);
  const [relCursor, setRelCursor] = useState<string | null>(null);
  const [incArch, setIncArch] = useState(false);

  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [commitDetail, setCommitDetail] = useState<import("../lib/types").CommitDetail | null>(null);
  const [histNodeId, setHistNodeId] = useState<string | null>(null);
  const [commitCursor, setCommitCursor] = useState<string | null>(null);
  const [commitHasMore, setCommitHasMore] = useState(false);

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
  const [createNodeErr, setCreateNodeErr] = useState<string | null>(null);
  const [modalProject, setModalProject] = useState<"" | "create" | "edit">("");
  const [aiAccessOpen, setAiAccessOpen] = useState(false);
  const [createRelFrom, setCreateRelFrom] = useState<string | null>(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentCommits, setRecentCommits] = useState<CommitItem[]>([]);

  const [searchQ, setSearchQ] = useState("");
  const [searchRes, setSearchRes] = useState<SearchItem[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);

  const selectedRef = useRef<string | null>(null);
  const incArchRef = useRef(false);
  /** One graph read for the whole file, so "show archived" can never diverge
   *  between the first load, commit syncs and manual refreshes (B04). */
  const fetchGraph = useCallback(
    () => api.graph(pid, { includeArchived: showArchivedRef.current }),
    [pid],
  );
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
  const dirtyRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const draftBaseRef = useRef<Draft | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    draftBaseRef.current = draftBase;
  }, [draftBase]);
  /** R02: conflicts the user has NOT decided on yet. A refresh must never drop
   *  one of these — see applyServerSnapshot. */
  const draftConflictsRef = useRef<DraftConflict[]>([]);
  useEffect(() => {
    draftConflictsRef.current = draftConflicts;
  }, [draftConflicts]);

  const dirty = useMemo(
    () =>
      !!(
        draft &&
        draftBase &&
        JSON.stringify(draft) !== JSON.stringify(draftBase)
      ),
    [draft, draftBase],
  );
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  /** A02: dirty draft was read at a revision older than the server's — saving
   *  now would squash commits made in between; the user must rebase first. */
  const draftStale =
    !!dirty && draftBaseRev != null && (project?.revision ?? 0) > draftBaseRev;

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
    async (id: string, cursor: string | null = null, append: boolean = false) => {
      try {
        const r = await api.commits(pid, { nodeId: id, limit: 20, cursor: cursor ?? undefined });
        if (!append) setHistNodeId(id);
        setCommits((prev) => (append ? [...prev, ...r.items] : r.items));
        setCommitCursor(r.next_cursor ?? null);
        setCommitHasMore(r.has_more);
        if (!append) setCommitDetail(null);
      } catch {
        /* history is optional */
      }
    },
    [pid],
  );

  /** A02/R02: the single place every refresh path (post-commit sync, 载入更新,
   *  重排草稿) applies a fresh server snapshot to the live draft. Routing all
   *  three through here is what stops one of them from silently dropping
   *  conflicts and advancing the baseline, as post-commit sync used to. */
  const applyServerSnapshot = useCallback((nf: NodeFull): DraftConflict[] => {
    const server = draftOf(nf);
    const d = draftRef.current;
    const base = draftBaseRef.current;
    if (d && base && dirtyRef.current) {
      const { merged, conflicts } = threeWayMerge(base, d, server, (f) => DRAFT_FIELD_LABEL[f]);
      const next = preserveUndecided(conflicts, draftConflictsRef.current, merged, server);
      setDraft(merged);
      setDraftBase(server);
      setDraftConflicts(next);
      return next;
    }
    setDraft(server);
    setDraftBase(server);
    setDraftConflicts([]);
    return [];
  }, []);

  const syncAll = useCallback(async () => {
    const g = await fetchGraph();
    setGraph(g.nodes);
    setGraphLoaded(true);
    setProject((p) => (p ? { ...p, revision: g.project_revision } : p));
    const sel = selectedRef.current;
    if (sel) {
      try {
        const nf = await api.node(pid, sel);
        setNode(nf);
        setProject((p) => (p ? { ...p, revision: nf.project_revision } : p));
        // A02/R02: a dirty draft is rebased onto the fresh snapshot — untouched
        // fields take the server's value, your edits stay, and same-field
        // conflicts are surfaced here exactly like on an explicit refresh
        // (this path used to discard them and advance the baseline anyway).
        const conflicts = applyServerSnapshot(nf);
        setDraftBaseRev(nf.project_revision);
        if (conflicts.length) {
          ironToast("刷新后发现同字段冲突，请在详情面板逐项核对", "err");
        }
      } catch {
        setNode(null);
        setDraft(null);
        setDraftBase(null);
        setDraftBaseRev(null);
        setDraftConflicts([]);
      }
      await loadNodeRelations(sel, incArchRef.current, null, false);
      loadNodeCommits(sel);
    }
  }, [pid, loadNodeRelations, loadNodeCommits, applyServerSnapshot, ironToast]);

  /* -------------------------------- selection ----------------------------- */

  /** A02/R01: the ONE dirty-draft guard every real leave path goes through
   *  (exit, new project, switch project, switch node, close panel). Cancel
   *  returns false and the caller must leave the draft and the view untouched. */
  function confirmLeaveDraft(what: string): boolean {
    if (!dirty) return true;
    return window.confirm(`有未保存的草稿。${what}草稿将丢失，确定继续？`);
  }

  function guardLeave(targetId?: string | null): boolean {
    if ((targetId ?? null) === selectedId) return true;
    return confirmLeaveDraft("离开当前节点，");
  }

  const selectNode = useCallback(
    async (id: string, opts: { locate?: boolean; silent?: boolean } = {}) => {
      if (!guardLeave(id)) return;
      if (id === selectedId && node) {
        // A02: re-clicking the current node must never wipe a live draft —
        // it just re-centers the canvas.
        if (!opts.silent) replaceDeepLink(pid, id);
        setPendingLocate({ nodeId: id });
        return;
      }
      setSelectedId(id);
      setSelectedRelationId(null);
      setTab("detail");
      setNode(null);
      setDraft(null);
      setDraftBase(null);
      setDraftBaseRev(null);
      setDraftErr(null);
      setDraftConflicts([]);
      setRelations([]);
      setCommits([]);
      setCommitDetail(null);
      setCommitCursor(null);
      setCommitHasMore(false);
      if (!opts.silent) replaceDeepLink(pid, id);
      setNodeLoading(true);
      try {
        const nf = await api.node(pid, id);
        setNode(nf);
        const d0 = draftOf(nf);
        setDraft(d0);
        setDraftBase(d0);
        // A02: pin the draft to the revision it was actually read from.
        setProject((p) => (p ? { ...p, revision: nf.project_revision } : p));
        setDraftBaseRev(nf.project_revision);
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
    [pid, ironToast, loadNodeRelations, loadNodeCommits, dirty, selectedId, node],
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
          fetchGraph(),
        ]);
        if (!alive) return;
        setActor(sess.actor);
        setAppVersion(sess.app_version);
        setProject({ ...proj, objective: proj.objective ?? "" } as Project);
        setGraph(g.nodes);
        setGraphLoaded(true);
        // A03: first open (no saved view at all) → show only the virtual root
        // plus the first two business levels (fold every depth ≥ 2 node).
        let initFolds = new Set(saved0.folds);
        if (saved0.folds.length === 0 && saved0.viewport === null) {
          initFolds = initialFolds(g.nodes);
        }
        if (selectedRef.current) {
          const id = selectedRef.current;
          const byId = new Map(g.nodes.map((n) => [n.id, n]));
          const exists = byId.has(id);
          if (exists) {
            // A07: a node deep link outranks the saved view — expand the
            // target's ancestors and clear a branch focus it isn't in.
            const next = new Set(initFolds);
            let cur = byId.get(id);
            while (cur?.parent_id) {
              next.delete(cur.parent_id);
              cur = byId.get(cur.parent_id);
            }
            setFoldsRaw(next);
            if (branchRoot) {
              let c: GraphNode | undefined = byId.get(id);
              let inBranch = false;
              while (c) {
                if (c.id === branchRoot) {
                  inBranch = true;
                  break;
                }
                c = c.parent_id ? byId.get(c.parent_id) : undefined;
              }
              if (!inBranch) setBranchRoot(null);
            }
            void selectNode(id, { locate: true });
          } else {
            // deep link to a missing (possibly archived) node: warn only
            setFoldsRaw(initFolds);
            void selectNode(id, { locate: false });
          }
        } else {
          setFoldsRaw(initFolds);
        }
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

  /* B04: toggling "show archived" only needs the graph re-read — the session
     and project header are unchanged, and a full reload would drop the view. */
  const archivedToggleLoaded = useRef(false);
  useEffect(() => {
    if (!archivedToggleLoaded.current) {
      archivedToggleLoaded.current = true; // the first load above already ran
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const g = await fetchGraph();
        if (alive) setGraph(g.nodes);
      } catch (e) {
        if (alive) ironToast(e instanceof ApiError ? e.message : "加载失败", "err");
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

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
      const g = await fetchGraph();
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
          // A02/T22/R02: an explicit "载入更新" rebases the live draft onto the
          // new snapshot — user-edited fields keep the user's value; overlapping
          // edits are surfaced for comparison, never applied silently.
          applyServerSnapshot(nf);
          setDraftBaseRev(nf.project_revision);
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

  /** Three-way merge of the local draft onto a refreshed snapshot (A02):
 *  user-edited fields keep the user's value; untouched fields take the
 *  server's new value. Overlapping edits are reported, never silent. */
async function rebaseDraft() {
    const sel = selectedId;
    const d = draft;
    const base = draftBase;
    if (!sel || !d || !base) return;
    try {
      const nf = await api.node(pid, sel);
      setNode(nf);
      applyServerSnapshot(nf);
      setDraftBaseRev(nf.project_revision);
      setProject((p) => (p ? { ...p, revision: nf.project_revision } : p));
      setConflictRev(null);
      setDraftErr(null);
      ironToast("已载入新版并重排草稿", "ok");
    } catch (e) {
      ironToast(e instanceof ApiError ? e.message : "重载失败", "err");
    }
  }

  /* -------------------------------- commits ------------------------------- */

  async function commit(
    ops: CommitOp[],
    summary: string,
    opts: { baseRev?: number; onFail?: (e: unknown) => void } = {},
  ): Promise<CommitResponse | null> {
    const base = projRef.current;
    if (!base) return null;
    try {
      const res = await api.commit(pid, {
        request_id: uuidv4(),
        // A02: node updates commit against the draft's own baseline revision,
        // everything else against the currently loaded project revision.
        expected_revision: opts.baseRev ?? base.revision,
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
      if (opts.onFail) {
        opts.onFail(e);
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
    // R02: an unresolved same-field conflict must never be submitted as if the
    // user had reviewed it.
    if (draftConflicts.length) {
      ironToast(
        `还有 ${draftConflicts.length} 个字段与他人的修改冲突未处理：请在冲突区逐项选择后再保存`,
        "err",
      );
      return;
    }
    if (draftStale) {
      ironToast(
        `草稿基于 v${draftBaseRev}，服务器已是 v${project?.revision}：先点“载入新版并重排草稿”再保存`,
        "err",
      );
      return;
    }
    const fields = diffDraft(draftBase, draft);
    if (Object.keys(fields).length === 0) return;
    // A02: commit against the revision this draft was read from.
    const res = await commit(
      [{ op: "node.update", id: node.id, fields }],
      `更新节点：${draft.title}`,
      { baseRev: draftBaseRev ?? undefined },
    );
    if (res) {
      setDraftErr(null);
      ironToast(`已保存（v${res.revision}）`, "ok");
    }
    // on success syncAll() already re-pins the draft base (or rebases it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, draft, draftBase, dirty, draftBaseRev, draftStale, project, pid, ironToast, draftConflicts]);

  const discardDraft = useCallback(() => {
    if (draftBase) setDraft(draftBase);
    setDraftErr(null);
    setDraftConflicts([]);
  }, [draftBase]);

  /** R02: record the user's choice for one conflicting field. "manual" keeps
   *  whatever is in the editor and just marks the field reviewed. */
  const resolveConflict = useCallback(
    (field: keyof Draft, choice: "local" | "server" | "manual") => {
      const hit = draftConflicts.find((c) => c.field === field);
      if (!hit) return;
      if (choice !== "manual") {
        const v = choice === "local" ? hit.local : hit.server;
        setDraft((d) => (d ? ({ ...d, [field]: v } as Draft) : d));
      }
      setDraftConflicts((prev) => prev.filter((c) => c.field !== field));
    },
    [draftConflicts],
  );

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
    // A06: supported / not_supported 需要 scope / finding / decision + ≥1 证据
    // （与服务端 _check_confirmed 同一闸口，前端先行拦截）。
    const scope = form.scope?.trim();
    const finding = form.finding?.trim();
    const decision = form.decision?.trim();
    if (scope) op.scope = scope;
    if (finding) op.finding = finding;
    if (decision) op.decision = decision;
    const evs = form.evidence?.filter((e) => e.label.trim() || e.value.trim());
    if (evs && evs.length > 0) op.evidence = evs.map((e) => ({ ...e }));
    const res = await commit([op], `新增${parent ? "子节点" : "一级路线"}：${form.title}`, {
      onFail: (e) => {
        const msg = e instanceof ApiError ? e.message : String(e);
        const missing = e instanceof ApiError ? e.details["missing"] : undefined;
        setCreateNodeErr(
          `${msg}${Array.isArray(missing) ? `（缺失：${(missing as string[]).join("、")}）` : ""}`,
        );
        ironToast(e instanceof ApiError ? e.message : "创建失败", "err");
      },
    });
    if (res) {
      setCreateNodeParent(undefined);
      setCreateNodeErr(null);
      ironToast(`已创建（v${res.revision}）`, "ok");
      void selectNode(id, { locate: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }

  /* organization helpers */
  const parentOptions = useMemo(() => {
    if (!node) return [];
    const byId = new Map(graph.map((n) => [n.id, n]));
    // B04: exclude ONLY the node itself and its descendants — every ancestor
    // (including the current parent) is a legal move target, which is what
    // upward moves need.
    const excluded = new Set<string>([node.id]);
    const stack = [node.id];
    while (stack.length) {
      const x = stack.pop()!;
      for (const n of graph)
        if (n.parent_id === x && !excluded.has(n.id)) {
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
          if (!confirmLeaveDraft("切换项目，")) return;
          onChangeProject(pid2);
        }}
        onCreateProject={() => {
          // Creating a project navigates away (onChangeProject below), so the
          // guard belongs here — before the user fills in a form they'd lose.
          if (!confirmLeaveDraft("新建项目会离开当前项目，")) return;
          setModalProject("create");
        }}
        onEditProject={() => setModalProject("edit")}
        onNewRoot={() => setCreateNodeParent(null)}
        onFit={() => setFitSignal((n) => n + 1)}
        onManualRefresh={() => {
          // A08: 手动刷新必须检测服务器是否真的更新——落后就按更新流程载入，
          // 未落后才提示“无变化”。
          if (pendingRev != null) void loadUpdates();
          else
            void (async () => {
              try {
                const p2 = await api.project(pid);
                const loaded = projRef.current?.revision ?? 0;
                if (p2.revision > loaded) {
                  setPendingRev(p2.revision);
                  await loadUpdates();
                } else {
                  setProject((p) => (p ? { ...p, revision: p2.revision } : p));
                  ironToast("记录目前无变化", "ok");
                }
              } catch (e) {
                ironToast(e instanceof ApiError ? e.message : "刷新失败", "err");
              }
            })();
        }}
        onExport={() => void exportProject()}
        onShowAiAccess={() => setAiAccessOpen(true)}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
        onExit={() => {
          if (!confirmLeaveDraft("退出当前项目，")) return;
          onExit();
        }}
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
          draftStale={draftStale}
          draftBaseRev={draftBaseRev}
          draftErr={draftErr}
          conflicts={draftConflicts}
          onResolveConflictField={resolveConflict}
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
            hasMore: commitHasMore,
            onLoadMore: () => {
              if (commitCursor && histNodeId) loadNodeCommits(histNodeId, commitCursor, true);
            },
            titleOf: (id: string) => graph.find((g) => g.id === id)?.title ?? null,
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
          err={createNodeErr}
          onClose={() => {
            setCreateNodeParent(undefined);
            setCreateNodeErr(null);
          }}
          onCreate={(form) => createNodeAction(createNodeParent, form)}
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
      {aiAccessOpen && project && (
        <AiAccessModal project={project} pid={pid} onClose={() => setAiAccessOpen(false)} onToast={ironToast} />
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
  /** A06: required by the backend for supported / not_supported nodes. */
  scope?: string;
  finding?: string;
  decision?: string;
  evidence?: { kind: "inline" | "url" | "path"; label: string; value: string; note: string }[];
}

function CreateNodeModal({
  parentLabel,
  err,
  onClose,
  onCreate,
}: {
  parentLabel: string;
  err: string | null;
  onClose: () => void;
  onCreate: (f: NewNodeForm) => void | Promise<void>;
}) {
  const [kind, setKind] = useState<import("../lib/types").NodeKind>("idea");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [status, setStatus] = useState<import("../lib/types").NodeStatus>("unexplored");
  const [tags, setTags] = useState("");
  const [scope, setScope] = useState("");
  const [finding, setFinding] = useState("");
  const [decision, setDecision] = useState("");
  const [ev, setEv] = useState<{ kind: "inline" | "url" | "path"; label: string; value: string; note: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const gated = status === "supported" || status === "not_supported";
  const baseValid = title.trim().length >= 1 && title.trim().length <= 80;
  const gatedValid =
    !gated ||
    (!!scope.trim() &&
      !!finding.trim() &&
      !!decision.trim() &&
      ev.some((e) => e.label.trim() || e.value.trim()));
  const valid = baseValid && gatedValid;
  const submit = () => {
    setBusy(true);
    void Promise.resolve(
      onCreate({
        kind,
        title: title.trim(),
        summary: summary.trim(),
        status,
        tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean).slice(0, 10),
        ...(gated
          ? {
              scope: scope.trim(),
              finding: finding.trim(),
              decision: decision.trim(),
              evidence: ev.map((e) => ({ ...e })),
            }
          : {}),
      }),
    ).finally(() => setBusy(false));
  };
  const setEvRow = (i: number, patch: Partial<{ kind: "inline" | "url" | "path"; label: string; value: string; note: string }>) =>
    setEv((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
      {gated && (
        <div className="gated-fields">
          <div className="hint">
            状态为「受支持／不支持」时，必须给出适用条件、发现与决定，并至少 1 条证据（与服务端同一闸口）。
          </div>
          <label className="field">适用条件 scope（必填，≤1000）</label>
          <textarea value={scope} maxLength={1000} onChange={(e) => setScope(e.target.value)} style={{ width: "100%" }} placeholder="该结论适用于哪些材料 / 工艺 / 条件" />
          <label className="field">发现 finding（必填，≤2000）</label>
          <textarea value={finding} maxLength={2000} onChange={(e) => setFinding(e.target.value)} style={{ width: "100%" }} placeholder="观察到的事实与结果，尽量定量" />
          <label className="field">决定 decision（必填，≤2000）</label>
          <textarea value={decision} maxLength={2000} onChange={(e) => setDecision(e.target.value)} style={{ width: "100%" }} placeholder="采纳 / 放弃 / 修改什么条件，以及为什么" />
          <label className="field">证据（≥1 条）</label>
          {ev.map((e, i) => (
            <div className="evid-row gated-ev" key={i}>
              <select value={e.kind} onChange={(evn) => setEvRow(i, { kind: evn.target.value as "inline" | "url" | "path" })}>
                <option value="inline">行内记录</option>
                <option value="url">url</option>
                <option value="path">路径</option>
              </select>
              <input value={e.label} maxLength={80} onChange={(evn) => setEvRow(i, { label: evn.target.value })} placeholder="名称" />
              <input value={e.value} maxLength={2000} onChange={(evn) => setEvRow(i, { value: evn.target.value })} placeholder={e.kind === "url" ? "https://…" : e.kind === "path" ? "相对仓库路径" : "内容"} />
              <button type="button" title="删除这条证据" onClick={() => setEv((rows) => rows.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setEv((rows) => [...rows, { kind: "inline", label: "", value: "", note: "" }])}
          >
            ＋ 添加证据
          </button>
        </div>
      )}
      {err && <div className="form-err">{err}</div>}
      <div className="mrow">
        <button onClick={onClose} disabled={busy}>取消</button>
        <button className="primary" disabled={!valid || busy} onClick={submit}>
          {busy ? "创建中…" : "创建"}
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

function AiAccessModal({
  project,
  pid,
  onClose,
  onToast,
}: {
  project: Project;
  pid: string;
  onClose: () => void;
  onToast: (msg: string, kind?: "ok" | "err") => void;
}) {
  const origin = window.location.origin;
  const block = [
    `服务器：${origin}（Authorization: Bearer <你的令牌>）`,
    `项目名称：${project.name}`,
    `项目 ID：${pid}`,
    `身份：每条提交的 actor 为令牌名（token_name），无法伪造`,
    "",
    "# 一次性配置（令牌只走环境变量，永不写进文件 / 日志 / 命令行参数）",
    `export RESEARCHMAP_BASE_URL="${origin}"`,
    `export RESEARCHMAP_TOKEN="<你的令牌>"`,
    "",
    "# 读取当前状态（不改数据）。以下三条都可直接粘贴运行：",
    `python3 tools/researchmap.py context ${pid}`,
    "# 聚焦某个节点（节点 ID 见卡片右键「复制节点深链接」末尾的 ?node=，或 graph 输出）：",
    `python3 tools/researchmap.py context ${pid} --focus 00000000-0000-0000-0000-000000000000`,
    "# 按关键词检索（中文子串可用）：",
    `python3 tools/researchmap.py context ${pid} --q "关键词"`,
    "",
    "# 提交修改（请求文件必须含完整 request_id + expected_revision；先 --dry-run 校验）",
    `python3 tools/researchmap.py commit ${pid} request.json --dry-run`,
    `python3 tools/researchmap.py commit ${pid} request.json`,
    "",
    "# 409 有四种，处理方式不同（退出码统一为 2，具体看 error.code）：",
    "#   REVISION_CONFLICT      期间有人提交过，锁的是整个项目的版本、不是单个对象；",
    "#                          本次一个字节都没写入。重读 context 后显式重写文件",
    "#                          （新的 expected_revision + 合并后的 operations）；",
    "#                          409 不留记录，沿用原 request_id 是合法的。",
    "#   IDEMPOTENCY_KEY_REUSED 该 request_id 已以不同内容成功提交过。要么原字节重放，",
    "#                          要么换新 request_id，切勿改字段后复用。",
    "#   DUPLICATE_RELATION     同端点同类型的未归档关联已存在，改用 relation.update/restore。",
    "#   PAGINATION_STALE       分页途中项目版本变了，放弃游标从头翻。",
    "# 完整规范：docs/AI_USAGE.md（英文主入口）/ docs/AI_USAGE.zh-CN.md",
  ].join("\n");
  return (
    <Modal title="AI 接入说明" onClose={onClose}>
      <p className="muted">
        AI 与浏览器走同一条提交协议，不需要模型 API Key；所有持令牌者属于同一个受信任空间。
      </p>
      <pre className="aiaccess-pre">{block}</pre>
      <div className="mrow">
        <button
          onClick={() =>
            navigator.clipboard
              .writeText(block)
              .then(() => onToast("接入信息已复制", "ok"))
              .catch(() => onToast("复制失败", "err"))
          }
        >
          复制接入信息
        </button>
        <button className="primary" onClick={onClose}>
          关闭
        </button>
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