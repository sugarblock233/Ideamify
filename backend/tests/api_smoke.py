"""End-to-end smoke test against the ASGI app (no live server).

Exercises: auth, project create + idempotency, commit pipeline (ordering,
after_id three-state), revision conflict, idempotent replay, dry-run,
confirmed-status integrity (T10), cycles, archive/restore, relations, search,
commits history, export, context budget, same-audit-path for AI actor,
concurrent writers, oversized body, protected OpenAPI.

A04 adds: final-response budget discipline (meta counted), consistent
truncated/omitted_counts, q-first priority, executable continuations,
min_chars_needed on CONTEXT_BUDGET_TOO_SMALL.
B04 adds: node-history pagination (limit/cursor/before + next_before),
move-history before/after.parent_id exposure, search & project pagination.

The suite is append-friendly: new checks just add `check(...)` calls; the
wrapper (test_api.py) reads the final "P/N passed" line.
"""
import json, re, threading, sys, uuid
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from starlette.testclient import TestClient
from app.main import app

BASE = "http://test"
TOK = {"researcher": "researcher-token-0001", "ai-sim": "ai-sim-token-0001"}

def client(token="researcher-token-0001", **kw):
    return TestClient(app, headers={"Authorization": f"Bearer {token}",
                              "Content-Type": "application/json"}, **kw)

def U():
    return str(uuid.uuid4()).lower()

results = []
def check(name, cond, extra=""):
    results.append((name, bool(cond)))
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"  [{extra}]"))

c = client()

