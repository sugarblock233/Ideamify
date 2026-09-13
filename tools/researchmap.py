#!/usr/bin/env python3
"""ResearchMap CLI — how external AIs read and commit to the shared map.

Same server, same commit endpoint, same conflict semantics as the web UI;
this tool only speaks HTTP (stdlib urllib, no third-party deps).

Environment:
  RESEARCHMAP_BASE_URL  base URL            (default: http://127.0.0.1:8000)
  RESEARCHMAP_TOKEN     bearer access token (required for /api/*)

Typical AI session (independent terminal):
  researchmap.py session
  researchmap.py context <PID> --focus <NODE_ID> --max-chars 12000
  researchmap.py commit <PID> ops.json --auto-rev
  # on 409 REVISION_CONFLICT: re-read context, then re-submit the same request
  # with a fresh expected_revision (--auto-rev). A 409 commit was NOT recorded,
  # so keeping the original request_id is safe; only a request_id already
  # committed with different content trips IDEMPOTENCY_KEY_REUSED.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_BASE = os.environ.get("RESEARCHMAP_BASE_URL", "http://127.0.0.1:8000")


class Client:
    def __init__(self, base: str, token: str | None):
        self.base = base.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int, dict | bytes]:
        url = self.base + path
        headers = {"accept": "application/json"}
        if self.token:
            headers["authorization"] = f"Bearer {self.token}"
        data = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["content-type"] = "application/json"
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                ctype = resp.headers.get("content-type", "")
                if "json" in ctype or not raw:
                    return resp.status, (json.loads(raw) if raw else {})
                return resp.status, raw
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw
        except urllib.error.URLError as e:
            print(f"网络错误：无法连接 {url}（{e.reason}）", file=sys.stderr)
            sys.exit(2)


def emit(payload, *, raw: bool = False):
    if raw and isinstance(payload, (bytes, bytearray)):
        sys.stdout.buffer.write(bytes(payload))
        if not payload.endswith(b"\n"):
            sys.stdout.buffer.write(b"\n")
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def get_json(client: Client, path: str, *vals):
    path = path.format(*vals)
    status, body = client.call("GET", path)
    if status != 200:
        print(json.dumps(body if isinstance(body, dict) else {"raw": str(body)[:400]},
                         ensure_ascii=False, indent=2), file=sys.stderr)
        sys.exit(1)
    return body


def post(client: Client, path: str, body: dict) -> dict:
    status, out = client.call("POST", path, body)
    if status in (200, 201):
        return out if isinstance(out, dict) else {}
    msg = out if isinstance(out, dict) else {"raw": str(out)[:400]}
    err = msg.get("error", msg) if isinstance(msg, dict) else msg
    print(json.dumps(err, ensure_ascii=False, indent=2), file=sys.stderr)
    # Machine-readable hint on conflict so AI drivers can branch on it.
    # The conflicting commit was NOT recorded, so the same request_id can be
    # reused once expected_revision is refreshed (e.g. --auto-rev).
    if isinstance(err, dict) and err.get("code") == "REVISION_CONFLICT":
        print("提示：服务器已被他人更新。请重新读取 context 后，用最新 "
              "expected_revision（--auto-rev）重试；本次提交未被记录，"
              "可以保留原来的 request_id。", file=sys.stderr)
    sys.exit(1)


def common_args(p: argparse.ArgumentParser):
    p.add_argument("--base", default=DEFAULT_BASE, help="服务器地址")
    p.add_argument("--token", default=os.environ.get("RESEARCHMAP_TOKEN"),
                   help="访问令牌（默认取环境变量 RESEARCHMAP_TOKEN）")


def make_client(args) -> Client:
    if not getattr(args, "token", None):
        print("缺少访问令牌：请设置 RESEARCHMAP_TOKEN 或 --token", file=sys.stderr)
        sys.exit(2)
    return Client(args.base, args.token)


# ---------------------------------------------------------------- commands

def cmd_health(args):
    c = Client(args.base, None)
    status, body = c.call("GET", "/healthz")
    print(f"HTTP {status} {json.dumps(body, ensure_ascii=False)}")
    sys.exit(0 if status == 200 else 1)


def cmd_session(args):
    emit(get_json(make_client(args), "/api/v1/session"))


def cmd_projects(args):
    emit(get_json(make_client(args), "/api/v1/projects"))


def cmd_project(args):
    emit(get_json(make_client(args), "/api/v1/projects/{0}", args.project_id))


def cmd_graph(args):
    g = get_json(make_client(args), "/api/v1/projects/{0}/graph", args.project_id)
    if args.json:
        emit(g)
        return
    print(f"project_revision={g.get('project_revision')}  nodes(未归档)={len(g.get('nodes', []))}")
    for n in g.get("nodes", []):
        tags = ",".join(n["tags"]) or "-"
        print(f"  {n['kind']:<8} {n['title'][:60]:<60} "
              f"[{n['status']}, 子={n['child_count']}, 关联={n['relation_count']}, tags={tags}]")
        print(f"    id={n['id']}  parent={n['parent_id'] or '(一级)'}  order={n['order_index']}")


def cmd_node(args):
    emit(get_json(make_client(args), "/api/v1/projects/{0}/nodes/{1}",
                  args.project_id, args.node_id))


def cmd_relations(args):
    params = []
    if args.include_archived:
        params.append("include_archived=true")
    if args.cursor:
        params.append(f"cursor={urllib.parse.quote(args.cursor)}")
    params.append(f"limit={args.limit}")
    qs = "&".join(params)
    body = get_json(make_client(args),
                    f"/api/v1/projects/{args.project_id}/nodes/{args.node_id}/relations?{qs}")
    emit(body)


def cmd_search(args):
    q = urllib.parse.quote(args.query)
    emit(get_json(make_client(args),
                  f"/api/v1/projects/{args.project_id}/search?q={q}&limit={args.limit}"))


def cmd_commits(args):
    params = [f"limit={args.limit}"]
    if args.node:
        params.append(f"node_id={args.node}")
    if args.cursor:
        params.append(f"cursor={urllib.parse.quote(args.cursor)}")
    emit(get_json(make_client(args),
                  f"/api/v1/projects/{args.project_id}/commits?{'&'.join(params)}"))


def cmd_commit_detail(args):
    emit(get_json(make_client(args),
                  f"/api/v1/projects/{args.project_id}/commits/{args.commit_id}"))


def cmd_context(args):
    params = [f"max_chars={args.max_chars}"]
    if args.focus:
        params.append(f"focus_node_id={args.focus}")
    if args.q:
        params.append(f"q={urllib.parse.quote(args.q)}")
    qs = "&".join(params)
    emit(get_json(make_client(args),
                  f"/api/v1/projects/{args.project_id}/context?{qs}"))


def cmd_commit(args):
    c = make_client(args)
    try:
        with open(args.ops_file, encoding="utf-8") as f:
            body = json.load(f)
    except Exception as e:
        print(f"提交文件读取失败：{e}", file=sys.stderr)
        sys.exit(2)
    if not isinstance(body, dict) or "operations" not in body:
        print("提交文件必须是 {…‘operations': [op, …]} 形式的 CommitRequest 主体",
              file=sys.stderr)
        sys.exit(2)

    # fill missing idempotency / revision / summary with live values
    if "request_id" not in body:
        body["request_id"] = str(uuid.uuid4())
    if "expected_revision" not in body or args.auto_rev:
        proj = get_json(c, "/api/v1/projects/{0}", args.project_id)
        body["expected_revision"] = proj["revision"]
    if "summary" not in body:
        body["summary"] = "commit via researchmap CLI"
    if not isinstance(body.get("operations"), list) or not body["operations"]:
        print("operations 必须为非空数组", file=sys.stderr)
        sys.exit(2)

    path = f"/api/v1/projects/{args.project_id}/commits"
    if args.dry_run:
        path += "?dry_run=true"
    out = post(c, path, body)
    emit(out)


def cmd_create_project(args):
    c = make_client(args)
    body = {"request_id": str(uuid.uuid4()),
            "name": args.name, "objective": args.objective}
    out = post(c, "/api/v1/projects", body)
    emit(out)


def cmd_export(args):
    c = make_client(args)
    status, raw = c.call("GET", f"/api/v1/projects/{args.project_id}/export")
    if status != 200:
        print(str(raw)[:400], file=sys.stderr)
        sys.exit(1)
    if isinstance(raw, dict):
        raw = json.dumps(raw, ensure_ascii=False, indent=2).encode()
    if args.out:
        with open(args.out, "wb") as f:
            f.write(raw if isinstance(raw, bytes) else str(raw).encode())
        print(f"已导出 → {args.out}（{len(raw)} 字节，含归档与全部历史）")
    else:
        emit(raw, raw=True)


# ------------------------------------------------------------------- main

def main(argv=None):
    p = argparse.ArgumentParser(prog="researchmap", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("health", help="存活检查（无需令牌）")
    s.add_argument("--base", default=DEFAULT_BASE)
    s.set_defaults(fn=cmd_health)

    s = sub.add_parser("session", help="当前令牌身份")
    common_args(s); s.set_defaults(fn=cmd_session)

    s = sub.add_parser("projects", help="项目列表")
    common_args(s); s.set_defaults(fn=cmd_projects)

    s = sub.add_parser("project", help="项目元信息")
    common_args(s); s.add_argument("project_id"); s.set_defaults(fn=cmd_project)

    s = sub.add_parser("graph", help="主树节点列表（layout 输入）")
    common_args(s); s.add_argument("project_id"); s.add_argument("--json", action="store_true")
    s.set_defaults(fn=cmd_graph)

    s = sub.add_parser("node", help="节点完整内容")
    common_args(s); s.add_argument("project_id"); s.add_argument("node_id")
    s.set_defaults(fn=cmd_node)

    s = sub.add_parser("relations", help="节点关联（分页）")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("node_id")
    s.add_argument("--include-archived", action="store_true")
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--cursor", default=None)
    s.set_defaults(fn=cmd_relations)

    s = sub.add_parser("search", help="搜索（标题/摘要/标签/观察/结论）")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("query"); s.add_argument("--limit", type=int, default=30)
    s.set_defaults(fn=cmd_search)

    s = sub.add_parser("commits", help="提交历史")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("--node", default=None)
    s.add_argument("--limit", type=int, default=20); s.add_argument("--cursor", default=None)
    s.set_defaults(fn=cmd_commits)

    s = sub.add_parser("commit-detail", help="单个提交的 operations/changes")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("commit_id")
    s.set_defaults(fn=cmd_commit_detail)

    s = sub.add_parser("context", help="预算化上下文（AI 的首要读取入口）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--focus", default=None, help="focus_node_id")
    s.add_argument("--q", default=None, help="关键词上下文")
    s.add_argument("--max-chars", type=int, default=12000)
    s.set_defaults(fn=cmd_context)

    s = sub.add_parser("commit", help="提交（写入唯一入口）")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("ops_file")
    s.add_argument("--dry-run", action="store_true", help="不落库，演练校验")
    s.add_argument("--auto-rev", action="store_true",
                   help="自动读取当前 revision 作为 expected_revision")
    s.set_defaults(fn=cmd_commit)

    s = sub.add_parser("create-project", help="创建项目")
    common_args(s)
    s.add_argument("name"); s.add_argument("objective")
    s.set_defaults(fn=cmd_create_project)

    s = sub.add_parser("export", help="导出完整 JSON（含归档与历史）")
    common_args(s)
    s.add_argument("project_id"); s.add_argument("--out", default=None)
    s.set_defaults(fn=cmd_export)

    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()