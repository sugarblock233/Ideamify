#!/usr/bin/env python3
"""综合压测：1000 节点 / 3000 关系，全部走 commit API。

流程：
  1. 启动独立 scratch 服务器（自己的 DB/端口，不动主库）
  2. create-project
  3. 分批提交：4 条一级路线 × 25 × 10 三层结构（1104 节点），
     随后 3000 条跨分支关系（确定性随机种子 1337；其中一个
     节点被 600 条关系指向，压力测分页）
  4. 服务端断言：无孤儿父、无环、深度有界、关系计数正确
  5. 延迟测量：graph / context（两种形态）/ search / relations 分页
  6. 导出 graph JSON 给前端布局测试（frontend/src/lib/__tests__/
     fixtures/stress-graph.json）
  7. 关闭服务器；任一断言失败 → 退出码 1

布局无碰撞断言在 vitest 侧执行：
  cd frontend && npx vitest run src/lib/__tests__/layout.stress.test.ts
"""

from __future__ import annotations

import json
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from statistics import median

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, "backend", ".venv", "bin", "python")
PORT = 8125
BASE = f"http://127.0.0.1:{PORT}"
WORK = "/tmp/rm-stress"
TOKEN = "stress-token-0001"

KINDS = ["question", "idea", "attempt", "finding"]
REL_KINDS = ["supports", "contradicts", "motivates", "depends_on", "related"]


# ------------------------------------------------------------------ http --
class C:
    def __init__(self) -> None:
        self.tom = 60.0

    def req(self, method: str, path: str, body: dict | None = None):
        r = urllib.request.Request(BASE + path, method=method)
        r.add_header("Authorization", f"Bearer {TOKEN}")
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            r.add_header("Content-Type", "application/json")
        t0 = time.monotonic()
        try:
            with urllib.request.urlopen(r, data, timeout=self.tom) as resp:
                out = json.loads(resp.read().decode("utf-8"))
                return resp.status, out, time.monotonic() - t0
        except urllib.error.HTTPError as e:
            err = json.loads(e.read().decode("utf-8"))
            return e.code, err, time.monotonic() - t0


cli = C()
FAILS: list[str] = []


def check(ok: bool, msg: str) -> None:
    print(("  ✓ " if ok else "  ✗ ") + msg)
    if not ok:
        FAILS.append(msg)


def uuid_at(i: int) -> str:
    return f"51111111-0000-4000-8000-{i:012x}"


# --------------------------------------------------------------- generate --
def gen_nodes():
    """(id, parent_id|None, order_index, kind, status, red: bool) 确定性。"""
    rng = random.Random(1337)
    rows = []
    top_ids = []
    for t in range(4):
        top_ids.append(uuid_at(1000 + t))
        rows.append((top_ids[-1], None, t, "question", "in_progress", False))
    n_red = 0
    for t, top in enumerate(top_ids):
        for l2 in range(25):
            id2 = uuid_at(2000 + t * 25 + l2)
            rows.append((id2, top, l2, KINDS[l2 % 4], "unexplored", False))
            for l3 in range(10):
                red = (l3 == 9 and l2 % 5 == 0)  # 4×5×1 = 20 个红节点
                id3 = uuid_at(3000 + t * 250 + l2 * 10 + l3)
                st = "not_supported" if red else rng.choice(
                    ["unexplored", "in_progress", "promising"])
                rows.append((id3, id2, l3, "attempt" if red else KINDS[l3 % 4],
                             st, red))
                n_red += red
    print(f"  节点计划：{len(rows)}（含 {n_red} 个红状态节点，附完整证据字段）")
    return rows


def node_ops(rows):
    ops = []
    for i, (nid, pid, order, kind, status, red) in enumerate(rows):
        op = {
            "op": "node.create", "id": nid, "parent_id": pid, "kind": kind,
            "title": f"压力节点 {i:04d}", "summary": f"摘要 {i:04d}：稳定文本负载",
            "status": status,
            "tags": [f"tag{i % 7}", "stress"],
        }
        if red:
            op.update({
                "scope": f"压力条件 {i:04d}（定长条件说明）",
                "finding": f"压力观察 {i:04d}（定长观察）",
                "decision": f"压力结论 {i:04d}（定长结论：放弃该配置）",
                "evidence": [{"kind": "inline", "label": "XRD",
                              "value": f"主相 {60 + i % 38}%（定长证据）"}],
            })
        ops.append(op)
    return ops


