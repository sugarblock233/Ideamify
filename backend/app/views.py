"""Read endpoints (SPEC 7.1) plus the commit entry points.

Every response is built inside one read transaction (single WAL snapshot) so a
graph/export/context response never mixes two revisions (SPEC 7.1).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import sqlalchemy.exc
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from . import __version__
from .auth import require_auth
from .config import get_settings
from .config import MAX_BODY_BYTES
from .db import read_session
from .db import write_txn as _write_txn
from .errors import AppError, err, not_found
from .models import (
    Attachment,
    Commit,
    CommitNode,
    Node,
    NodeVersionAssignment,
    Project,
    Relation,
    ResearchVersion,
)
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


def node_full(n: Node, version_ids: list[str] | None = None) -> dict:
    return {
        "id": n.id, "parent_id": n.parent_id, "order_index": n.order_index,
        "kind": n.kind, "title": n.title, "summary": n.summary, "status": n.status,
        "rationale": n.rationale, "finding": n.finding, "decision": n.decision,
        "scope": n.scope, "details_md": n.details_md,
        "tags": _lj(n.tags), "evidence": _lj(n.evidence),
        "version_ids": version_ids if version_ids is not None else [],
        "archived": bool(n.archived),
        "created_at": n.created_at, "updated_at": n.updated_at,
        "created_by": n.created_by, "updated_by": n.updated_by,
    }


def _version_rows(s, pid: str) -> list[ResearchVersion]:
    """项目内全部科研版本，按展示顺序（order_index, created_at, id）。"""
    vs = list(s.scalars(select(ResearchVersion)
                        .where(ResearchVersion.project_id == pid)).all())
    vs.sort(key=lambda v: (v.order_index, v.created_at, v.id))
    return vs


def _assignment_map(s, pid: str) -> dict[str, list[str]]:
    """node_id → 该节点归属的版本 id 列表（按版本展示顺序）。"""
    rows = s.execute(
        select(NodeVersionAssignment.node_id, ResearchVersion.order_index,
               ResearchVersion.created_at, ResearchVersion.id)
        .join(ResearchVersion, ResearchVersion.id == NodeVersionAssignment.version_id)
        .where(NodeVersionAssignment.project_id == pid)
        .order_by(ResearchVersion.order_index, ResearchVersion.created_at,
                  ResearchVersion.id)
    ).all()
    m: dict[str, list[str]] = {}
    for row in rows:
        m.setdefault(row[0], []).append(row[3])
    return m


def _version_records(vs: list[ResearchVersion]) -> list[dict]:
    return [{"id": v.id, "name": v.name, "order_index": v.order_index,
             "description": v.description, "archived": bool(v.archived),
             "created_at": v.created_at, "updated_at": v.updated_at}
            for v in vs]


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
        # E 批 §7：科研版本列表 + 每节点归属（响应根部的 versions 与节点行
        # version_ids 属于同一快照）
        versions = _version_rows(s, pid)
        assigns = _assignment_map(s, pid)
        return {
            "project_revision": p.revision,
            "project": {"id": p.id, "name": p.name, "objective": p.objective,
                        "created_at": p.created_at, "updated_at": p.updated_at,
                        "created_by": p.created_by},
            "versions": _version_records(versions),
            "nodes": [{
                "id": n.id, "parent_id": n.parent_id, "order_index": n.order_index,
                "kind": n.kind, "title": n.title, "summary": n.summary, "status": n.status,
                "tags": _lj(n.tags), "evidence_count": len(_lj(n.evidence) or []),
                "child_count": child_count.get(n.id, 0),
                "relation_count": rel_count.get(n.id, 0),
                "version_ids": assigns.get(n.id, []),
                "archived": bool(n.archived),
                "created_at": n.created_at, "updated_at": n.updated_at,
                "created_by": n.created_by,
            } for n in nodes],
        }


# ---------------------------------------------------------------------------
# nodes
# ---------------------------------------------------------------------------

@router.get("/projects/{pid}/versions")
def list_versions(pid: str) -> dict:
    """科研版本标签列表（E 批 §7；只呈现，不做时间旅行）。"""
    with read_session() as s:
        p = _get_project_row(s, pid)
        return {"project_revision": p.revision,
                "versions": _version_records(_version_rows(s, pid))}


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
        full = node_full(n, _assignment_map(s, pid).get(nid, []))
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
        # D4: 附件元数据随导出（字节文件不入 JSON 导出——进备份包，见 docs/DECISIONS §18）
        atts = list(s.scalars(select(Attachment).where(Attachment.project_id == pid)
                              .order_by(Attachment.created_at, Attachment.id)).all())
        # E 批：科研版本与归属随导出（schema_version 2→3）
        versions = _version_rows(s, pid)
        assigns = _assignment_map(s, pid)
        return {
            "schema_version": 3,
            "exported_at": now_utc(),
            "project_revision": p.revision,
            "project": {"id": p.id, "name": p.name, "objective": p.objective,
                        "revision": p.revision, "created_at": p.created_at,
                        "updated_at": p.updated_at, "created_by": p.created_by},
            "nodes": [node_full(n, assigns.get(n.id, [])) | {"project_id": pid}
                      for n in nodes],
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
            "attachments": [_att_record(a) for a in atts],
            "versions": [{"id": v.id, "name": v.name, "order_index": v.order_index,
                          "description": v.description, "archived": bool(v.archived),
                          "created_at": v.created_at, "updated_at": v.updated_at,
                          "created_by": v.created_by} for v in versions],
            "node_version_assignments": [
                {"node_id": nid, "version_id": vid, "project_id": pid}
                for nid, vids in sorted(assigns.items()) for vid in vids],
            "counts": {
                "nodes": len(nodes),
                "nodes_archived": sum(1 for n in nodes if n.archived),
                "relations": len(rels),
                "relations_archived": sum(1 for r in rels if r.archived),
                "commits": len(commits),
                "attachments": len(atts),
                "versions": len(versions),
                },
        }


# ---------------------------------------------------------------------------
# managed attachments (D 批 §9.2)
#
# 引用语法 `![alt](attachment:<uuid>)` 也允许出现在 evidence.value 里。字节
# 永远存在 RESEARCHMAP_STORAGE 目录（文件名 = id），数据库只放元数据；Bearer
# 令牌只走 Authorization 头，永远不出现在图片 URL 上（前端用 fetch+objectURL）。
# ---------------------------------------------------------------------------

ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024   # 单文件 10MB（2 MiB 全局 JSON 闸仅对此路径豁免）
ATTACHMENT_MAX_PIXELS = 8000              # 单边像素上限
ATTACHMENT_GC_DAYS = 30                   # staged 且引用不到、超 30 天 → 上传时顺带回收
ATTACHMENT_REF = re.compile(r"attachment:([0-9a-fA-F-]{36})")


def _att_record(a: Attachment) -> dict:
    return {
        "id": a.id, "project_id": a.project_id, "mime": a.mime, "bytes": a.bytes,
        "sha256": a.sha256, "width": a.width, "height": a.height,
        "original_name": a.original_name, "state": a.state,
        "created_by": a.created_by, "created_at": a.created_at,
    }


def _storage_path(aid: str) -> str:
    return os.path.join(get_settings().storage_dir, aid)


def _gc_stale_staged(s) -> int:
    """上传事务顺带的 GC：staged、超 30 天、且没有任何节点正文引用的行删除
    （行 + 文件）。attached 永不删；无后台线程——回收成本挂在下一次上传上。"""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=ATTACHMENT_GC_DAYS)).strftime(
        "%Y-%m-%dT%H:%M:%S")
    rows = list(s.scalars(select(Attachment).where(
        Attachment.state == "staged", Attachment.created_at < cutoff)))
    removed = 0
    for a in rows:
        referenced = s.execute(
            select(func.count()).select_from(Node).where(
                Node.project_id == a.project_id,
                (Node.details_md.like(f"%attachment:{a.id}%")) |
                (Node.evidence.like(f"%attachment:{a.id}%"))),
        ).scalar_one()
        if referenced:
            continue
        s.delete(a)
        try:
            os.remove(_storage_path(a.id))
        except OSError:
            pass
        removed += 1
    return removed


@router.post("/projects/{pid}/attachments")
async def upload_attachment(pid: str, file: UploadFile = File(...),
                            actor: str = Depends(require_auth)) -> dict:
    import io as _io
    from .db import now_utc
    with read_session() as s:
        _get_project_row(s, pid)
    raw = await file.read()
    if len(raw) > ATTACHMENT_MAX_BYTES:
        raise err(413, "REQUEST_TOO_LARGE",
                  f"附件超过 {ATTACHMENT_MAX_BYTES // (1024 * 1024)}MB 上限")
    if not raw:
        raise AppError(422, "VALIDATION", "附件内容为空")
    mime = (file.content_type or "").split(";")[0].strip().lower()
    if not mime.startswith("image/"):
        raise AppError(422, "VALIDATION", "受管附件目前仅接受图片（mime 必须是 image/*）")
    # Pillow 决定尺寸并顺便验证内容确实是可解码图片（伪装扩展名/图片头的
    # 二进制在此被 422 拦下）
    try:
        from PIL import Image, UnidentifiedImageError
        with Image.open(_io.BytesIO(raw)) as im:
            width, height = im.size
    except ImportError:
        raise AppError(500, "INTERNAL", "服务端缺少 Pillow，无法处理图片附件")
    except (UnidentifiedImageError, OSError, ValueError) as e:
        raise AppError(422, "VALIDATION", f"无法解码的图片附件: {e}")
    if width > ATTACHMENT_MAX_PIXELS or height > ATTACHMENT_MAX_PIXELS:
        raise AppError(422, "VALIDATION",
                       f"图片尺寸 {width}x{height} 超过 {ATTACHMENT_MAX_PIXELS}px 上限")
    digest = hashlib.sha256(raw).hexdigest()

    with _write_txn() as s:
        _get_project_row(s, pid)
        # 同内容幂等：同项目同 sha256 直接返回已存在的行（不重复落盘）
        existing = s.execute(select(Attachment).where(
            Attachment.project_id == pid, Attachment.sha256 == digest,
        )).scalar_one_or_none()
        if existing is not None:
            return _att_record(existing)
        _gc_stale_staged(s)
        aid = str(uuid.uuid4())
        os.makedirs(get_settings().storage_dir, exist_ok=True)
        tmp = _storage_path(aid + ".part")
        with open(tmp, "wb") as f:
            f.write(raw)
        os.replace(tmp, _storage_path(aid))
        row = Attachment(
            id=aid, project_id=pid, mime=mime, bytes=len(raw), sha256=digest,
            width=width, height=height, original_name=file.filename,
            state="staged", created_by=actor, created_at=now_utc(),
        )
        s.add(row)
        s.flush()
        return _att_record(row)


@router.get("/projects/{pid}/attachments")
def list_attachments(pid: str,
                     limit: int = Query(default=200, ge=1, le=1000),
                     cursor: Optional[str] = None) -> dict:
    """元数据列表（staged + attached）。与 commits 分页同约定：cursor 携带版
    本戳，翻页期间项目发生提交 → 409 PAGINATION_STALE。"""
    with read_session() as s:
        p = _get_project_row(s, pid)
        q = select(Attachment).where(Attachment.project_id == pid)
        if cursor:
            c = _dec_cursor(cursor)
            if str(c.get("v")) != str(p.revision):
                raise _stale()
            q = q.where((Attachment.created_at, Attachment.id) <=
                        (c["created_at"], c["id"]))
        q = q.order_by(Attachment.created_at.desc(), Attachment.id).limit(limit + 1)
        rows = list(s.scalars(q).all())
        has_more = len(rows) > limit
        page = rows[:limit]
        next_cursor = (_enc_cursor({"v": p.revision, "created_at": page[-1].created_at,
                                    "id": page[-1].id})
                       if has_more and page else None)
        return {"items": [_att_record(a) for a in page],
                "next_cursor": next_cursor, "has_more": has_more}


@router.get("/attachments/{aid}")
def get_attachment_bytes(aid: str) -> FileResponse:
    with read_session() as s:
        a = s.get(Attachment, aid)
        if a is None or not os.path.isfile(_storage_path(aid)):
            raise not_found("附件不存在")
        path = _storage_path(aid)
        mime = a.mime
        sha = a.sha256
    # 字节按 id 即可达（id 是不可枚举的 uuid + 路由要求 Bearer）；不做项目级
    # 二次校验——不提供任何列举他人附件的通道（DECISIONS §18）
    return FileResponse(path, media_type=mime, headers={"ETag": f'"{sha}"'})


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