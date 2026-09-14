"""Read endpoints (SPEC 7.1) plus the commit entry points.

Every response is built inside one read transaction (single WAL snapshot) so a
graph/export/context response never mixes two revisions (SPEC 7.1).
"""

from __future__ import annotations

import base64
import json
import uuid
from typing import Any, Optional

import sqlalchemy.exc
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select

from . import __version__
from .auth import require_auth
from .config import MAX_BODY_BYTES
from .db import read_session
from .errors import AppError, err, not_found
from .models import Commit, CommitNode, Node, Project, Relation
from .service import create_project, safe_sql_op, submit_commit

router = APIRouter(prefix="/api/v1", tags=["researchmap"], dependencies=[Depends(require_auth)])

PAGE_DEFAULT = 50
PAGE_MAX = 100


def _lj(s: str):
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


async def read_json_body(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise err(413, "REQUEST_TOO_LARGE", "请求体超过 2 MiB 上限")
    try:
        data = json.loads(raw)
    except ValueError:
        raise AppError(422, "VALIDATION", "请求体不是合法 JSON")
    if not isinstance(data, dict):
        raise AppError(422, "VALIDATION", "请求体必须是 JSON 对象")
    return data


# ---------------------------------------------------------------------------
# pagination cursors — carried with a version stamp; a changed revision
# between pages yields 409 PAGINATION_STALE instead of silent duplicates/
# omissions (SPEC 7.1)
# ---------------------------------------------------------------------------

def _enc_cursor(payload: dict) -> str:
    return base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()).decode()


def _dec_cursor(cursor: str) -> dict:
    try:
        c = json.loads(base64.urlsafe_b64decode(cursor.encode()).decode())
        if not isinstance(c, dict):
            raise ValueError
        return c
    except Exception:
        raise err(400, "BAD_CURSOR", "游标无效，请重新发起查询")


def _stale() -> AppError:
    return err(409, "PAGINATION_STALE",
               "数据在分页期间发生了变化（revision 已更新），请从头重新分页")


def node_path(nodes: dict[str, Node], node: Node) -> list[dict]:
    chain: list[Node] = [node]
    cur: Optional[Node] = node
    seen = {node.id}
    while cur is not None and cur.parent_id:
        nxt = nodes.get(cur.parent_id)
        if nxt is None or nxt.id in seen:
            break
        chain.append(nxt)
        seen.add(nxt.id)
        cur = nxt
    chain.reverse()
    return [{"id": n.id, "title": n.title, "kind": n.kind, "status": n.status,
             "archived": bool(n.archived)} for n in chain]


def node_full(n: Node) -> dict:
    return {
        "id": n.id, "parent_id": n.parent_id, "order_index": n.order_index,
        "kind": n.kind, "title": n.title, "summary": n.summary, "status": n.status,
        "rationale": n.rationale, "finding": n.finding, "decision": n.decision,
        "scope": n.scope, "details_md": n.details_md,
        "tags": _lj(n.tags), "evidence": _lj(n.evidence), "archived": bool(n.archived),
        "created_at": n.created_at, "updated_at": n.updated_at,
        "created_by": n.created_by, "updated_by": n.updated_by,
    }


def _get_project_row(s, pid: str) -> Project:
    p = s.get(Project, pid)
    if p is None:
        raise not_found(f"项目 {pid} 不存在")
    return p


# ---------------------------------------------------------------------------
# projects
# ---------------------------------------------------------------------------

@router.get("/projects")
def list_projects(
    limit: int = Query(default=PAGE_DEFAULT, ge=1, le=PAGE_MAX),
    cursor: Optional[str] = None,
) -> dict:
    with read_session() as s:
        all_projects = list(s.scalars(select(Project)
                                      .order_by(Project.updated_at.desc(), Project.id)).all())
        version = all_projects[0].updated_at if all_projects else "0"
        offset = 0
        if cursor:
            c = _dec_cursor(cursor)
            if c.get("v") != version:
                raise _stale()
            offset = int(c.get("offset", 0))
        items = all_projects[offset:offset + limit]
        has_more = offset + limit < len(all_projects)
        return {
            "items": [{
                "id": p.id, "name": p.name, "objective": p.objective,
                "revision": p.revision, "created_at": p.created_at,
                "updated_at": p.updated_at, "created_by": p.created_by,
            } for p in items],
            "next_cursor": _enc_cursor({"v": version, "offset": offset + limit}) if has_more else None,
            "has_more": has_more,
        }