def gen_relations(hub_id: str):
    rng = random.Random(9001)
    pool = [uuid_at(3000 + i) for i in range(1000)]  # 全部 L3 节点
    seen: set[tuple] = set()
    ops = []
    guard = 0
    while len(ops) < 3000 and guard < 400000:
        guard += 1
        a, b = rng.sample(pool, 2)
        k = REL_KINDS[len(ops) % 5]
        # 换端点去重：服务器按"相同端点已存在"拒绝（与 kind 无关），
        # 用无序对做唯一键，保证 SQL `OR` 两方向都命中时也不会撞。
        pair = (a, b) if a < b else (b, a)
        if pair in seen:
            continue
        # 每 5 条关系 1 条指向 hub 作目标，凑出 600 条入边压分页
        if len(ops) % 5 == 0:
            if a == hub_id:
                a, b = b, a
            b = hub_id
            pair = (a, b) if a < b else (b, a)
            if pair in seen:
                continue
        seen.add(pair)
        ops.append({"op": "relation.create", "id": uuid_at(9000 + len(ops)),
                    "source_id": a, "target_id": b, "kind": k,
                    "reason": f"跨分支关系 {len(ops)}（确定性生成）"})
    if len(ops) < 3000:
        raise SystemExit(f"关系生成不足：只有 {len(ops)} 条")
    return ops


