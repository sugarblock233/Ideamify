"""Deterministic context builder for external AI (SPEC 7.2).

No built-in LLM, no pseudo-semantic retrieval. A fixed priority order over
structured data, a Unicode-character budget, explicit truncation markers,
omitted counts and continuations. One WAL snapshot per response, so every
value here belongs to the same project revision.

Response groups (empty groups are empty arrays, never omitted):
related_nodes, prior_attempts, open_nodes, routes, recent_findings, matched,
recent_changes — plus project_revision / project / focus / ancestor_path /
truncated / omitted_counts / continuations / warnings.
"""

from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import select

from .db import read_session
from .errors import AppError, not_found
from .models import Commit, Node, Project, Relation

MIN_CHARS = 4000
MAX_CHARS = 50000
_MARK = "…[截断]"

STATUS_ZH = {
    "unexplored": "未探索", "in_progress": "进行中", "promising": "有积极迹象",
    "supported": "当前条件下支持", "not_supported": "当前条件下不支持",
    "inconclusive": "尚不能判断",
}
KIND_ZH = {"question": "问题", "idea": "想法", "attempt": "尝试", "finding": "发现"}
REL_PRIORITY = {"contradicts": 0, "depends_on": 1, "supports": 2, "motivates": 3, "related": 4}

# 各分组被放弃读取时的继续查询指引（按优先级从高到低，关键词命中前）
_GROUP_CONT: dict[str, str] = {
    "related_nodes": "GET /api/v1/projects/{pid}/nodes/{focus}/relations?limit=100 （全部直接关联，分页）",
    "prior_attempts": "GET /api/v1/projects/{pid}/search?q=失败 或按被省略节点 id 定位",
    "open_nodes": "GET /api/v1/projects/{pid}/graph 查看完整结构",
    "routes": "GET /api/v1/projects/{pid}/graph 查看全部一级路线",
    "recent_findings": "GET /api/v1/projects/{pid}/search?q= 查看相关文件",
    "matched": "GET /api/v1/projects/{pid}/search?q={q} （完整命中列表）",
    "recent_changes": "GET /api/v1/projects/{pid}/commits 查看完整历史",
}


def _uj(o) -> str:
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))


def _lj(s):
    """Parse a JSON column (tags/evidence). Callers fall back with `or []`."""
    if isinstance(s, (list, tuple)):
        return list(s)
    if not s:
        return None
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


class _Ctx:
    def __init__(self, budget: int, pid: str, focus_id: Optional[str], q: Optional[str]) -> None:
        self.budget = budget
        self.pid = pid
        self.focus_id = focus_id
        self.q = (q or "").strip()
        self.truncated = False
        self.omitted: dict[str, int] = {}
        self.continuations: set[str] = set()
        self.warnings: list[str] = []

    def fit(self, text: str, limit: int) -> str:
        text = (text or "").strip()
        if len(text) <= limit:
            return text
        self.truncated = True
        return text[: max(0, limit - len(_MARK))] + _MARK

    def brief(self, n: Node, full: bool = False) -> dict:
        d: dict = {"id": n.id, "title": n.title, "kind": n.kind,
                   "status": STATUS_ZH.get(n.status, n.status)}
        if (n.scope or "").strip():
            d["scope"] = self.fit(n.scope, 300 if full else 160)
        if (n.summary or "").strip():
            d["summary"] = self.fit(n.summary, 280 if full else 180)
        if full:
            if (n.finding or "").strip():
                d["finding"] = self.fit(n.finding, 500)
            if (n.decision or "").strip():
                d["decision"] = self.fit(n.decision, 500)
            if n.tags:
                d["tags"] = self.fit(", ".join(_lj(n.tags) or []), 120)
        return d

    def continue_hint(self, key: str) -> None:
        template = _GROUP_CONT.get(key)
        if not template:
            return
        self.continuations.add(template.format(pid=self.pid, focus=self.focus_id or "",
                                               q=self.q or ""))