@router.post("/projects")
async def create_project_route(request: Request, actor: str = Depends(require_auth)) -> dict:
    data = await read_json_body(request)
    try:
        return create_project(actor, data)
    except sqlalchemy.exc.OperationalError as e:
        from .service import safe_sql_op as _s
        be = _s(e)
        raise be if be is not None else AppError(500, "INTERNAL", "数据库错误")


@router.get("/projects/{pid}")
def get_project(pid: str) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        nodes = list(s.scalars(select(Node).where(Node.project_id == pid)).all())
        rels = list(s.scalars(select(Relation).where(Relation.project_id == pid)).all())
        n_commits = s.execute(select(func.count(Commit.id)).where(Commit.project_id == pid)).scalar_one()
        return {
            "id": p.id, "name": p.name, "objective": p.objective,
            "revision": p.revision, "created_at": p.created_at,
            "updated_at": p.updated_at, "created_by": p.created_by,
            "counts": {
                "nodes": len(nodes),
                "nodes_archived": sum(1 for n in nodes if n.archived),
                "relations": len(rels),
                "relations_archived": sum(1 for r in rels if r.archived),
                "commits": n_commits,
            },
        }


# ---------------------------------------------------------------------------
# graph
# ---------------------------------------------------------------------------

@router.get("/projects/{pid}/graph")
def get_graph(pid: str, include_archived: bool = False) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        # B04: archived nodes are hidden by default; `include_archived=true` is how
        # the UI reaches them again to restore one (a node archived in the browser
        # is otherwise unreachable, since search and the graph both hide it).
        all_nodes = list(s.scalars(select(Node).where(Node.project_id == pid)).all())
        nodes = all_nodes if include_archived else [n for n in all_nodes if not n.archived]
        by_id = {n.id: n for n in all_nodes}
        rels = list(s.scalars(select(Relation).where(Relation.project_id == pid,
                                                     Relation.archived.is_(False))).all())
        child_count: dict[str, int] = {}
        # Leaf-only archiving is judged on NON-archived children, exactly as the
        # node endpoint does — so showing archived nodes never makes an
        # effectively-leaf node look unarchivable.
        for n in all_nodes:
            if n.parent_id and n.parent_id in by_id and not n.archived:
                child_count[n.parent_id] = child_count.get(n.parent_id, 0) + 1
        visible_ids = {n.id for n in nodes}
        rel_count: dict[str, int] = {}
        for r in rels:
            if r.source_id in visible_ids and r.target_id in visible_ids:
                rel_count[r.source_id] = rel_count.get(r.source_id, 0) + 1
                rel_count[r.target_id] = rel_count.get(r.target_id, 0) + 1
        nodes = sorted(nodes, key=lambda n: (0 if n.parent_id is None else 1,
                                             n.order_index, n.id))
        return {
            "project_revision": p.revision,
            "project": {"id": p.id, "name": p.name, "objective": p.objective,
                        "created_at": p.created_at, "updated_at": p.updated_at,
                        "created_by": p.created_by},
            "nodes": [{
                "id": n.id, "parent_id": n.parent_id, "order_index": n.order_index,
                "kind": n.kind, "title": n.title, "summary": n.summary, "status": n.status,
                "tags": _lj(n.tags), "evidence_count": len(_lj(n.evidence) or []),
                "child_count": child_count.get(n.id, 0),
                "relation_count": rel_count.get(n.id, 0),
                "archived": bool(n.archived),
                "created_at": n.created_at, "updated_at": n.updated_at,
                "created_by": n.created_by,
            } for n in nodes],
        }


# ---------------------------------------------------------------------------
# nodes
# ---------------------------------------------------------------------------