# ------------------------------------------------------------------ main --
def main() -> None:
    global PY
    if not os.path.exists(PY):
        PY = sys.executable
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK, exist_ok=True)

    env = {**os.environ,
           "RESEARCHMAP_DB": os.path.join(WORK, "data.db"),
           "RESEARCHMAP_TOKENS": json.dumps({"stress": TOKEN})}
    stdlog = open(os.path.join(WORK, "uvicorn.log"), "w", encoding="utf-8")
    proc = subprocess.Popen(
        [PY, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=os.path.join(ROOT, "backend"), env=env,
        stdout=stdlog, stderr=stdlog)
    try:
        run(proc)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def run(proc: subprocess.Popen) -> None:
    # 等待就绪
    for _ in range(100):
        try:
            with urllib.request.urlopen(BASE + "/healthz", timeout=1) as r:
                if r.status == 200:
                    break
        except Exception:
            time.sleep(0.2)
    else:
        raise SystemExit("服务器未就绪")

    # create-project
    st, out, _ = cli.req("POST", "/api/v1/projects", {
        "request_id": str(uuid.uuid4()), "name": "压力测试项目",
        "objective": "1000 节点 / 3000 关系的综合压测；数据可用性优先于可读性。"})
    check(st == 201 or st == 200, f"create-project → {st}")
    pid = out["id"]
    rev = out["revision"]

    rows = gen_nodes()
    t_all = time.monotonic()
    lat: list[float] = []
    outs = node_ops(rows)
    BATCH = 40
    for i in range(0, len(outs), BATCH):
        st, out, dt = cli.req("POST", f"/api/v1/projects/{pid}/commits", {
            "request_id": str(uuid.uuid4()), "expected_revision": rev,
            "summary": f"压测：节点批量 {i // BATCH + 1}",
            "client_label": "stress", "operations": outs[i:i + BATCH]})
        if st != 200:
            raise SystemExit(f"节点批量失败 st={st}: {json.dumps(out, ensure_ascii=False)[:300]}")
        rev = out["revision"]
        lat.append(dt)
    hub = uuid_at(3000)  # 第一条 L3 节点作关系枢纽（600 条入边）
    rels_ops = gen_relations(hub)
    for i in range(0, len(rels_ops), 50):
        st, out, dt = cli.req("POST", f"/api/v1/projects/{pid}/commits", {
            "request_id": str(uuid.uuid4()), "expected_revision": rev,
            "summary": f"压测：关系批量 {i // 50 + 1}",
            "client_label": "stress", "operations": rels_ops[i:i + 50]})
        if st != 200:
            raise SystemExit(f"关系批量失败 st={st}: {json.dumps(out, ensure_ascii=False)[:300]}")
        rev = out["revision"]
        lat.append(dt)
    build_s = time.monotonic() - t_all
    print(f"  提交完成：{len(outs) + len(rels_ops)} 个操作 / "
          f"{len(outs) // BATCH + len(rels_ops) // 50} 个 commit，耗时 {build_s:.1f}s"
          f"（p50 {median(lat) * 1000:.0f}ms，"
          f"p95 {sorted(lat)[int(len(lat) * 0.95)] * 1000:.0f}ms，"
          f"max {max(lat) * 1000:.0f}ms）")

    # ---- 服务端结构断言 ----
    st, g, dt_g = cli.req("GET", f"/api/v1/projects/{pid}/graph")
    check(st == 200, f"graph → {st}（{dt_g * 1000:.0f}ms）")
    nodes = g["nodes"]
    by_id = {n["id"]: n for n in nodes}
    check(len(by_id) == len(nodes), "节点 id 唯一")
    check(g["project_revision"] == rev, f"graph revision 一致（{g['project_revision']}）")
    orphans = [n["id"] for n in nodes
               if n["parent_id"] is not None and n["parent_id"] not in by_id]
    check(not orphans, f"无孤儿父节点（{len(orphans)}）")
    cycle = bad_depth = 0
    max_depth = 0
    for n in nodes:
        cur, depth, seen = n["id"], 0, {n["id"]}
        while cur is not None and cur in by_id:
            cur = by_id[cur]["parent_id"]
            depth += 1
            if cur is not None and cur in seen:
                cycle += 1
                break
        if depth > max_depth:
            max_depth = depth
        if depth > 8:
            bad_depth += 1
    check(cycle == 0, f"无父链环（{cycle}）")
    check(max_depth <= 8, f"最大深度 {max_depth} ≤ 8")
    check(bad_depth == 0, "无超深节点")
    print(f"  graph 计数：节点 {len(nodes)}，relation_count 合计 "
          f"{sum(n['relation_count'] for n in nodes) // 2}，"
          f"child_count 根和 {sum(n['child_count'] for n in nodes)}，"
          f"hub 入边 {by_id[hub]['relation_count']}")

    # ---- 延迟测量 ----
    measure: list[tuple[str, float, int]] = [("graph（1104 节点）", dt_g, len(json.dumps(g)))]
    st, c1, d1 = cli.req("GET",
        f"/api/v1/projects/{pid}/context?max_chars=50000")
    check(st == 200, "context（无 focus，50000）→ 200")
    measure.append(("context 50000 无 focus", d1, len(json.dumps(c1))))
    leaf = uuid_at(3990)
    st, c2, d2 = cli.req("GET",
        f"/api/v1/projects/{pid}/context?max_chars=12000&focus_node_id={leaf}")
    check(st == 200, "context（focus 到 L3 叶）→ 200")
    measure.append(("context 12000 含 focus", d2, len(json.dumps(c2))))
    st, s1, d3 = cli.req("GET", f"/api/v1/projects/{pid}/search?q=tag3")
    check(st == 200, f"search q=tag3 → 200（total={s1.get('total')}）")
    measure.append(("search", d3, len(json.dumps(s1))))

    st, r1, d4 = cli.req(
        "GET", f"/api/v1/projects/{pid}/nodes/{hub}/relations?limit=100")
    check(st == 200, f"relations 分页 limit=100（{len(r1['items'])} 条, "
                     f"has_more={r1.get('has_more')}）")
    page2 = None
    if r1.get("next_cursor"):
        st, r2, d5 = cli.req("GET",
            f"/api/v1/projects/{pid}/nodes/{hub}/relations?limit=100&cursor={r1['next_cursor']}")
        check(st == 200, f"relations 第二页 → 200（{len(r2['items'])} 条）")
        page2 = len(r2["items"])
    measure.append(("relations 分页一页", d4, len(json.dumps(r1))))

    # ---- 导出给前端布局测试 ----
    fixture = os.path.join(ROOT, "frontend", "src", "lib", "__tests__",
                           "fixtures", "stress-graph.json")
    os.makedirs(os.path.dirname(fixture), exist_ok=True)
    slim = {"project_revision": g["project_revision"], "nodes": [
        {k: n[k] for k in ("id", "parent_id", "order_index", "kind", "title",
                           "summary", "status", "tags", "evidence_count",
                           "child_count", "relation_count", "created_at",
                           "updated_at", "created_by")} for n in nodes]}
    with open(fixture, "w", encoding="utf-8") as f:
        json.dump(slim, f, ensure_ascii=False)
    print(f"  布局 fixture 已写出：{fixture}（{os.path.getsize(fixture) // 1024} KiB）")

    # ---- 汇总 ----
    print("\n=== 延迟汇总（ms）===")
    for name, dt, bytes_ in measure:
        print(f"  {name:<28} {dt * 1000:8.0f} ms   ({bytes_ // 1024} KiB 响应)")
    print("\n压测" + ("失败：" if FAILS else "通过。"))
    for m in FAILS:
        print("  ✗", m)
    raise SystemExit(1 if FAILS else 0)


if __name__ == "__main__":
    main()