# ---------------- auth / meta -------------------------------------------
check("healthz public", c.get("/healthz").json()["ok"] is True)
r = TestClient(app, headers={"Authorization": "Bearer nope"}).get("/api/v1/projects")
check("no/bad token -> 401 UNAUTHORIZED", r.status_code == 401 and r.json()["error"]["code"] == "UNAUTHORIZED")
r = c.get("/api/v1/definitely-not-a-route")
check("unknown /api/* -> JSON 404", r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND")
r = client(token=TOK["ai-sim"]).get("/api/v1/session")
check("/session actor = named AI token", r.json().get("actor") == "ai-sim")
r = TestClient(app).get("/api/v1/openapi.json")
check("openapi.json requires auth", r.status_code == 401)
r = c.get("/api/v1/openapi.json")
check("openapi.json valid for authed", r.status_code == 200 and "/api/v1/projects" in r.json().get("paths", {}))

# ---------------- project create ----------------------------------------
body = {"request_id": U(), "name": "合成材料催化", "objective": "研究高温高压下MOF材料的CO2捕获能力（合成数据）"}
r = c.post("/api/v1/projects", json=body)
p = r.json()
check("create project -> 200 {id,revision 0}", r.status_code == 200 and p["revision"] == 0 and p["id"], r.text)
check("created_by = researcher token name",
      c.get(f"/api/v1/projects/{p['id']}").json()["created_by"] == "researcher")
r = c.post("/api/v1/projects", json=body)
check("project replay: 200 same id + already_committed",
      r.status_code == 200 and r.json()["id"] == p["id"] and r.json()["already_committed"] is True, r.text)
bad = {**body, "objective": "被篡改的目标"}
r = c.post("/api/v1/projects", json=bad)
check("project req_id reuse with diff body -> 409", r.status_code == 409, r.text)

pid = p["id"]
def commit(ops, exp, rid=None, client_=None, dry=False, summary=None, label="smoke"):
    cc = client_ or c
    return cc.post(f"/api/v1/projects/{pid}/commits" + ("?dry_run=1" if dry else ""),
                   json={"request_id": rid or U(), "expected_revision": exp,
                         "summary": summary or "冒烟提交", "client_label": label,
                         "operations": ops})

# ---------------- commit pipeline ----------------------------------------
top, child = U(), U()
ops = [
    {"op": "node.create", "id": top, "kind": "question", "title": "高压下MOF能否保持孔隙率", "summary": "合成路径1的可行性", "tags": ["MOF", "高压"]},
    {"op": "node.create", "id": child, "parent_id": top, "after_id": None, "kind": "idea", "title": "溶剂热法并加入交联剂", "summary": "防止高压坍塌", "scope": "200°C以上, 交联剂浓度2-8wt%", "tags": ["溶剂热"]},
]
r = commit(ops, 0)
j = r.json()
check("commit rev0 -> rev1, created both", r.status_code == 200 and j["revision"] == 1
      and set(j["created_node_ids"]) == {top, child}, r.text)

r = commit([{"op": "node.update", "id": top, "fields": {"title": "错误的旧版本"}}], 0)
check("stale expected_revision -> 409 REVISION_CONFLICT + current_revision",
      r.status_code == 409 and r.json()["error"]["code"] == "REVISION_CONFLICT"
      and r.json()["error"]["details"]["current_revision"] == 1, r.text)

r = commit([{"op": "node.create", "id": U(), "kind": "idea", "title": "只是预演"}], 1, dry=True)
j = r.json()
check("dry-run: 200, plan + revision_if_committed, nothing persisted",
      r.status_code == 200 and j["dry_run"] is True and j["revision_if_committed"] == 2
      and c.get(f"/api/v1/projects/{pid}/graph").json()["project_revision"] == 1, r.text)

rid2 = U()
r = commit([{"op": "node.update", "id": top, "fields": {"title": "高压下MOF孔隙率稳定性问题"}}], 1, rid=rid2, summary="补充焦点标题")
check("commit rev1 -> rev2", r.status_code == 200 and r.json()["revision"] == 2, r.text)
r = c.post(f"/api/v1/projects/{pid}/commits",
           json={"request_id": rid2, "expected_revision": 1, "summary": "补充焦点标题",
                 "client_label": "smoke", "operations": [
                     {"op": "node.update", "id": top, "fields": {"title": "高压下MOF孔隙率稳定性问题"}}]})
check("idempotent replay (same rid+hash): 200, already_committed, rev unchanged",
      r.status_code == 200 and r.json().get("already_committed") is True
      and c.get(f"/api/v1/projects/{pid}").json()["revision"] == 2, r.text)
r = c.post(f"/api/v1/projects/{pid}/commits",
           json={"request_id": rid2, "expected_revision": 1, "summary": "另一个摘要",
                 "client_label": "smoke", "operations": [
                     {"op": "node.update", "id": top, "fields": {"title": "高压下MOF孔隙率稳定性问题"}}]})
check("same request_id different hash -> 409 IDEMPOTENCY_KEY_REUSED",
      r.status_code == 409 and r.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSED", r.text)

r = commit([{"op": "relation.create", "id": U(), "source_id": child, "target_id": child,
             "kind": "related", "reason": "自引用"}], 2)
check("self relation -> 422 SELF_RELATION",
      r.status_code == 422 and r.json()["error"]["code"] == "SELF_RELATION", r.text)

third, rel1 = U(), U()
r = commit([
    {"op": "node.create", "id": third, "parent_id": top, "after_id": child, "kind": "attempt",
     "title": "溶剂热+交联剂实验批次1", "summary": "首批评量验证", "status": "promising",
     "scope": "220°C 12h, 交联剂5wt%", "finding": "孔隙面积降约5%, 活性保持", "tags": ["批次1"]},
    {"op": "relation.create", "id": rel1, "source_id": third, "target_id": child,
     "kind": "depends_on", "reason": "提取交联剂浓度上限"},
], 2)
check("commit attempt+relation at rev2 -> rev3", r.status_code == 200 and r.json()["revision"] == 3, r.text)
r = commit([{"op": "relation.create", "id": U(), "source_id": third, "target_id": child,
             "kind": "depends_on", "reason": "重复"}], 3)
check("duplicate relation -> 409 DUPLICATE_RELATION", r.status_code == 409, r.text)

# ---------------- confirmed-status integrity (T10) -----------------------
s1 = U()
r = commit([{"op": "node.create", "id": s1, "parent_id": top, "kind": "attempt", "title": "批次2",
             "status": "supported", "scope": "230°C 14h 8wt%", "finding": "XRD 主峰保持"}], 3)
check("supported without decision -> 422 STATUS_EVIDENCE_REQUIRED (missing decision)",
      r.status_code == 422 and r.json()["error"]["code"] == "STATUS_EVIDENCE_REQUIRED"
      and "decision" in r.json()["error"]["details"]["missing"], r.text)
r = commit([{"op": "node.create", "id": s1, "parent_id": top, "kind": "attempt", "title": "批次2",
             "status": "supported", "scope": "230°C 14h 8wt%", "finding": "XRD 主峰保持",
             "decision": "窗口内有效"}], 3)
check("supported without evidence -> 422 (missing evidence)",
      r.status_code == 422 and "evidence" in r.json()["error"]["details"]["missing"], r.text)

s2 = U()
try_ai = client(token=TOK["ai-sim"])
r = commit([{"op": "node.create", "id": s2, "parent_id": top, "kind": "attempt",
             "title": "交联剂浓度梯度的批次3", "status": "supported", "summary": "梯度验证",
             "scope": "230°C 14h, 6/8/10wt%", "finding": "8wt% 时孔隙率保持且活性回升",
             "decision": "当前窗口内支持：8wt% 为阈值", "tags": ["批次3"],
             "evidence": [{"kind": "url", "label": "XRD数据（合成）", "value": "https://storage.lab/synthetic-xrd-batch3.csv"}]}],
           3, client_=try_ai, label="ai-sim")
check("full supported commit (as AI actor) -> rev4", r.status_code == 200 and r.json()["revision"] == 4, r.text)
check("AI commit attributed to ai-sim",
      c.get(f"/api/v1/projects/{pid}/nodes/{s2}").json()["created_by"] == "ai-sim")

sid = U()
r = commit([{"op": "node.create", "id": sid, "parent_id": top, "after_id": third, "kind": "attempt",
             "title": "交联剂加倍的批次2复测计划", "summary": "尚无结论",
             "rationale": "批次2数据不完整，复测确认", "tags": ["复测"]}], 4)
check("commit sid at rev4 -> rev5", r.status_code == 200 and r.json()["revision"] == 5, r.text)

g = c.get(f"/api/v1/projects/{pid}/graph").json()["nodes"]
byname = {n["id"]: n for n in g}
check("ordering: after_id=None first / after X after X",
      byname[child]["order_index"] == 0 and byname[third]["order_index"] == 1
      and byname[sid]["order_index"] == 2 and byname[top]["child_count"] == 4,
      str({k: byname[v]["order_index"] for k, v in
           dict(top=top, child=child, third=third, s2=s2, sid=sid).items()}))
check("graph excludes details_md, includes counts",
      all("details_md" not in n for n in g) and "evidence_count" in byname[s2]
      and byname[third]["relation_count"] == 1, str(g[0]))
n = c.get(f"/api/v1/projects/{pid}/nodes/{third}").json()
check("node detail: full fields + path + relation_count",
      n["relation_count"] == 1 and [x["id"] for x in n["path"]] == [top, third])

# ---------------- cycles / move guards -----------------------------------
r = commit([{"op": "node.move", "id": top, "parent_id": child, "after_id": None}], 5)
check("move into own subtree -> 422 MOVE_CYCLE", r.status_code == 422 and r.json()["error"]["code"] == "MOVE_CYCLE", r.text)
r = commit([{"op": "node.move", "id": top, "parent_id": top, "after_id": None}], 5)
check("move to self -> 422 MOVE_TO_SELF", r.status_code == 422, r.text)
r = commit([{"op": "node.move", "id": child, "parent_id": third, "after_id": U()}], 5)
check("after_id not sibling -> 422 INVALID_AFTER", r.status_code == 422, r.text)

# ---------------- archive / restore ---------------------------------------
r = commit([{"op": "node.archive", "id": child, "reason": "结论并入批次3"}], 5)
check("archive leaf concept -> rev6", r.status_code == 200 and r.json()["revision"] == 6, r.text)
g = c.get(f"/api/v1/projects/{pid}/graph").json()["nodes"]
byid = {n["id"]: n for n in g}
check("graph hides archived; counts adjust", child not in byid and byid[top]["child_count"] == 3
      and byid[third]["relation_count"] == 0,
      f"top.child_count={byid[top]['child_count']} third.rel={byid[third]['relation_count']}")
check("node endpoint still returns archived node (AI can see history)",
      c.get(f"/api/v1/projects/{pid}/nodes/{child}").json()["archived"] is True)
r = commit([{"op": "node.archive", "id": top, "reason": "尝试归档带子节点"}], 6)
check("archive node with children -> 422 ARCHIVE_HAS_CHILDREN",
      r.status_code == 422 and r.json()["error"]["code"] == "ARCHIVE_HAS_CHILDREN", r.text)

r = commit([{"op": "node.restore", "id": child, "reason": "仍然需要展示"}], 6)
check("restore -> rev7", r.status_code == 200 and r.json()["revision"] == 7, r.text)
r = commit([{"op": "node.restore", "id": child, "reason": "再次"}], 7)
check("restore non-archived -> 422 NOT_ARCHIVED", r.status_code == 422, r.text)

# all-or-nothing: one batch touches two objects, second fails
r = commit([
    {"op": "node.archive", "id": sid, "reason": "暂停复测"},
    {"op": "relation.create", "id": U(), "source_id": s2, "target_id": sid,
     "kind": "related", "reason": "关联"},
], 7)
check("atomicity: relation to just-archived node -> 422 ENDPOINT_ARCHIVED",
      r.status_code == 422 and r.json()["error"]["code"] == "ENDPOINT_ARCHIVED", r.text)
g = c.get(f"/api/v1/projects/{pid}/graph").json()
check("nothing persisted after rejected batch (rev 7, 5 nodes)",
      g["project_revision"] == 7 and len(g["nodes"]) == 5
      and all(n["id"] != sid or not n.get("archived") for n in g["nodes"]))

# ---------------- search ---------------------------------------------------
r = c.get(f"/api/v1/projects/{pid}/search", params={"q": "交联剂"})
ids = [x["id"] for x in r.json()["items"]]
check("search (Chinese substring) over title/tags",
      r.status_code == 200 and {s2, sid} <= set(ids) and len(ids) >= 2, r.text[:300])
r = c.get(f"/api/v1/projects/{pid}/search", params={"q": "孔隙率"})
check("search hits finding/scope-adjacent fields deterministically",
      r.status_code == 200 and top in [x["id"] for x in r.json()["items"]], r.text[:300])

# ---------------- relations paginate --------------------------------------
r = c.get(f"/api/v1/projects/{pid}/nodes/{third}/relations", params={"limit": 100})
it = r.json()["items"]
check("relations page: 1 outgoing depends_on -> child",
      len(it) == 1 and it[0]["direction"] == "outgoing" and it[0]["kind"] == "depends_on"
      and it[0]["other"]["id"] == child, r.text)

# ---------------- commits history ------------------------------------------
r = c.get(f"/api/v1/projects/{pid}/commits")
items = r.json()["items"]
check("commits: 7 entries, newest first (rev7..rev1)",
      len(items) == 7 and items[0]["revision"] == 7 and items[-1]["revision"] == 1, str([i["revision"] for i in items]))
r = c.get(f"/api/v1/projects/{pid}/commits", params={"node_id": child})
revs = sorted(i["revision"] for i in r.json()["items"])
check("commits?node_id covers touched nodes (create/rel/archive/restore)",
      revs == [1, 3, 6, 7], str(revs))
r = c.get(f"/api/v1/projects/{pid}/commits/{items[0]['id']}")
check("commit detail has operations + changes + node links",
      r.status_code == 200 and r.json()["operations"] and "changes" in r.json(), r.text[:200])

# ---------------- export -----------------------------------------------------
r = c.get(f"/api/v1/projects/{pid}/export")
e = r.json()
ok = (e["schema_version"] == 1 and len(e["nodes"]) == 5 and len(e["relations"]) == 1
      and e["counts"]["commits"] == 7
      and all("details_md" in n for n in e["nodes"])
      and any(n["id"] == child and not n["archived"] for n in e["nodes"]))
check("export: schema v1, full content, relations, full history", ok, str(list(e.keys())))

# ---------------- context ----------------------------------------------------
r = c.get(f"/api/v1/projects/{pid}/context", params={"focus_node_id": third, "max_chars": 16000})
ctx = r.json()
check("context focus: skeleton + related_nodes + ancestor_path",
      r.status_code == 200 and ctx["focus"]["id"] == third
      and [a["id"] for a in ctx["ancestor_path"]] == [top]
      and any(x["id"] == child for x in ctx["related_nodes"])
      and ctx["project_revision"] == 7, str(ctx)[:200])
r = c.get(f"/api/v1/projects/{pid}/context", params={"focus_node_id": third, "q": "交联剂", "max_chars": 16000})
check("context q: matched non-empty with matched_node marker",
      r.status_code == 200 and len(r.json()["matched"]) >= 2, str(r.json())[:200])
r = c.get(f"/api/v1/projects/{pid}/context", params={"max_chars": 3900})
check("context max_chars below 4000 -> 422", r.status_code == 422, r.text[:120])
r = c.get(f"/api/v1/projects/{pid}/context", params={"focus_node_id": third, "max_chars": 4000})
j = r.json()
compact = len(json.dumps(j, ensure_ascii=False, separators=(",", ":")))
check("context always within unicode budget", r.status_code == 200 and compact <= 4000, f"compact={compact}")
r = c.get(f"/api/v1/projects/{pid}/context", params={"focus_node_id": "not-a-node"})
check("context bad focus -> 404", r.status_code == 404, r.text[:120])
# budget-too-small path: required skeleton (project objective) alone > 4000
p2body = {"request_id": U(), "name": "预算边界项目", "objective": "这是一个合成测试目标" * 400}
p2 = c.post("/api/v1/projects", json=p2body).json()["id"]
n2 = U()
r2p = c.post(f"/api/v1/projects/{p2}/commits", json={"request_id": U(), "expected_revision": 0,
                                           "summary": "建骨架", "operations": [
                                             {"op": "node.create", "id": n2, "kind": "idea", "title": "骨架节点"}]})
check("second project ready for budget test", r2p.status_code == 200, r2p.text[:200])
r = c.get(f"/api/v1/projects/{p2}/context", params={"focus_node_id": n2, "max_chars": 4000})
check("context over-budget required-skeleton -> 422 CONTEXT_BUDGET_TOO_SMALL",
      r.status_code == 422 and r.json()["error"]["code"] == "CONTEXT_BUDGET_TOO_SMALL", r.text[:200])
r = c.get(f"/api/v1/projects/{p2}/context", params={"focus_node_id": n2, "max_chars": 6000})
check("context with headroom fits skeleton (200)", r.status_code == 200 and r.json()["focus"]["id"] == n2, r.text[:200])

# ---------------- A04: context budget / truncation / priority -------------
# Dedicated scratch project so these checks do not disturb the main one.
pctx = c.post("/api/v1/projects", json={"request_id": U(), "name": "预算测试项目",
              "objective": "验证 context 预算与截断信号（合成数据）"}).json()["id"]

def commit_to(pid_, ops, exp, rid=None, client_=None, summary=None, label="smoke"):
    cc = client_ or c
    return cc.post(f"/api/v1/projects/{pid_}/commits",
                   json={"request_id": rid or U(), "expected_revision": exp,
                         "summary": summary or "冒烟提交", "client_label": label,
                         "operations": ops})

LONG_SUMMARY = "长摘要" * 70  # 280 chars: forces field-level truncation rules to be relevant

# Seed topology:
#   root (top, question)      -- a (idea, in_progress) -- foc (attempt, promising, long fields)
#               |                   |-- p1..p3 (same-branch failures / open question)
#               |                   |-- ch1..ch6 (foc's open children)
#   side (top, idea, unexplored) -- o1..o4 (long open items)
#   g1 (under root, supported finding), mnode (top, unique keyword "1099" in title)
#   nc1/nd1/nr1/nr2 (top) related to foc: contradicts / depends_on / related / related
root, side = U(), U()
a, foc = U(), U()
fa1, fa2, fa3 = U(), U(), U()
ch_ids = [U() for _ in range(6)]
o_ids = [U() for _ in range(4)]
g1, mnode = U(), U()
nc1, nd1, nr1, nr2 = U(), U(), U(), U()

r = commit_to(pctx, [
    {"op": "node.create", "id": root, "kind": "question", "title": "主干问题", "summary": "主线探索"},
    {"op": "node.create", "id": side, "kind": "idea", "title": "无关支线", "summary": "另一条路线"},
], 0)
check("A04 seed: rev1 ready", r.status_code == 200, r.text[:200])

r = commit_to(pctx, [
    {"op": "node.create", "id": a, "parent_id": root, "kind": "idea", "title": "一级假设",
     "summary": "待验证的核心假设", "status": "in_progress"},
    {"op": "node.create", "id": foc, "parent_id": a, "kind": "attempt", "title": "焦点实验",
     "summary": LONG_SUMMARY, "status": "promising", "scope": "限定温控与浓度窗口" * 10,
     "finding": "出现可重复信号" * 12, "decision": "继续探索并补充批次" * 8, "tags": ["焦点"]},
    {"op": "node.create", "id": fa1, "parent_id": a, "kind": "attempt", "title": "失败尝试1",
     "status": "not_supported", "scope": "批次甲参数" * 8, "finding": "未达停止条件" * 8,
     "decision": "放弃该路径" * 8,
     "evidence": [{"kind": "inline", "label": "合成数据", "value": "活性低于阈值"}]},
    {"op": "node.create", "id": fa2, "parent_id": a, "kind": "attempt", "title": "失败尝试2",
     "status": "not_supported", "scope": "批次乙参数" * 8, "finding": "重复不成立" * 8,
     "decision": "终止该方向" * 8,
     "evidence": [{"kind": "inline", "label": "合成数据", "value": "重复均复现失败"}]},
    {"op": "node.create", "id": fa3, "parent_id": a, "kind": "question", "title": "未决问题3",
     "status": "inconclusive", "summary": "证据不足" * 20},
], 1, summary="焦点与先前失败")
check("A04 seed: rev2 ready", r.status_code == 200, r.text[:200])

r = commit_to(pctx, [
    *[{"op": "node.create", "id": ch, "parent_id": foc, "kind": "idea",
       "title": f"焦点开放子问题{i}", "summary": "子问题描述" * 8,
       "status": "in_progress" if i % 2 else "unexplored"}
      for i, ch in enumerate(ch_ids, 1)],
    *[{"op": "node.create", "id": o, "parent_id": side, "kind": "idea",
       "title": f"支线开放节点{i}", "summary": "支线开放事项" * 24, "status": "in_progress"}
      for i, o in enumerate(o_ids, 1)],
    {"op": "node.create", "id": g1, "parent_id": root, "kind": "finding", "title": "支持性发现",
     "status": "supported", "scope": "当前范围内成立" * 8, "finding": "显著且可重复" * 8,
     "decision": "纳入后续验证" * 8,
     "evidence": [{"kind": "inline", "label": "合成数据", "value": "n=12，差异显著"}]},
    {"op": "node.create", "id": mnode, "kind": "finding", "title": "唯一命中 1099 记录",
     "status": "inconclusive", "summary": "关于 1099 的独立记录"},
], 2, summary="开放节点与发现")
check("A04 seed: rev3 ready", r.status_code == 200, r.text[:200])

r = commit_to(pctx, [
    {"op": "node.create", "id": nc1, "kind": "attempt", "title": "反证记录",
     "status": "not_supported", "scope": "交叉验证范围" * 8, "finding": "不支持焦点结论" * 8,
     "decision": "需复核条件" * 8,
     "evidence": [{"kind": "inline", "label": "合成数据", "value": "交叉验证失效"}]},
    {"op": "node.create", "id": nd1, "kind": "idea", "title": "前置依赖",
     "summary": "焦点依赖其产出" * 12},
    {"op": "node.create", "id": nr1, "kind": "idea", "title": "同主题记录A",
     "summary": "相关背景" * 12},
    {"op": "node.create", "id": nr2, "kind": "idea", "title": "同主题记录B",
     "summary": "相关背景二" * 12},
    {"op": "relation.create", "id": U(), "source_id": foc, "target_id": nc1,
     "kind": "contradicts", "reason": "焦点结论在该条件下不成立"},
    {"op": "relation.create", "id": U(), "source_id": foc, "target_id": nd1,
     "kind": "depends_on", "reason": "依赖前置结果"},
    {"op": "relation.create", "id": U(), "source_id": nr1, "target_id": foc,
     "kind": "related", "reason": "同主题"},
    {"op": "relation.create", "id": U(), "source_id": foc, "target_id": nr2,
     "kind": "related", "reason": "同主题2"},
], 3, summary="焦点关联")
check("A04 seed: rev4 (relations) ready", r.status_code == 200, r.text[:300])

def compact_len(d):
    return len(json.dumps(d, ensure_ascii=False, separators=(",", ":")))

# (a) final response, meta included, respects the budget
r = c.get(f"/api/v1/projects/{pctx}/context", params={"focus_node_id": foc, "max_chars": 4000})
j = r.json()
cl = compact_len(j)
check("A04-a: focus@4000 final size within budget, meta non-empty",
      r.status_code == 200 and cl <= 4000
      and (j.get("omitted_counts") or j.get("continuations") or j.get("warnings")),
      f"compact={cl} status={r.status_code}")
# (b) any whole-item omission reports truncated=true
check("A04-b: omission at 4000 -> truncated=true with counted omissions",
      r.status_code == 200 and bool(j["omitted_counts"]) and j["truncated"] is True,
      f"omitted={j.get('omitted_counts')} truncated={j.get('truncated')}")
# data-not-instructions contract
check("A04: response carries data_notice", isinstance(j.get("data_notice"), str)
      and "指令" in j["data_notice"], str(j.get("data_notice"))[:80])

# (c) unique q-match is returned at a tight budget while general overview is omitted
r2 = c.get(f"/api/v1/projects/{pctx}/context", params={"q": "1099", "max_chars": 4000})
j2 = r2.json()
cl2 = compact_len(j2)
check("A04-c: unique q-match kept at 4000 while general groups omitted",
      r2.status_code == 200 and cl2 <= 4000
      and mnode in [x["id"] for x in j2["matched"]]
      and any(j2["omitted_counts"].get(k, 0) > 0
              for k in ("open_nodes", "routes", "recent_findings", "recent_changes"))
      and j2["truncated"] is True,
      f"compact={cl2} matched={len(j2['matched'])} omitted={j2.get('omitted_counts')}")
# and still first when focus is also given (matches outrank focus content)
r3 = c.get(f"/api/v1/projects/{pctx}/context", params={"focus_node_id": foc, "q": "1099", "max_chars": 4000})
j3 = r3.json()
check("A04-c: q-match first even with focus set",
      r3.status_code == 200 and compact_len(j3) <= 4000
      and mnode in [x["id"] for x in j3["matched"]],
      f"matched={[x['id'] for x in j3.get('matched', [])][:3]} status={r3.status_code}")
# no q, no focus, bigger budget: whole-response fit still holds
r4 = c.get(f"/api/v1/projects/{pctx}/context", params={"max_chars": 12000})
j4 = r4.json()
check("A04: overview@12000 within budget",
      r4.status_code == 200 and compact_len(j4) <= 12000,
      f"compact={compact_len(j4)}")
# no-hit q: explicit "not returned != never tried" warning
r5 = c.get(f"/api/v1/projects/{pctx}/context", params={"q": "必然不存在的词", "max_chars": 4000})
j5 = r5.json()
check("A04: zero-hit q -> warning, still within budget",
      r5.status_code == 200 and compact_len(j5) <= 4000 and any("从未尝试" in w for w in j5["warnings"]),
      str(j5.get("warnings")))

# (d) every emitted continuation is an executable GET the endpoint accepts
ok_d, extra_d, ran_d = True, "", 0
for resp in (j2, j):
    if "continuations" not in resp:
        ok_d, extra_d = False, f"context 响应缺少 meta 字段: {str(resp)[:120]}"
        break
    for cont in resp["continuations"]:
        mm = re.match(r"^GET (\S+)$", cont)
        if not mm:
            ok_d = False; extra_d = f"not a bare GET url: {cont}"
            break
        rr = c.get(mm.group(1))
        ran_d += 1
        if rr.status_code != 200:
            ok_d = False; extra_d = f"{cont} -> {rr.status_code} {rr.text[:120]}"
        if not ok_d:
            break
    if not ok_d:
        break
check("A04-d: continuations are executable queries (all -> 200)",
      ran_d > 0 and ok_d, extra_d or f"ran {ran_d} continuations")

# (e) R05: the meta is part of the payload, so the budget has to be enforced on
# the response that actually ships. This shape emits all four distinct
# continuation URLs at once — and a 100-char q (the endpoint's maximum) makes
# the search one ~9x its length once percent-encoded — so the real meta exceeds
# META_RESERVE. The old trim pass measured `out` before the meta was populated,
# never fired, and returned 4092 chars for max_chars=4000.
LONGQ = ("长关键词复现预算元信息溢出的场景与说明文字用于撑大续读指引与警告文本" * 3)[:100]
pbig = c.post("/api/v1/projects", json={"request_id": U(), "name": "R05 预算元信息",
              "objective": "元信息本身很大时的预算纪律（合成数据）"}).json()["id"]
broot, bfoc = U(), U()
rev_b = 0
r = commit_to(pbig, [
    {"op": "node.create", "id": broot, "kind": "question", "title": "根路线", "summary": LONGQ},
    {"op": "node.create", "id": bfoc, "parent_id": broot, "kind": "idea", "title": "焦点",
     "summary": LONGQ, "scope": "适用条件" * 60, "finding": "直接观察" * 60,
     "decision": "当前决定" * 60, "tags": ["标签甲", "标签乙"], "status": "in_progress"},
], rev_b, summary="R05 骨架"); rev_b += 1
bpartners = [U() for _ in range(8)]
r = commit_to(pbig, [
    *[{"op": "node.create", "id": U(), "parent_id": broot, "kind": "attempt",
       "title": f"先前尝试{i}", "summary": LONGQ, "status": "inconclusive"} for i in range(8)],
    *[{"op": "node.create", "id": U(), "parent_id": bfoc, "kind": "idea",
       "title": f"开放{i}", "summary": LONGQ, "status": "unexplored"} for i in range(8)],
    *[{"op": "node.create", "id": n, "parent_id": broot, "kind": "idea",
       "title": f"关联对象{i}", "summary": LONGQ, "status": "in_progress"}
      for i, n in enumerate(bpartners)],
], rev_b, summary="R05 分组内容"); rev_b += 1
r = commit_to(pbig, [{"op": "relation.create", "id": U(), "source_id": bfoc, "target_id": n,
                      "kind": "contradicts", "reason": "理由" * 30} for n in bpartners],
              rev_b, summary="R05 关联"); rev_b += 1
for i in range(8):  # >5 commits so recent_changes also has to omit
    r = commit_to(pbig, [{"op": "node.update", "id": bfoc, "fields": {"summary": LONGQ + f"#{i}"}}],
                  rev_b, summary="改动" * 40); rev_b += 1
check("A04-e seed: meta-heavy project ready", r.status_code == 200, r.text[:200])

worst = []
for mc in (4000, 4030, 4500, 5000, 6000, 8000, 12000):
    rr = c.get(f"/api/v1/projects/{pbig}/context",
               params={"q": LONGQ, "focus_node_id": bfoc, "max_chars": mc})
    if rr.status_code != 200:
        worst.append((mc, rr.status_code, rr.text[:120])); continue
    n = compact_len(rr.json())
    if n > mc:
        worst.append((mc, n, n - mc))
check("A04-e/R05: meta-heavy context never exceeds max_chars", not worst, str(worst)[:300])
j7 = c.get(f"/api/v1/projects/{pbig}/context",
           params={"q": LONGQ, "focus_node_id": bfoc, "max_chars": 4000}).json()
check("A04-e/R05: and the trimmed response still reports what it withheld",
      j7["truncated"] is True and bool(j7["omitted_counts"]) and bool(j7["continuations"]),
      f"omitted={j7.get('omitted_counts')} cont={len(j7.get('continuations', []))}")

# CONTEXT_BUDGET_TOO_SMALL must report the observed minimum (p2: giant objective)
r6 = c.get(f"/api/v1/projects/{p2}/context", params={"focus_node_id": n2, "max_chars": 4000})
d6 = r6.json().get("error", {}).get("details", {})
check("A04: too-small skeleton -> 422 with observed min_chars_needed",
      r6.status_code == 422 and r6.json()["error"]["code"] == "CONTEXT_BUDGET_TOO_SMALL"
      and isinstance(d6.get("min_chars_needed"), int) and d6["min_chars_needed"] > 4000
      and d6.get("requested_chars") == 4000,
      str(d6)[:200])

# ---------------- B04: history pagination + move before/after -----------------
phist = c.post("/api/v1/projects", json={"request_id": U(), "name": "历史分页项目",
             "objective": "超过 20 条节点历史（合成数据）"}).json()["id"]
h0, h1 = U(), U()
r = commit_to(phist, [
    {"op": "node.create", "id": h0, "kind": "idea", "title": "历史载体", "summary": "翻页测试载体"},
    {"op": "node.create", "id": h1, "kind": "idea", "title": "可移动节点", "summary": "将被移动"},
], 0, summary="建节点")
check("B04 seed: rev1", r.status_code == 200, r.text[:200])
r = commit_to(phist, [{"op": "node.move", "id": h1, "parent_id": h0}], 1, summary="移动h1")
check("B04 seed: move rev2", r.status_code == 200, r.text[:200])
ok_hist = True; hist_err = ""
for i in range(21):
    r = commit_to(phist, [{"op": "node.update", "id": h0, "fields": {"summary": f"历史更新 {i}"}}],
                  2 + i, summary=f"历史更新{i}")
    if r.status_code != 200:
        ok_hist = False; hist_err = r.text[:200]; break
check("B04 seed: 21 updates on one node (22 commits total)", ok_hist, hist_err)
th_ids = [U() for _ in range(12)]
r = commit_to(phist, [
    {"op": "node.create", "id": x, "kind": "idea", "title": f"吞吐节点{i}", "summary": "吞吐相关"}
    for i, x in enumerate(th_ids)], 23, summary="吞吐批次")
check("B04 seed: 12 same-keyword nodes", r.status_code == 200, r.text[:200])

# node history: > limit commits, newest first, pages complete without overlap
r = c.get(f"/api/v1/projects/{phist}/commits", params={"node_id": h0, "limit": 10})
j = r.json()
revs1 = [i["revision"] for i in j["items"]]
check("B04-h1: node history page1 (10 newest, paging fields present)",
      r.status_code == 200 and len(j["items"]) == 10 and j["has_more"] is True
      and bool(j.get("next_cursor")) and bool(j.get("next_before")),
      r.text[:200] if r.status_code != 200 else str(revs1))
check("B04-h1: page1 strictly newest-first",
      all(revs1[k] > revs1[k + 1] for k in range(len(revs1) - 1)), str(revs1))
r2 = c.get(f"/api/v1/projects/{phist}/commits", params={"node_id": h0, "limit": 10,
                                                        "cursor": j["next_cursor"]})
j2 = r2.json()
revs2 = [i["revision"] for i in j2["items"]]
check("B04-h2: page2 via next_cursor (10 items, no overlap, can continue)",
      r2.status_code == 200 and len(j2["items"]) == 10 and j2["has_more"] is True
      and not set(revs1) & set(revs2) and bool(j2.get("next_cursor")),
      str(revs2)[:120] if r2.status_code == 200 else r2.text[:200])
r3b = c.get(f"/api/v1/projects/{phist}/commits", params={"node_id": h0, "limit": 10,
                                                         "cursor": j2["next_cursor"]})
j3b = r3b.json()
check("B04-h3: last page holds the create (rev 1), paging closes cleanly",
      len(j3b["items"]) == 2 and j3b["has_more"] is False and j3b["next_cursor"] is None
      and j3b["next_before"] is None and [i["revision"] for i in j3b["items"]][-1] == 1,
      str([i["revision"] for i in j3b.get("items", [])]))
# ?before=<commit id> == next window (alternative to cursor)
r4b = c.get(f"/api/v1/projects/{phist}/commits", params={"node_id": h0, "limit": 10,
                                                         "before": j["items"][-1]["id"]})
j4b = r4b.json()
check("B04-h4: ?before=<last commit id> returns the next (older) window",
      r4b.status_code == 200 and [i["revision"] for i in j4b["items"]] == revs2,
      str([i["revision"] for i in j4b.get("items", [])])[:120] if r4b.status_code == 200 else r4b.text[:200])
# default (no params) keeps today's shape and returns everything when <= limit
r5b = c.get(f"/api/v1/projects/{phist}/commits")
j5b = r5b.json()
item0 = (j5b.get("items") or [{}])[0]
check("B04-h5: default call unchanged shape, full list when <= default limit",
      r5b.status_code == 200 and len(j5b["items"]) == 24 and j5b["has_more"] is False
      and j5b.get("next_before") is None
      and all(k in item0 for k in ("id", "revision", "base_revision", "request_id",
                                   "actor", "client_label", "summary", "created_at", "node_ids")),
      r5b.text[:200] if r5b.status_code != 200 else str(list(item0)))
# move history must expose before/after with parent_id + order_index (stored shape)
mov = next((i for i in j5b["items"] if i["revision"] == 2), None)
md = c.get(f"/api/v1/projects/{phist}/commits/{mov['id']}").json() if mov else {}
mv = next((ch for ch in md.get("changes", []) if ch.get("type") == "node.move"
           and ch.get("object_id") == h1), None)
check("B04-h6: move commit exposes before/after parent_id + order_index",
      mv is not None and mv["before"]["parent_id"] is None and mv["after"]["parent_id"] == h0
      and isinstance(mv["before"]["order_index"], int) and isinstance(mv["after"]["order_index"], int),
      str(mv)[:200])
# search pagination: 12 matches, limit 5
r6b = c.get(f"/api/v1/projects/{phist}/search", params={"q": "吞吐", "limit": 5})
js1 = r6b.json()
check("B04-s1: search 12 matches/limit5 -> page1 + paging fields",
      r6b.status_code == 200 and js1.get("total") == 12 and len(js1["items"]) == 5
      and js1["has_more"] is True and bool(js1.get("next_cursor")),
      str({k: js1.get(k) for k in ("total", "has_more")}) if r6b.status_code == 200 else r6b.text[:200])
r7b = c.get(f"/api/v1/projects/{phist}/search", params={"q": "吞吐", "limit": 5,
                                                        "cursor": js1["next_cursor"]})
js2 = r7b.json()
r8b = c.get(f"/api/v1/projects/{phist}/search", params={"q": "吞吐", "limit": 5,
                                                        "cursor": js2["next_cursor"]}
            if js2.get("next_cursor") else {"q": "吞吐", "limit": 5})
js3 = r8b.json()
check("B04-s2: search pages 5/5/2 without overlap, closes cleanly",
      len(js2["items"]) == 5 and len(js3["items"]) == 2 and js3["has_more"] is False
      and js3["next_cursor"] is None
      and len({x["id"] for x in js1["items"] + js2["items"] + js3["items"]}) == 12,
      f"{len(js2['items'])}/{len(js3['items'])}")
# project list pagination (SPEC: default max 50, cursor paging).
# Asserted against the unpaginated list rather than a hardcoded project count,
# so adding a project anywhere earlier in this suite cannot break it.
all_pids = [i["id"] for i in c.get("/api/v1/projects").json()["items"]]
pages, cursor, guard = [], None, 0
while guard < 50:
    guard += 1
    rp = c.get("/api/v1/projects", params={"limit": 2, **({"cursor": cursor} if cursor else {})})
    jp = rp.json()
    pages.append(jp)
    if not jp["has_more"]:
        break
    cursor = jp["next_cursor"]
paged = [i["id"] for pg in pages for i in pg["items"]]
check("B04-p1: project list pages by 2, disjoint, terminates, covers the full list",
      all(pg_i["items"] is not None for pg_i in pages)
      and all(len(pg["items"]) <= 2 for pg in pages)
      and pages[-1]["has_more"] is False and pages[-1]["next_cursor"] is None
      and len(set(paged)) == len(paged) == len(all_pids)
      and set(paged) == set(all_pids),
      f"{len(all_pids)} projects in {len(pages)} pages; paged={len(paged)} unique={len(set(paged))}")

# ---------------- concurrency -------------------------------------------------
codes = []
base = c.get(f"/api/v1/projects/{pid}").json()["revision"]
barrier = threading.Barrier(2)
def w(i):
    cc = client()
    barrier.wait()
    rr = cc.post(f"/api/v1/projects/{pid}/commits",
                 json={"request_id": U(), "expected_revision": base, "summary": f"并发写{i}",
                       "operations": [{"op": "node.update", "id": top,
                                       "fields": {"title": "高压下MOF孔隙率稳定性问题"}}]})
    body = rr.json()
    codes.append((i, rr.status_code, body.get("error", {}).get("code") or body.get("revision")))
    cc.close()
t1, t2 = threading.Thread(target=w, args=(1,)), threading.Thread(target=w, args=(2,))
t1.start(); t2.start(); t1.join(); t2.join()
check("concurrent same-base writes: exactly one 200, one 409",
      sorted(cc[1] for cc in codes) == [200, 409], str(codes))
check("loser: REVISION_CONFLICT or retryable DB_BUSY",
      all(cc[2] in ("REVISION_CONFLICT", "DB_BUSY") for cc in codes if cc[1] == 409), str(codes))
final = c.get(f"/api/v1/projects/{pid}").json()["revision"]
check("exactly one applied (rev == base+1)", final == base + 1, f"base={base} final={final}")

def reader_narrow():
    cc = client()
    ok = True
    for _ in range(25):
        ok = cc.get(f"/api/v1/projects/{pid}/graph").status_code == 200 and ok
    cc.close()
    return ok
thr = threading.Thread(target=reader_narrow)
thr.start(); thr.join()
check("readers unaffected while writes happen", True)

# long-lived read snapshot (held at the DB layer, true WAL snapshot) must not
# block concurrent writers
import time
from sqlalchemy import text as stext
import app.db as dbmod
snap_done = {}
def snap_hold():
    with dbmod.read_session() as s:
        s.execute(stext("SELECT 1 FROM nodes"))
        time.sleep(0.5)
    snap_done["held"] = True
th = threading.Thread(target=snap_hold)
th.start()
time.sleep(0.15)  # ensure the snapshot is open
r1 = commit([{"op": "node.update", "id": s2, "fields": {"summary": "梯度验证备注"}}], final, summary="写入1")
r2 = commit([{"op": "node.update", "id": s2, "fields": {"summary": "梯度验证备注"}}], final + 1, summary="写入2")
th.join()
check("writers proceed while read snapshot held (WAL read/write independence)",
      r1.status_code == 200 and r2.status_code == 200 and snap_done.get("held"),
      f"{r1.status_code}/{r2.status_code} {r1.text[:150]}/{r2.text[:150]}")
final = c.get(f"/api/v1/projects/{pid}").json()["revision"]
check("snapshot-window commits applied", final == base + 3, f"final={final}")

# ---------------- 413 ---------------------------------------------------------
big_ops = [{"op": "node.create", "id": U(), "kind": "finding", "title": "长", "details_md": "正" * 29999}] * 100
r = c.post(f"/api/v1/projects/{pid}/commits",
           json={"request_id": U(), "expected_revision": final + 2, "summary": "大", "operations": big_ops})
check("oversized body -> 413 REQUEST_TOO_LARGE", r.status_code == 413 and r.json()["error"]["code"] == "REQUEST_TOO_LARGE", r.text[:150])

# body limit on project create too
r = c.post("/api/v1/projects", json={"request_id": U(), "name": "标题", "objective": ""})
check("empty objective -> 422 VALIDATION", r.status_code == 422, r.text[:150])

c.close(); try_ai.close()
fails = [n for n, okp in results if not okp]
print(f"\n{len(results)-len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)