def build_context(pid: str, focus_node_id: Optional[str], q: Optional[str],
                  max_chars: int) -> dict:
    if max_chars < MIN_CHARS or max_chars > MAX_CHARS:
        raise AppError(422, "VALIDATION", f"max_chars 需在 {MIN_CHARS}–{MAX_CHARS} 之间")
    ctx = _Ctx(max_chars, pid, focus_node_id, q)

    with read_session() as s:
        project = s.get(Project, pid)
        if project is None:
            raise not_found(f"项目 {pid} 不存在")
        all_nodes = list(s.scalars(select(Node).where(Node.project_id == pid)).all())
        active = {n.id: n for n in all_nodes if not n.archived}
        by_all = {n.id: n for n in all_nodes}

        focus: Optional[Node] = None
        if focus_node_id:
            focus = active.get(focus_node_id)
            if focus is None:
                raise not_found(f"节点 {focus_node_id} 不存在或已归档")

        ancestor_nodes: list[Node] = []
        if focus is not None:
            seen = {focus.id}
            cur = focus
            while cur is not None and cur.parent_id:
                pn = by_all.get(cur.parent_id)
                if pn is None or pn.id in seen:
                    break
                ancestor_nodes.append(pn)
                seen.add(pn.id)
                cur = pn
            ancestor_nodes.reverse()

        # ---------------- P0：必需的骨架（项目/焦点/祖先 的 ID+标题） --------
        out: dict = {
            "project_revision": project.revision,
            "project": {"id": project.id, "name": project.name,
                        "objective": project.objective.strip()},
            "focus": ({"id": focus.id, "title": focus.title, "kind": focus.kind,
                       "status": STATUS_ZH.get(focus.status, focus.status)}
                      if focus is not None else None),
            "ancestor_path": ([{"id": n.id, "title": n.title,
                                "status": STATUS_ZH.get(n.status, n.status)}
                               for n in ancestor_nodes]
                              if focus is not None else []),
            "related_nodes": [], "prior_attempts": [], "open_nodes": [],
            "routes": [], "recent_findings": [], "matched": [],
            "recent_changes": [],
            "truncated": False, "omitted_counts": {}, "continuations": [],
            "warnings": [],
        }
        skeleton_size = len(_uj(out))
        if skeleton_size > ctx.budget:
            raise AppError(422, "CONTEXT_BUDGET_TOO_SMALL",
                           "必需的项目/焦点/祖先信息已超出预算",
                           min_required_chars=skeleton_size,
                           requested_chars=max_chars,
                           hint="增大 max_chars，或去掉 focus_node_id 重新请求")

        def admit(key: str, item: dict) -> bool:
            out[key].append(item)
            if len(_uj(out)) <= ctx.budget:
                return True
            out[key].pop()
            return False

        def fill(key: str, items: list[dict]) -> None:
            taken = 0
            for it in items:
                if admit(key, it):
                    taken += 1
                else:
                    break
            left = len(items) - taken
            if left:
                ctx.omitted[key] = left
                ctx.continue_hint(key)

        def fill_focus_field(key: str, value: str) -> None:
            """逐档缩短单个字段；整体仍放不下时放弃该字段并标记截断，
            不给出半句话冒充完整结论。"""
            for limit in (500, 300, 160, 60):
                v = ctx.fit(value, limit)
                out["focus"][key] = v
                if len(_uj(out)) <= ctx.budget:
                    return
            out["focus"].pop(key, None)
            ctx.truncated = True

        # ---------------- 焦点节点完整内容（摘要/条件/观察/结论优先） --------
        if focus is not None:
            fields = [("scope", focus.scope), ("summary", focus.summary),
                      ("finding", focus.finding), ("decision", focus.decision),
                      ("tags", ", ".join(_lj(focus.tags) or []))]
            for k, v in fields:
                if (v or "").strip():
                    fill_focus_field(k, v.strip())

            # ---------------- 直接关联：反证/依赖优先 ----------------
            rels = list(s.scalars(select(Relation).where(
                Relation.project_id == pid, Relation.archived.is_(False),
                (Relation.source_id == focus.id) | (Relation.target_id == focus.id))).all())
            rel_items: list[tuple[tuple, dict]] = []
            for r in rels:
                other_id = r.target_id if r.source_id == focus.id else r.source_id
                other = active.get(other_id)
                if other is None:
                    continue
                d = ctx.brief(other, full=True)
                d["side"] = "本节点→对方" if r.source_id == focus.id else "对方→本节点"
                d["relation_kind"] = r.kind
                d["relation_id"] = r.id
                d["reason"] = ctx.fit(r.reason, 240)
                rel_items.append(((REL_PRIORITY.get(r.kind, 9), r.id), d))
            rel_items.sort(key=lambda t: t[0])
            fill("related_nodes", [d for _k, d in rel_items])

            # ---------------- 同分支先前的失败/未决 ----------------
            ancestor_ids = {n.id for n in ancestor_nodes} | {focus.id}

            def in_branch(nid: str) -> bool:
                cur_id: Optional[str] = nid
                seen: set[str] = set()
                while cur_id and cur_id not in seen:
                    if cur_id in ancestor_ids:
                        return True
                    seen.add(cur_id)
                    node = by_all.get(cur_id)
                    cur_id = node.parent_id if node is not None else None
                return False

            prio = [n for n in active.values() if in_branch(n.id) and n.id != focus.id
                    and n.status in ("not_supported", "inconclusive")]
            prio.sort(key=lambda n: (n.status != "not_supported", n.id))
            fill("prior_attempts", [ctx.brief(n, full=True) for n in prio])

            # ---------------- 焦点子节点的待探索事项 ----------------
            child_map: dict[str, list[Node]] = {}
            for n in active.values():
                if n.parent_id is not None and n.parent_id in active:
                    child_map.setdefault(n.parent_id, []).append(n)
            for lst in child_map.values():
                lst.sort(key=lambda n: (n.order_index, n.id))
            fill("open_nodes", [ctx.brief(c) for c in child_map.get(focus.id, [])
                                if c.status in ("unexplored", "in_progress")])
        else:
            top = sorted((n for n in active.values() if n.parent_id is None),
                         key=lambda n: (n.order_index, n.id))
            fill("routes", [ctx.brief(n) for n in top])
            top_ids = {t.id for t in top}
            open_items = [ctx.brief(n) for n in active.values()
                          if n.status in ("in_progress", "unexplored")
                          and (n.parent_id is None or n.parent_id in top_ids)]
            open_items.sort(key=lambda d: d["id"])
            fill("open_nodes", open_items)
            recent = sorted(active.values(), key=lambda n: n.updated_at, reverse=True)
            neg = [n for n in recent
                   if n.status in ("supported", "not_supported", "promising")][:15]
            fill("recent_findings", [ctx.brief(n, full=(n.status in ("supported", "not_supported")))
                                     for n in neg])

        # ---------------- 关键词命中（与 /search 相同规则，确定性） --------
        if ctx.q:
            q_low = ctx.q.lower()
            hits: list[tuple[int, str, Node]] = []
            for n in active.values():
                score = 0
                if q_low in n.title.lower():
                    score += 2
                if q_low in n.summary.lower():
                    score += 1
                if q_low in json.dumps(n.tags, ensure_ascii=False).lower():
                    score += 1
                if q_low in n.finding.lower():
                    score += 1
                if q_low in n.decision.lower():
                    score += 1
                if score:
                    hits.append((-score, n.id, n))
            hits.sort(key=lambda t: (t[0], t[1]))
            match_items = []
            for _ns, _nid, n in hits:
                d = ctx.brief(n, full=True)
                d["matched_node"] = True
                match_items.append(d)
            fill("matched", match_items)
            if not hits:
                ctx.warnings.append(
                    f"关键词 “{ctx.q}” 在当前未归档节点中命中 0 条；"
                    "这只说明当前检索范围未返回，不能当作“从未尝试”。")

        # ---------------- 近期变化 ----------------
        recent_commits = list(s.scalars(select(Commit).where(
            Commit.project_id == pid).order_by(Commit.revision.desc()).limit(5)).all())
        fill("recent_changes", [
            {"revision": c.revision, "actor": c.actor,
             "summary": ctx.fit(c.summary, 240)} for c in recent_commits])

    # ---------------- 收尾：预算安全阀与元信息 ----------------
    if len(_uj(out)) > ctx.budget:
        for key in ("recent_findings", "routes", "matched", "open_nodes",
                    "prior_attempts", "related_nodes", "recent_changes"):
            while out.get(key) and len(_uj(out)) > ctx.budget:
                out[key].pop()
                ctx.omitted[key] = ctx.omitted.get(key, 0) + 1
            if len(_uj(out)) <= ctx.budget:
                break
    total_omitted = sum(ctx.omitted.values())
    out["truncated"] = ctx.truncated
    out["omitted_counts"] = {k: v for k, v in ctx.omitted.items() if v}
    out["continuations"] = sorted(ctx.continuations)
    if ctx.truncated:
        out["warnings"].append(
            "存在按字符截断的字段（以 …[截断] 标记）；不要把半句话当作完整结论。")
    if total_omitted:
        out["warnings"].append(
            f"受预算限制共有 {total_omitted} 条未返回（见 omitted_counts）；"
            "按 continuations 继续读取，而不是假设内容不存在。")
    out["warnings"] = list(dict.fromkeys(out["warnings"]))
    return out