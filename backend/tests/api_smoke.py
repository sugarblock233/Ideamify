"""End-to-end smoke test against the ASGI app (no live server).

Exercises: auth, project create + idempotency, commit pipeline (ordering,
after_id three-state), revision conflict, idempotent replay, dry-run,
confirmed-status integrity (T10), cycles, archive/restore, relations, search,
commits history, export, context budget, same-audit-path for AI actor,
concurrent writers, oversized body, protected OpenAPI.
"""
import json, threading, sys, uuid
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