@router.get("/projects/{pid}/nodes/{nid}")
def get_node(pid: str, nid: str) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        n = s.get(Node, nid)
        if n is None or n.project_id != pid:
            raise not_found(f"节点 {nid} 不存在或不属于当前项目")
        all_nodes = {x.id: x for x in s.scalars(select(Node).where(Node.project_id == pid)).all()}
        rel_count = s.execute(select(func.count(Relation.id)).where(
            Relation.project_id == pid, Relation.archived.is_(False),
            (Relation.source_id == nid) | (Relation.target_id == nid))).scalar_one()
        full = node_full(n)
        full["project_revision"] = p.revision
        full["path"] = node_path(all_nodes, n)
        full["relation_count"] = rel_count
        # Same semantics as the graph endpoint: direct NON-archived children.
        # The UI uses this to enforce leaf-only archiving on the client side;
        # the commit engine still enforces it server-side (T09).
        full["child_count"] = sum(
            1 for x in all_nodes.values()
            if x.parent_id == nid and not x.archived
        )
        return full


@router.get("/projects/{pid}/nodes/{nid}/relations")
def node_relations(pid: str, nid: str,
                   limit: int = Query(default=PAGE_DEFAULT, ge=1, le=PAGE_MAX),
                   cursor: Optional[str] = None,
                   include_archived: bool = False) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        n = s.get(Node, nid)
        if n is None or n.project_id != pid:
            raise not_found(f"节点 {nid} 不存在或不属于当前项目")
        q = select(Relation).where(
            Relation.project_id == pid,
            (Relation.source_id == nid) | (Relation.target_id == nid))
        if not include_archived:
            q = q.where(Relation.archived.is_(False))
        rels = sorted(s.scalars(q).all(), key=lambda r: (r.archived, r.id))
        all_nodes = {x.id: x for x in s.scalars(select(Node).where(Node.project_id == pid)).all()}
        version = str(p.revision)
        offset = 0
        if cursor:
            c = _dec_cursor(cursor)
            if c.get("v") != version:
                raise _stale()
            offset = int(c.get("offset", 0))
        page = rels[offset:offset + limit]
        items = []
        for r in page:
            other_id = r.target_id if r.source_id == nid else r.source_id
            other = all_nodes.get(other_id)
            items.append({
                "id": r.id, "kind": r.kind, "reason": r.reason,
                "archived": bool(r.archived),
                "direction": "outgoing" if r.source_id == nid else "incoming",
                "other": ({
                    "id": other.id, "title": other.title, "kind": other.kind,
                    "status": other.status, "archived": bool(other.archived),
                    "path": node_path(all_nodes, other),
                } if other is not None else
                    {"id": other_id, "title": "(端点缺失)", "kind": None, "status": None,
                     "archived": True, "path": []}),
                "created_at": r.created_at, "updated_by": r.updated_by,
            })
        has_more = offset + limit < len(rels)
        return {
            "node_id": nid, "items": items,
            "next_cursor": _enc_cursor({"v": version, "offset": offset + limit}) if has_more else None,
            "has_more": has_more,
        }


# ---------------------------------------------------------------------------
# search
# ---------------------------------------------------------------------------

def _match_q(q_low: str, n: Node, tags: list[str]) -> list[str]:
    hits = []
    if q_low in n.title.lower():
        hits.append("title")
    if q_low in n.summary.lower():
        hits.append("summary")
    if any(q_low in (t or "").lower() for t in tags):
        hits.append("tags")
    if q_low in n.finding.lower():
        hits.append("finding")
    if q_low in n.decision.lower():
        hits.append("decision")
    return hits


