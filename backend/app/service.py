"""The single write path shared by browser editing and AI commits (SPEC 6).

Invariants enforced here (and nowhere else):
- one commit = one BEGIN IMMEDIATE serialized write boundary covering
  idempotency check → revision check → operation application → commit record;
- all-or-nothing: any invalid op rolls back the whole batch;
- layout columns do not exist in this schema at all — no client can submit
  x/y/pinned (SPEC 5.2).
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid

import sqlalchemy.exc
import sqlite3
from pydantic import ValidationError
from sqlalchemy import select, update

from .db import Session, now_utc, read_session, write_txn
from .errors import AppError, conflict, db_busy, err, invalid, not_found
from .models import Attachment, Commit, CommitNode, Node, Project, Relation
from .schemas import (
    CONFIRMED_STATUSES,
    CommitRequest,
    OpNodeArchive,
    OpNodeCreate,
    OpNodeMove,
    OpNodeRestore,
    OpNodeUpdate,
    OpProjectUpdate,
    OpRelationArchive,
    OpRelationCreate,
    OpRelationRestore,
    OpRelationUpdate,
    ProjectCreate,
)

MAX_DEPTH = 64
_CHANGES_DETAIL_MD_CAP = 500  # audit snapshots truncate very long fields


def _uj(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _lj(s: str):
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def req_hash(req: CommitRequest) -> str:
    return hashlib.sha256(_uj(req.canonical()).encode("utf-8")).hexdigest()


def pydantic_error(e: ValidationError) -> AppError:
    issues = []
    op_index = None
    field_path = None
    for one in e.errors()[:20]:
        loc = [str(p) for p in one["loc"]]
        issues.append({"loc": ".".join(loc), "msg": one.get("msg", ""), "type": one.get("type", "")})
        if loc[:1] == ["operations"] and len(loc) > 2:
            try:
                op_index = int(loc[1])
            except ValueError:
                pass
            field_path = ".".join(loc[2:])
    details: dict = {"issues": issues}
    if op_index is not None:
        details["operation_index"] = op_index
    if field_path:
        details["field"] = field_path
    return AppError(422, "VALIDATION", "请求内容无效", details)


# ---------------------------------------------------------------------------
# lookups
# ---------------------------------------------------------------------------

def _get_project(s: Session, pid: str) -> Project:
    p = s.get(Project, pid)
    if p is None:
        raise not_found(f"项目 {pid} 不存在")
    return p


def _get_node(s: Session, pid: str, nid: str) -> Node:
    n = s.get(Node, nid)
    if n is None or n.project_id != pid:
        raise not_found(f"节点 {nid} 不存在或不属于当前项目")
    return n


def _get_relation(s: Session, pid: str, rid: str) -> Relation:
    r = s.get(Relation, rid)
    if r is None or r.project_id != pid:
        raise not_found(f"关系 {rid} 不存在或不属于当前项目")
    return r


def _is_ancestor(s: Session, ancestor_id: str, node_id: str) -> bool:
    """True when ancestor_id is node_id or one of its ancestors in the main tree."""
    cur: str | None = node_id
    seen: set[str] = set()
    while cur:
        if cur == ancestor_id:
            return True
        if cur in seen:
            raise err(500, "INTERNAL", "数据异常：父链出现环")
        seen.add(cur)
        n = s.get(Node, cur)
        cur = n.parent_id if n is not None else None
    return False


def _node_depth(s: Session, node: Node) -> int:
    depth = 1
    cur: Node | None = node
    seen = {node.id}
    while cur is not None and cur.parent_id:
        if cur.parent_id in seen:
            raise err(500, "INTERNAL", "数据异常：父链出现环")
        parent = s.get(Node, cur.parent_id)
        if parent is None or parent.project_id != node.project_id:
            raise err(500, "INTERNAL", "数据异常：父节点缺失")
        cur = parent
        seen.add(cur.id)
        depth += 1
        if depth > MAX_DEPTH + 2:
            break
    return depth


def _active_siblings(s: Session, pid: str, parent_id: str | None,
                     exclude_id: str | None = None) -> list[Node]:
    q = select(Node).where(Node.project_id == pid, Node.parent_id == parent_id,
                           Node.archived.is_(False))
    if exclude_id:
        q = q.where(Node.id != exclude_id)
    nodes = list(s.scalars(q).all())
    nodes.sort(key=lambda n: (n.order_index, n.id))
    return nodes


_RENUMBER_BASE = 1_000_000  # band far above any real sibling group size


def _renumber_group(s: Session, group: list[Node]) -> None:
    """Persist group positions atomically-safe.

    Setting positions directly (e.g. 1→0 while another row still holds 0)
    violates the (project_id, parent_id, order_index) unique index mid-flush.
    Phase 1 moves everyone into an offset band (uniqueness preserved),
    phase 2 writes the final dense positions.
    """
    for i, n in enumerate(group):
        n.order_index = _RENUMBER_BASE + i
    s.flush()
    for i, n in enumerate(group):
        n.order_index = i
    s.flush()


def _check_confirmed(status: str, scope: str, finding: str, decision: str, evidence: list) -> list[str]:
    if status not in CONFIRMED_STATUSES:
        return []
    missing = []
    if not (scope or "").strip():
        missing.append("scope")
    if not (finding or "").strip():
        missing.append("finding")
    if not (decision or "").strip():
        missing.append("decision")
    if not evidence:
        missing.append("evidence")
    return missing


def _snap(node: Node) -> dict:
    d = {
        "id": node.id, "parent_id": node.parent_id, "order_index": node.order_index,
        "kind": node.kind, "title": node.title, "summary": node.summary,
        "status": node.status, "rationale": node.rationale, "finding": node.finding,
        "decision": node.decision, "scope": node.scope,
        "details_md": node.details_md if len(node.details_md) <= _CHANGES_DETAIL_MD_CAP
        else node.details_md[:_CHANGES_DETAIL_MD_CAP] + f"…[余 {len(node.details_md) - _CHANGES_DETAIL_MD_CAP} 字]",
        "tags": _lj(node.tags), "evidence": _lj(node.evidence),
        "archived": bool(node.archived),
    }
    return d


def _rel_snap(r: Relation) -> dict:
    return {"id": r.id, "source_id": r.source_id, "target_id": r.target_id,
            "kind": r.kind, "reason": r.reason, "archived": bool(r.archived)}


# ---------------------------------------------------------------------------
# plan / change bookkeeping
# ---------------------------------------------------------------------------

class Plan:
    def __init__(self, s: Session, project: Project, actor: str) -> None:
        self.s = s
        self.project = project
        self.actor = actor
        self.changes: list[dict] = []
        self.plan_entries: list[dict] = []
        self.created_node_ids: list[str] = []
        self.updated_node_ids: list[str] = []
        self.moved_node_ids: list[str] = []
        self.archived_node_ids: list[str] = []
        self.restored_node_ids: list[str] = []
        self.created_relation_ids: list[str] = []
        self.updated_relation_ids: list[str] = []
        self.archived_relation_ids: list[str] = []
        self.restored_relation_ids: list[str] = []
        self.node_ids: set[str] = set()
        self.warnings: list[str] = []

    def node(self, op: str, obj_id: str, flash: str) -> None:
        self.plan_entries.append({"op": op, "object_id": obj_id, "effect": flash})
        self.node_ids.add(obj_id)


def _resolve_after(op, nid: str, parent: Node | None, idx: int, plan: Plan) -> tuple:
    """after_id semantics: omitted → append; explicit null → first; UUID → after that sibling."""
    if not getattr(op, "after_id_set", False):
        return ("append", None)
    if op.after_id is None:
        return ("first", None)
    if op.after_id == nid:
        raise invalid("after_id 不能是节点自身", code="AFTER_SELF", operation_index=idx)
    return ("after", op.after_id)


def _verify_after_sibling(s: Session, pid: str, parent: Node | None, after_id: str,
                          self_id: str, idx: int) -> int:
    """Return the index after which to insert; validates the sibling."""
    siblings = _active_siblings(s, pid, parent.id if parent else None, exclude_id=self_id)
    for i, n in enumerate(siblings):
        if n.id == after_id:
            return i + 1
    # after_id unknown / cross-parent / archived
    n = s.get(Node, after_id)
    if n is None or n.project_id != pid:
        raise invalid(f"after_id {after_id} 不存在或不属于当前项目", code="INVALID_AFTER",
                      operation_index=idx)
    if n.parent_id != (parent.id if parent else None):
        raise invalid("after_id 必须位于目标父节点的同一层级", code="INVALID_AFTER_PARENT",
                      operation_index=idx)
    raise invalid(f"after_id {after_id} 已归档，不能作为顺序参照", code="AFTER_ARCHIVED",
                  operation_index=idx)


def _place(s: Session, pid: str, parent: Node | None, target: Node,
           mode: tuple, idx: int, plan: Plan) -> None:
    parent_id = parent.id if parent is not None else None
    siblings = _active_siblings(s, pid, parent_id, exclude_id=target.id)
    if mode[0] == "append":
        pos = len(siblings)
    elif mode[0] == "first":
        pos = 0
    else:
        pos = _verify_after_sibling(s, pid, parent, mode[1], target.id, idx)
    siblings.insert(pos, target)
    _renumber_group(s, siblings)


# ---------------------------------------------------------------------------
# operation appliers
# ---------------------------------------------------------------------------

def op_project_update(plan: Plan, op: OpProjectUpdate, idx: int) -> None:
    fields = {k: v for k, v in op.fields.model_dump().items() if k in op.fields.model_fields_set}
    p = plan.project
    before = {"name": p.name, "objective": p.objective}
    p.name = fields.get("name", p.name)
    p.objective = fields.get("objective", p.objective)
    plan.changes.append({"type": "project.update", "object_id": p.id,
                         "before": before, "after": {"name": p.name, "objective": p.objective}})
    plan.plan_entries.append({"op": "project.update", "object_id": p.id, "effect": "update"})


def op_node_create(plan: Plan, op: OpNodeCreate, idx: int) -> None:
    s = plan.s
    pid = plan.project.id
    if s.get(Node, op.id) is not None:
        raise invalid(f"节点 id {op.id} 已存在", code="ID_TAKEN", operation_index=idx)
    parent = None
    if op.parent_id:
        parent = _get_node(s, pid, op.parent_id, )
        if parent.archived:
            raise invalid(f"父节点 {op.parent_id} 已归档，不能添加子节点",
                          code="PARENT_ARCHIVED", operation_index=idx)
    depth = (_node_depth(s, parent) + 1) if parent is not None else 1
    if depth > MAX_DEPTH:
        raise invalid(f"主树深度超过上限 {MAX_DEPTH}", code="MAX_DEPTH", operation_index=idx)

    # content consistency (SPEC 4.3)
    missing = _check_confirmed(op.status, op.scope, op.finding, op.decision, op.evidence)
    if missing:
        raise invalid(
            f"状态为 {'受支持' if op.status == 'supported' else '不支持'} 时，scope/finding/decision 必须非空且至少一条证据",
            code="STATUS_EVIDENCE_REQUIRED", operation_index=idx, missing=missing)

    mode = _resolve_after(op, op.id, parent, idx, plan)
    now = now_utc()
    node = Node(
        id=op.id, project_id=pid,
        parent_id=parent.id if parent is not None else None,
        order_index=0,
        kind=op.kind, title=op.title.strip() or op.title, summary=op.summary,
        status=op.status, rationale=op.rationale, finding=op.finding,
        decision=op.decision, scope=op.scope, details_md=op.details_md,
        tags=_uj(op.tags), evidence=_uj([e.model_dump(mode="json") for e in op.evidence]),
        archived=False, created_at=now, updated_at=now,
        created_by=plan.actor, updated_by=plan.actor,
    )
    s.add(node)
    # _place finalizes in-memory ordering first; flush only afterwards,
    # otherwise the INSERT lands at the default order_index=0 and can trip
    # the (project_id, order_index) unique index before renumbering.
    _place(s, pid, parent, node, mode, idx, plan)
    plan.s.flush()
    plan.created_node_ids.append(op.id)
    plan.node("node.create", op.id, "create")
    plan.changes.append({"type": "node.create", "object_id": op.id, "after": _snap(node)})
    if not op.summary.strip():
        plan.warnings.append(f"node.create {op.id}: summary 为空")
    if not op.tags:
        plan.warnings.append(f"node.create {op.id}: 未提供 tags")


def op_node_update(plan: Plan, op: OpNodeUpdate, idx: int) -> None:
    s = plan.s
    node = _get_node(s, plan.project.id, op.id)
    before = _snap(node)
    # Explicit nulls treat as not supplied (partial-update semantics); the
    # schema layer already rejects an all-null fields object.
    upd = {k: v for k, v in op.fields.model_dump(mode="json").items()
           if k in op.fields.model_fields_set and v is not None}

    merged_status = upd.get("status", node.status)
    merged_scope = upd.get("scope", node.scope)
    merged_finding = upd.get("finding", node.finding)
    merged_decision = upd.get("decision", node.decision)
    merged_evidence = upd.get("evidence", _lj(node.evidence) or [])
    missing = _check_confirmed(merged_status, merged_scope, merged_finding,
                               merged_decision, merged_evidence)
    if missing:
        raise invalid(
            f"状态为 supported/not_supported 时，以下字段必须齐备: {', '.join(missing)}",
            code="STATUS_EVIDENCE_REQUIRED", operation_index=idx, missing=missing)

    if "kind" in upd:
        node.kind = upd["kind"]
    if "title" in upd:
        node.title = upd["title"].strip()
    if "summary" in upd:
        node.summary = upd["summary"]
    if "status" in upd:
        node.status = upd["status"]
    for f in ("rationale", "finding", "decision", "scope", "details_md"):
        if f in upd:
            setattr(node, f, upd[f])
    if "tags" in upd:
        node.tags = _uj(upd["tags"])
    if "evidence" in upd:
        node.evidence = _uj(upd["evidence"])
    node.updated_at = now_utc()
    node.updated_by = plan.actor
    after = _snap(node)
    diff = {k: {"before": before[k], "after": after[k]} for k in before if before[k] != after[k]}
    plan.changes.append({"type": "node.update", "object_id": node.id, "changed": diff})
    plan.updated_node_ids.append(node.id)
    plan.node("node.update", node.id, "update")


def op_node_move(plan: Plan, op: OpNodeMove, idx: int) -> None:
    s = plan.s
    pid = plan.project.id
    node = _get_node(s, pid, op.id)
    if node.archived:
        raise invalid("不能移动已归档节点，请执行 node.restore", code="MOVE_ARCHIVED",
                      operation_index=idx)
    if op.parent_id == node.id:
        raise invalid("节点不能成为自己的父节点", code="MOVE_TO_SELF", operation_index=idx)
    if op.parent_id and _is_ancestor(s, node.id, op.parent_id):
        raise invalid("不能把节点移动到它的子孙之下（主树必须无环）", code="MOVE_CYCLE",
                      operation_index=idx)
    parent = None
    if op.parent_id:
        parent = _get_node(s, pid, op.parent_id)
        if parent.archived:
            raise invalid(f"目标父节点 {op.parent_id} 已归档", code="PARENT_ARCHIVED",
                          operation_index=idx)
    depth = (_node_depth(s, parent) + 1) if parent is not None else 1
    if depth > MAX_DEPTH:
        raise invalid(f"移动后主树深度超过上限 {MAX_DEPTH}", code="MAX_DEPTH", operation_index=idx)

    before = _snap(node)
    old_parent = node.parent_id
    new_parent_id = parent.id if parent is not None else None
    mode = _resolve_after(op, node.id, parent, idx, plan)
    # Swap parent AND order in one statement; the order moves to a
    # transition slot in the reserved band, so no intermediate row pair
    # hits the (project_id, parent_id, order_index) unique index.
    node.parent_id = new_parent_id
    node.order_index = _RENUMBER_BASE + 997
    s.flush()
    if old_parent is not None and old_parent != new_parent_id:
        # 原同级组补位重排（两阶段，防中态唯一约束冲突）
        old_grp = _active_siblings(s, pid, old_parent)
        _renumber_group(s, old_grp)
    # 目标组：抽出后按显式位置插回
    grp = _active_siblings(s, pid, new_parent_id)
    node_i = next(n for n in grp if n.id == node.id)
    grp.remove(node_i)
    if mode[0] == "append":
        pos = len(grp)
    elif mode[0] == "first":
        pos = 0
    else:
        pos = _verify_after_sibling(s, pid, parent, mode[1], node.id, idx)
    grp.insert(pos, node_i)
    _renumber_group(s, grp)
    node.updated_at = now_utc()
    node.updated_by = plan.actor
    if node.parent_id != before["parent_id"] or node.order_index != before["order_index"]:
        plan.changes.append({"type": "node.move", "object_id": node.id,
                             "before": {k: before[k] for k in ("parent_id", "order_index")},
                             "after": {k: _snap(node)[k] for k in ("parent_id", "order_index")}})
        if old_parent != new_parent_id:
            plan.moved_node_ids.append(node.id)
    plan.node("node.move", node.id, "move")
    order_entries = []
    final_grp = _active_siblings(s, pid, new_parent_id)
    order_entries.append({"parent_id": new_parent_id,
                          "order_after": {n.id: n.order_index for n in final_grp}})
    if old_parent is not None and old_parent != new_parent_id:
        order_entries.append({"parent_id": old_parent,
                              "order_after": {n.id: n.order_index for n in
                                              _active_siblings(s, pid, old_parent)}})
    plan.changes.append({"type": "order", "object": node.id, "groups": order_entries})


def op_node_archive(plan: Plan, op: OpNodeArchive, idx: int) -> None:
    s = plan.s
    node = _get_node(s, plan.project.id, op.id)
    if node.archived:
        raise invalid("节点已处于归档状态", code="ALREADY_ARCHIVED", operation_index=idx)
    children = list(s.scalars(
        select(Node).where(Node.project_id == node.project_id,
                           Node.parent_id == node.id, Node.archived.is_(False))
    ).all())
    if children:
        raise invalid(
            f"节点存在 {len(children)} 个未归档子节点，不能归档；请先移动或归档这些子节点（不提供级联删除）",
            code="ARCHIVE_HAS_CHILDREN", operation_index=idx, child_count=len(children))
    before = _snap(node)
    node.archived = True
    node.updated_at = now_utc()
    node.updated_by = plan.actor
    plan.changes.append({"type": "node.archive", "object_id": node.id,
                         "before": {"archived": False}, "after": {"archived": True},
                         "reason": op.reason})
    plan.archived_node_ids.append(node.id)
    plan.node("node.archive", node.id, "archive")


def op_node_restore(plan: Plan, op: OpNodeRestore, idx: int) -> None:
    s = plan.s
    node = _get_node(s, plan.project.id, op.id)
    if not node.archived:
        raise invalid("节点未归档，不能恢复", code="NOT_ARCHIVED", operation_index=idx)
    if node.parent_id:
        parent = s.get(Node, node.parent_id)
        if parent is not None and parent.archived:
            raise invalid(
                f"父节点 {node.parent_id} 已归档，不能直接恢复子节点；请先恢复或移动父节点",
                code="PARENT_ARCHIVED", operation_index=idx)
    before = _snap(node)
    node.archived = False
    node.updated_at = now_utc()
    node.updated_by = plan.actor
    # 恢复到同级末尾（确定性；顺序可再调整）
    grp = _active_siblings(s, node.project_id, node.parent_id)
    cnt = len(grp)
    node.order_index = cnt
    _renumber_group(s, grp + [node])
    plan.changes.append({"type": "node.restore", "object_id": node.id,
                         "before": {"archived": True}, "after": {"archived": False},
                         "reason": op.reason})
    plan.restored_node_ids.append(node.id)
    plan.node("node.restore", node.id, "restore")


def _relation_duplicate(s: Session, pid: str, source_id: str, target_id: str, kind: str,
                        exclude_rid: str | None = None) -> Relation | None:
    if kind == "related":
        a, b = sorted([source_id, target_id])
        q = (select(Relation)
             .where(Relation.project_id == pid, Relation.kind == "related",
                    Relation.archived.is_(False))
             .where(((Relation.source_id == a) & (Relation.target_id == b)) |
                    ((Relation.source_id == b) & (Relation.target_id == a))))
    else:
        q = (select(Relation)
             .where(Relation.project_id == pid, Relation.source_id == source_id,
                    Relation.target_id == target_id, Relation.kind == kind,
                    Relation.archived.is_(False)))
    if exclude_rid:
        q = q.where(Relation.id != exclude_rid)
    return s.scalars(q).first()


def op_relation_create(plan: Plan, op: OpRelationCreate, idx: int) -> None:
    s = plan.s
    pid = plan.project.id
    if s.get(Relation, op.id) is not None:
        raise invalid(f"关系 id {op.id} 已存在", code="ID_TAKEN", operation_index=idx)
    src = _get_node(s, pid, op.source_id)
    tgt = _get_node(s, pid, op.target_id)
    if src.id == tgt.id:
        raise invalid("关系两端不能是同一节点", code="SELF_RELATION", operation_index=idx)
    if src.archived or tgt.archived:
        raise invalid("关系端点必须是未归档节点", code="ENDPOINT_ARCHIVED", operation_index=idx)

    dup = _relation_duplicate(s, pid, src.id, tgt.id, op.kind)
    if dup is not None:
        raise conflict(
            f"相同端点与类型的未归档关系已存在（{dup.id}）；如要修改请先恢复/更新既有关系，"
            "不要创建冗余箭头",
            code="DUPLICATE_RELATION",
            existing_relation_id=dup.id,
            hint="可改用 relation.restore 恢复同名归档关系，或创建不同类型/不同端点的新关系")
    # 提示：存在同三元组的归档关系
    if op.kind == "related":
        a, b = sorted([src.id, tgt.id])
        arch_q = select(Relation).where(
            Relation.project_id == pid, Relation.kind == "related", Relation.archived.is_(True),
            (((Relation.source_id == a) & (Relation.target_id == b)) |
             ((Relation.source_id == b) & (Relation.target_id == a))))
    else:
        arch_q = select(Relation).where(
            Relation.project_id == pid, Relation.source_id == src.id,
            Relation.target_id == tgt.id, Relation.kind == op.kind,
            Relation.archived.is_(True))
    arch_dup = s.scalars(arch_q).first()
    if arch_dup is not None:
        plan.warnings.append(
            f"relation.create {op.id}: 存在同端点同类型的归档关系 {arch_dup.id}；"
            "若为复活原关系，relation.restore 更合适")

    now = now_utc()
    rel = Relation(id=op.id, project_id=pid, source_id=src.id, target_id=tgt.id,
                   kind=op.kind, reason=op.reason, archived=False,
                   created_at=now, updated_at=now,
                   created_by=plan.actor, updated_by=plan.actor)
    s.add(rel)
    s.flush()
    plan.created_relation_ids.append(op.id)
    plan.changes.append({"type": "relation.create", "object_id": op.id, "after": _rel_snap(rel)})
    plan.plan_entries.append({"op": "relation.create", "object_id": op.id, "effect": "create"})
    for nid in (src.id, tgt.id):
        plan.node_ids.add(nid)


def op_relation_update(plan: Plan, op: OpRelationUpdate, idx: int) -> None:
    s = plan.s
    rel = _get_relation(s, plan.project.id, op.id)
    if rel.archived:
        raise invalid("关系已归档，不能直接修改；请先 relation.restore 再修改",
                      code="RELATION_ARCHIVED", operation_index=idx)
    before = _rel_snap(rel)
    upd = {k: v for k, v in op.fields.model_dump().items() if k in op.fields.model_fields_set}
    if "kind" in upd and upd["kind"] is not None:
        if upd["kind"] != rel.kind:
            dup = _relation_duplicate(s, rel.project_id, rel.source_id, rel.target_id,
                                      upd["kind"], exclude_rid=rel.id)
            if dup is not None:
                raise conflict("更改类型后会与既有未归档关系重复", code="DUPLICATE_RELATION",
                               operation_index=idx, existing_relation_id=dup.id)
        rel.kind = upd["kind"]
    if "reason" in upd:
        rel.reason = upd["reason"]
    rel.updated_at = now_utc()
    rel.updated_by = plan.actor
    plan.changes.append({"type": "relation.update", "object_id": rel.id,
                         "before": before, "after": _rel_snap(rel)})
    plan.updated_relation_ids.append(rel.id)
    plan.plan_entries.append({"op": "relation.update", "object_id": rel.id, "effect": "update"})


def op_relation_archive(plan: Plan, op: OpRelationArchive, idx: int) -> None:
    s = plan.s
    rel = _get_relation(s, plan.project.id, op.id)
    if rel.archived:
        raise invalid("关系已处于归档状态", code="ALREADY_ARCHIVED", operation_index=idx)
    before = _rel_snap(rel)
    rel.archived = True
    rel.updated_at = now_utc()
    rel.updated_by = plan.actor
    plan.changes.append({"type": "relation.archive", "object_id": rel.id,
                         "before": before, "after": _rel_snap(rel), "reason": op.reason})
    plan.archived_relation_ids.append(rel.id)
    plan.plan_entries.append({"op": "relation.archive", "object_id": rel.id, "effect": "archive"})


def op_relation_restore(plan: Plan, op: OpRelationRestore, idx: int) -> None:
    s = plan.s
    rel = _get_relation(s, plan.project.id, op.id)
    if not rel.archived:
        raise invalid("关系未归档，不能恢复", code="NOT_ARCHIVED", operation_index=idx)
    src = _get_node(s, plan.project.id, rel.source_id)
    tgt = _get_node(s, plan.project.id, rel.target_id)
    if src.archived or tgt.archived:
        raise invalid("关系两端必须均为未归档节点才能恢复", code="ENDPOINT_ARCHIVED",
                      operation_index=idx)
    before = _rel_snap(rel)
    rel.archived = False
    rel.updated_at = now_utc()
    rel.updated_by = plan.actor
    plan.changes.append({"type": "relation.restore", "object_id": rel.id,
                         "before": before, "after": _rel_snap(rel), "reason": op.reason})
    plan.restored_relation_ids.append(rel.id)
    plan.plan_entries.append({"op": "relation.restore", "object_id": rel.id, "effect": "restore"})


_APPLIERS = {
    "project.update": op_project_update,
    "node.create": op_node_create,
    "node.update": op_node_update,
    "node.move": op_node_move,
    "node.archive": op_node_archive,
    "node.restore": op_node_restore,
    "relation.create": op_relation_create,
    "relation.update": op_relation_update,
    "relation.archive": op_relation_archive,
    "relation.restore": op_relation_restore,
}


def _apply_operations(plan: Plan, req: CommitRequest) -> None:
    for i, op in enumerate(req.operations):
        _APPLIERS[op.op](plan, op, i)


def _build_response(commit_id: str, req: CommitRequest, base_rev: int, new_rev: int,
                    plan: Plan, already_committed: bool = False) -> dict:
    base = plan is not None
    return {
        "commit_id": commit_id,
        "request_id": req.request_id,
        "revision": new_rev,
        "base_revision": base_rev,
        "created_node_ids": plan.created_node_ids if base else [],
        "updated_node_ids": plan.updated_node_ids if base else [],
        "moved_node_ids": plan.moved_node_ids if base else [],
        "archived_node_ids": plan.archived_node_ids if base else [],
        "restored_node_ids": plan.restored_node_ids if base else [],
        "created_relation_ids": plan.created_relation_ids if base else [],
        "updated_relation_ids": plan.updated_relation_ids if base else [],
        "archived_relation_ids": plan.archived_relation_ids if base else [],
        "restored_relation_ids": plan.restored_relation_ids if base else [],
        "warnings": plan.warnings if base else [],
        "already_committed": already_committed,
    }


def _replay_saved(commit: Commit) -> dict:
    saved = _lj(commit.response_json) or {}
    saved["already_committed"] = True
    return saved


# ---------------------------------------------------------------------------
# public entry points
# ---------------------------------------------------------------------------

def create_project(actor: str, raw: dict) -> dict:
    try:
        body = ProjectCreate.model_validate(raw)
    except ValidationError as e:
        raise pydantic_error(e)
    h = hashlib.sha256(_uj({"name": body.name, "objective": body.objective})
                       .encode("utf-8")).hexdigest()

    def _replay(s: Session):
        existing = s.execute(select(Project).where(
            Project.create_request_id == body.request_id)).scalar_one_or_none()
        if existing is None:
            return None
        if existing.create_request_hash == h and existing.created_by == actor:
            return {"id": existing.id, "revision": existing.revision,
                    "name": existing.name, "already_committed": True}
        raise conflict("该 request_id 已被不同的创建请求使用",
                       code="IDEMPOTENCY_KEY_REUSED",
                       details={"request_id": body.request_id})

    with read_session() as s:
        replay = _replay(s)
        if replay is not None:
            return replay

    with write_txn() as s:
        replay = _replay(s)
        if replay is not None:
            return replay
        pid = str(uuid.uuid4())
        now = now_utc()
        s.add(Project(id=pid, name=body.name, objective=body.objective, revision=0,
                      created_at=now, updated_at=now, created_by=actor,
                      create_request_id=body.request_id, create_request_hash=h))
        s.flush()
    return {"id": pid, "revision": 0}


def submit_commit(actor: str, project_id: str, raw: dict, dry_run: bool) -> dict:
    try:
        req = CommitRequest.model_validate(raw)
    except ValidationError as e:
        raise pydantic_error(e)
    h = req_hash(req)

    if dry_run:
        # Pre-check only: never persists (SPEC 6.3). Uses a plain session that
        # is always rolled back.
        s = _fresh_session()
        try:
            project = _get_project(s, project_id)
            existing = s.execute(select(Commit).where(
                Commit.project_id == project_id,
                Commit.request_id == req.request_id)).scalar_one_or_none()
            if existing is not None:
                if existing.request_hash == h:
                    return {
                        "dry_run": True, "request_id": req.request_id,
                        "project_revision": project.revision,
                        "already_committed": True,
                        "committed": _lj(existing.response_json) or {},
                    }
                raise conflict("该 request_id 已被不同的提交内容使用",
                               code="IDEMPOTENCY_KEY_REUSED")
            if req.expected_revision != project.revision:
                raise conflict("版本不一致", code="REVISION_CONFLICT",
                               expected_revision=req.expected_revision,
                               current_revision=project.revision)
            plan = Plan(s, project, actor)
            _apply_operations(plan, req)
            result = {
                "dry_run": True,
                "request_id": req.request_id,
                "project_revision": project.revision,
                "revision_if_committed": project.revision + 1,
                "plan": plan.plan_entries,
                "warnings": plan.warnings,
            }
        finally:
            s.rollback()
            s.close()
        return result

    base_rev = None
    commit_id = str(uuid.uuid4())
    with write_txn() as s:
        project = _get_project(s, project_id)

        # 1) idempotency first (SPEC 6.2)
        existing = s.execute(select(Commit).where(
            Commit.project_id == project_id,
            Commit.request_id == req.request_id)).scalar_one_or_none()
        if existing is not None:
            if existing.request_hash == h:
                return _replay_saved(existing)
            raise conflict("该 request_id 已被不同的提交内容使用",
                           code="IDEMPOTENCY_KEY_REUSED",
                           existing_commit_id=existing.id)

        # 2) version check inside the serialized write boundary
        if req.expected_revision != project.revision:
            raise conflict("项目版本不一致，请载入最新版本后重试（保持相同 request_id）",
                           code="REVISION_CONFLICT",
                           expected_revision=req.expected_revision,
                           current_revision=project.revision)

        base_rev = project.revision
        plan = Plan(s, project, actor)
        # 3) apply all-or-nothing
        _apply_operations(plan, req)
        # D 批 §9.2: 本提交正文里引用到的 staged 附件 → attached（同事务）。
        # 幂等：已 attached 的行本语句为 no-op。
        _flip_referenced_attachments(s, project_id, req)

        # 4) commit record + revision bump
        new_rev = base_rev + 1
        project.revision = new_rev
        project.updated_at = now_utc()
        response = _build_response(commit_id, req, base_rev, new_rev, plan)
        s.add(Commit(
            id=commit_id, project_id=project_id, request_id=req.request_id,
            request_hash=h, base_revision=base_rev, revision=new_rev,
            actor=actor, client_label=req.client_label, summary=req.summary,
            operations_json=_uj([op.model_dump(mode="json") for op in req.operations]),
            changes_json=_uj(plan.changes), response_json=_uj(response),
            created_at=now_utc(),
        ))
        s.add_all(CommitNode(commit_id=commit_id, node_id=n) for n in sorted(plan.node_ids))
        s.flush()
    return response


# ---------------------------------------------------------------------------
# D 批 §9.2: staged → attached 翻转（同提交事务内，四项保护不受影响）
# ---------------------------------------------------------------------------

_ATTACHMENT_REF = re.compile(r"attachment:([0-9a-fA-F-]{36})")


def _flip_referenced_attachments(s: Session, project_id: str, req) -> None:
    """扫描本次 node.create / node.update 的 details_md 与 evidence.value 中的
    `attachment:<uuid>` 引用，把属于本项目、仍处 staged 的附件翻成 attached。
    幂等；引用了不存在/他项目的附件不报错（渲染端自然 404，回执已注明）。"""
    ids: set[str] = set()
    for op in req.operations:
        kind = getattr(op, "op", None)
        if kind not in ("node.create", "node.update"):
            continue
        # node.create 是平铺字段；node.update 的字段包在 .fields 里（partial 语义）
        carrier = op if kind == "node.create" else op.fields
        texts = [getattr(carrier, "details_md", "") or ""]
        for ev in getattr(carrier, "evidence", None) or []:
            texts.append(getattr(ev, "value", "") or "")
            texts.append(getattr(ev, "note", "") or "")
        for t in texts:
            ids.update(_ATTACHMENT_REF.findall(t))
    if not ids:
        return
    s.execute(
        update(Attachment)
        .where(Attachment.id.in_(ids),
               Attachment.project_id == project_id,
               Attachment.state == "staged")
        .values(state="attached"),
    )


def _fresh_session():
    from .db import SessionLocal
    return SessionLocal()


def safe_sql_op(e: sqlalchemy.exc.OperationalError) -> AppError | None:
    msg = str(e.orig or e).lower()
    if "locked" in msg or "busy" in msg:
        return db_busy()
    return None