@router.get("/projects/{pid}/search")
def search_pid(pid: str,
               q: str = Query(min_length=1, max_length=100),
               limit: int = Query(default=PAGE_DEFAULT, ge=1, le=PAGE_MAX),
               cursor: Optional[str] = None,
               include_archived: bool = False) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        nodes = list(s.scalars(select(Node).where(Node.project_id == pid)).all())
        visible = [n for n in nodes if not n.archived or include_archived]
        by_id = {n.id: n for n in visible}
        q_low = q.strip().lower()
        if not q_low:
            raise AppError(422, "VALIDATION", "搜索关键词不能为空白")
        results = []
        for n in visible:
            hits = _match_q(q_low, n, _lj(n.tags) or [])
            if hits:
                results.append((len(hits), n.id, hits))
        results.sort(key=lambda t: (-t[0], t[1]))
        total = len(results)
        version = str(p.revision)
        offset = 0
        if cursor:
            c = _dec_cursor(cursor)
            if c.get("v") != version or c.get("q") != q_low:
                raise _stale()
            offset = int(c.get("offset", 0))
        page = results[offset:offset + limit]
        items = []
        for _score, nid, hits in page:
            n = by_id[nid]
            items.append({
                "id": n.id, "title": n.title, "kind": n.kind, "status": n.status,
                "summary": n.summary, "matched_fields": hits,
                "path": node_path(by_id, n),
                "updated_at": n.updated_at,
            })
        has_more = offset + limit < total
        return {
            "query": q, "total": total, "items": items,
            "next_cursor": _enc_cursor({"v": version, "q": q_low,
                                        "offset": offset + limit}) if has_more else None,
            "has_more": has_more,
        }


# ---------------------------------------------------------------------------
# commits
# ---------------------------------------------------------------------------

def _commit_item(c: Commit, node_ids: list[str]) -> dict:
    return {
        "id": c.id, "revision": c.revision, "base_revision": c.base_revision,
        "request_id": c.request_id, "actor": c.actor, "client_label": c.client_label,
        "summary": c.summary, "created_at": c.created_at, "node_ids": node_ids,
    }


def _commit_node_ids(s, commit_id: str) -> list[str]:
    rows = s.execute(select(CommitNode.node_id).where(CommitNode.commit_id == commit_id)
                     .order_by(CommitNode.node_id)).all()
    return [r[0] for r in rows]


@router.get("/projects/{pid}/commits")
def list_commits(pid: str,
                 after_revision: int = Query(default=0, ge=0),
                 node_id: Optional[str] = None,
                 limit: int = Query(default=PAGE_DEFAULT, ge=1, le=PAGE_MAX),
                 cursor: Optional[str] = None,
                 before: Optional[str] = None) -> dict:
    """分页变更历史；传 node_id 即“节点历史”（> limit 条可取尽）。

    分页（本响应即文档）：按 revision 降序；取下一页时回传
    `?cursor=<next_cursor>`（携带版本戳，翻页期间项目发生提交 -> 409
    PAGINATION_STALE，要求重新分页）或 `?before=<next_before>`（本页最后一条
    commit id，取严格更早的提交；revision 号不可变，不受项目后续写入影响）。
    两者都提供时返回 400。默认（不带参数）行为不变：最新 limit（50）条。
    """
    with read_session() as s:
        p = _get_project_row(s, pid)
        q = select(Commit).where(Commit.project_id == pid, Commit.revision > after_revision)
        if node_id:
            q = q.join(CommitNode, CommitNode.commit_id == Commit.id
                       ).where(CommitNode.node_id == node_id)
        if cursor is not None and before is not None:
            raise err(400, "BAD_CURSOR", "cursor 与 before 不要同时提供（二选一即可取下一页）")
        if before is not None:
            try:
                uuid.UUID(before)
            except ValueError:
                raise err(400, "BAD_BEFORE", "before 需为 commit id（UUID）")
            bc = s.get(Commit, before)
            if bc is None or bc.project_id != pid:
                raise not_found("before 指向的提交不存在或不属于该项目")
            q = q.where(Commit.revision < bc.revision)
        if cursor:
            c = _dec_cursor(cursor)
            if str(c.get("v")) != str(p.revision):
                raise _stale()
            q = q.where(Commit.revision < int(c["rev"]))
        q = q.order_by(Commit.revision.desc()).limit(limit + 1)
        rows = list(s.scalars(q).all())
        has_more = len(rows) > limit
        page = rows[:limit]
        items = [_commit_item(c, _commit_node_ids(s, c.id)) for c in page]
        next_cursor = (_enc_cursor({"v": p.revision, "rev": page[-1].revision})
                       if has_more and page else None)
        # next_before: 本页最后一条的 commit id，作为下一页的 `before` 光标。
        next_before = (page[-1].id if has_more and page else None)
        return {"items": items, "next_cursor": next_cursor,
                "next_before": next_before, "has_more": has_more}


@router.get("/projects/{pid}/commits/{cid}")
def get_commit(pid: str, cid: str) -> dict:
    with read_session() as s:
        p = _get_project_row(s, pid)
        c = s.get(Commit, cid)
        if c is None or c.project_id != pid:
            raise not_found(f"提交 {cid} 不存在或不属于当前项目")
        item = _commit_item(c, _commit_node_ids(s, cid))
        item.update({
            "operations": _lj(c.operations_json),
            "changes": _lj(c.changes_json),
            "response": _lj(c.response_json),
            "request_hash": c.request_hash,
        })
        return item


# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------

@router.get("/projects/{pid}/export")
def export_project(pid: str) -> dict:
    from .db import now_utc
    with read_session() as s:
        p = _get_project_row(s, pid)
        nodes = list(s.scalars(select(Node).where(Node.project_id == pid)
                               .order_by(Node.parent_id, Node.order_index, Node.id)).all())
        rels = list(s.scalars(select(Relation).where(Relation.project_id == pid)
                              .order_by(Relation.id)).all())
        commits = list(s.scalars(select(Commit).where(Commit.project_id == pid)
                                 .order_by(Commit.revision.asc())).all())
        return {
            "schema_version": 1,
            "exported_at": now_utc(),
            "project_revision": p.revision,
            "project": {"id": p.id, "name": p.name, "objective": p.objective,
                        "revision": p.revision, "created_at": p.created_at,
                        "updated_at": p.updated_at, "created_by": p.created_by},
            "nodes": [node_full(n) | {"project_id": pid} for n in nodes],
            "relations": [
                {"id": r.id, "project_id": pid, "source_id": r.source_id,
                 "target_id": r.target_id, "kind": r.kind, "reason": r.reason,
                 "archived": bool(r.archived), "created_at": r.created_at,
                 "updated_at": r.updated_at, "created_by": r.created_by,
                 "updated_by": r.updated_by} for r in rels],
            "commits": [
                {"id": c.id, "request_id": c.request_id,
                 "base_revision": c.base_revision, "revision": c.revision,
                 "actor": c.actor, "client_label": c.client_label,
                 "summary": c.summary, "created_at": c.created_at,
                 "operations": _lj(c.operations_json), "changes": _lj(c.changes_json)}
                for c in commits],
            "counts": {
                "nodes": len(nodes),
                "nodes_archived": sum(1 for n in nodes if n.archived),
                "relations": len(rels),
                "relations_archived": sum(1 for r in rels if r.archived),
                "commits": len(commits),
                },
        }


# ---------------------------------------------------------------------------
# context / commit writes / session
# ---------------------------------------------------------------------------

@router.get("/projects/{pid}/context")
def get_context(pid: str,
                focus_node_id: Optional[str] = None,
                q: Optional[str] = Query(default=None, max_length=100),
                max_chars: int = Query(default=12000, ge=4000, le=50000)) -> dict:
    # q 与 /search 相同的确定性关键词规则（上限 100，/search 可接受）；
    # 返回的 continuations 会把 q 做 URL 编码后可直接复跑。
    from .context import build_context
    return build_context(pid, focus_node_id, q, max_chars)


@router.post("/projects/{pid}/commits")
async def commit_route(pid: str, request: Request,
                       dry_run: bool = Query(default=False),
                       actor: str = Depends(require_auth)) -> dict:
    data = await read_json_body(request)
    try:
        return submit_commit(actor, pid, data, dry_run)
    except sqlalchemy.exc.OperationalError as e:
        be = safe_sql_op(e)
        raise be if be is not None else AppError(500, "INTERNAL", "数据库错误")


@router.get("/session")
def session_info(actor: str = Depends(require_auth)) -> dict:
    return {"actor": actor, "app_version": __version__}