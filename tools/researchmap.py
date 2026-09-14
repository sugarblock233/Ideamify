#!/usr/bin/env python3
"""ResearchMap CLI — a thin HTTP client for the shared research-evolution map.

The web UI and this tool call the exact same server, the same commit
endpoint, and honor the same conflict rules. Stdlib only (urllib), no
third-party dependencies, no direct database access.

Credentials — environment variables only. Do NOT put the token on the
command line, in files, URLs or logs (SPEC 7.3 / A05):
  RESEARCHMAP_BASE_URL   server base URL       (default: http://127.0.0.1:8000)
  RESEARCHMAP_URL        SPEC alias — consulted only when RESEARCHMAP_BASE_URL
                         is unset (RESEARCHMAP_BASE_URL wins)
  RESEARCHMAP_TOKEN      bearer access token   (required for every /api/* command)
  An explicit --base flag (subcommand level) overrides both base-URL vars.

Output contract (stable for automation):
  stdout   on success: exactly ONE machine-parseable JSON object — the
           server response, emitted as-is. Exceptions: `context --format
           markdown` (documented human view) and `graph --text`.
           Human notes (e.g. "wrote missing id fields into your file") go
           to stderr on success, never stdout.
  stderr   on failure: exactly ONE JSON object, nothing before or after it:
             {"ok": false,
              "error": {"status": <http status | null>, "code": <str>,
                        "message": <str>, "response": <server body | null>},
              "hint": "<str, optional>",
              "notes": ["<str>", …]}   # side effects that already happened,
                                       # e.g. identity fields written back
           Chinese may appear inside string fields; the structure is fixed.
  exit     0  success (HTTP 2xx)
           1  local / usage error (bad file, missing token, argparse)
           2  HTTP 409 conflict (REVISION_CONFLICT, IDEMPOTENCY_KEY_REUSED,
              DUPLICATE_RELATION, PAGINATION_STALE)
           3  HTTP 422 validation (request body / parameters)
           4  network failure, or HTTP 5xx (server down, DB_BUSY)
           5  any other non-2xx status (400/401/403/404/413 …)

Commit identity (safe retries, A05):
  One logical commit = one stable, complete request body shared by dry-run,
  real commit, and network retries. If the file lacks `request_id` or
  `expected_revision`, the CLI generates the value and PERSISTS it back into
  the file (atomic rewrite) with a human note on stderr. Running the same
  command twice then sends byte-identical bodies: first run commits,
  second run is an idempotent replay (already_committed: true).
  Once both fields are present the CLI never modifies them — including with
  --auto-rev. A stale expected_revision therefore yields 409; you must
  re-read the map and rewrite the file explicitly.

Typical AI session (independent terminal):
  export RESEARCHMAP_BASE_URL=http://127.0.0.1:8000
  export RESEARCHMAP_TOKEN=<token from the researcher>
  researchmap.py health
  researchmap.py context <PID> --focus <NODE> --q "keyword" --max-chars 12000
  researchmap.py commit <PID> ops.json --dry-run
  researchmap.py commit <PID> ops.json
  # 409 REVISION_CONFLICT  → the commit was NOT written; re-read, then
  #                           explicitly rewrite the file (new base), retry
  #   (reusing the original request_id is legal: a 409 leaves no record)
  # 200 but response lost  → resending the SAME file is an idempotent replay
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

DEFAULT_BASE = "http://127.0.0.1:8000"
TIMEOUT = 30

# Exit codes (documented in --help and docs/AI_USAGE.md)
EXIT_OK = 0
EXIT_LOCAL = 1      # local/usage error: unreadable file, missing token, argparse
EXIT_CONFLICT = 2   # HTTP 409
EXIT_VALIDATION = 3  # HTTP 422
EXIT_SERVER = 4     # network failure or HTTP 5xx/503
EXIT_HTTP = 5       # any other non-2xx

EPILOG = """\
exit codes
  0  success (HTTP 2xx)
  1  local/usage error (bad ops file, missing RESEARCHMAP_TOKEN, argparse)
  2  HTTP 409 conflict (REVISION_CONFLICT / IDEMPOTENCY_KEY_REUSED / …)
  3  HTTP 422 validation (request body / parameters)
  4  network failure, or HTTP 5xx (server down, DB_BUSY — retryable)
  5  any other non-2xx status (400/401/403/404/413)

output contract
  stdout: on success exactly ONE JSON object (the server response), except
          `context --format markdown` and `graph --text`.
  stderr: on failure exactly ONE JSON object
          {"ok": false, "error": {"status", "code", "message", "response"},
           "hint"?} — no prose is appended after the JSON.

commit identity (safe retries)
  Missing request_id / expected_revision are generated and written back into
  the ops file (stderr note). The file is the replayable artifact: rerunning
  the same command replays the identical request (already_committed: true).
  Once both fields exist they are never changed — not by --auto-rev. On a
  409 the CLI does not refresh the revision for you; re-read the map and
  rewrite the file explicitly, then retry (same request_id is legal after a
  409 because nothing was recorded).

aliases
  context:  --node = --focus   --query = --q   --format json|markdown
  export:   --output = --out
  commit / create-project: positional file/args coexist with --file
"""


class NetError(Exception):
    """Connection-level failure (no HTTP status available)."""

    def __init__(self, message: str, code: str = "NETWORK_ERROR"):
        super().__init__(message)
        self.code = code


class Client:
    def __init__(self, base: str, token: str | None):
        self.base = (base or DEFAULT_BASE).rstrip("/")
        self.token = token


def _parse_body(raw: bytes):
    if not raw:
        return None
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return raw.decode("utf-8", "replace")[:4000]


def call_api(client: Client, method: str, path: str,
             body: dict | None = None) -> tuple[int, object]:
    """One HTTP round-trip. Returns (status, parsed-body). NetError on
    connection failure / timeout (no usable status)."""
    url = client.base + path
    headers = {"accept": "application/json"}
    if client.token:
        headers["authorization"] = f"Bearer {client.token}"
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status, _parse_body(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, _parse_body(e.read())
    except urllib.error.URLError as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, (TimeoutError,)) or "timed out" in str(reason).lower():
            raise NetError(f"timeout after {TIMEOUT}s: {url}", code="TIMEOUT")
        raise NetError(f"cannot connect to {url}: {reason}")
    except (TimeoutError, ConnectionError, OSError) as e:
        raise NetError(f"cannot connect to {url}: {e}")


# ---------------------------------------------------------------------------
# output / errors
# ---------------------------------------------------------------------------

def emit(payload) -> None:
    """The only stdout writer: one machine-parseable JSON object."""
    if payload is None:
        print("{}")
    elif isinstance(payload, (dict, list)):
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(str(payload))


# A05/R06: human notes are buffered, not written straight through. The
# convenience path writes identity fields back to the request file BEFORE the
# HTTP call, so a note emitted there would sit on stderr ahead of the error
# object if the call then failed — breaking "stderr on failure = exactly ONE
# JSON object". Buffered notes are flushed on success and folded into the
# error object (as `notes`) on failure.
_PENDING_NOTES: list[str] = []


def note(msg: str) -> None:
    """Human note (stdout stays machine-only). Deferred, see _PENDING_NOTES."""
    _PENDING_NOTES.append(msg)


def flush_notes() -> None:
    """Emit buffered notes to stderr. Only ever called on a success path."""
    while _PENDING_NOTES:
        sys.stderr.write(_PENDING_NOTES.pop(0) + "\n")


def _exit_for(status: int | None) -> int:
    if status is None:
        return EXIT_SERVER
    if status == 409:
        return EXIT_CONFLICT
    if status == 422:
        return EXIT_VALIDATION
    if status >= 500:
        return EXIT_SERVER
    return EXIT_HTTP


def fail(status: int | None, code: str, message: str,
         response: object = None, hint: str | None = None,
         exit_code: int | None = None) -> None:
    """Exactly one JSON object on stderr, then exit with a stable code."""
    obj = {"ok": False,
           "error": {"status": status, "code": code,
                     "message": message, "response": response}}
    if hint:
        obj["hint"] = hint
    if _PENDING_NOTES:
        # Side effects that already happened (e.g. identity fields written back
        # into the request file) belong in this object, not beside it.
        obj["notes"] = list(_PENDING_NOTES)
        _PENDING_NOTES.clear()
    sys.stderr.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.exit(exit_code if exit_code is not None else _exit_for(status))


def fail_local(code: str, message: str, hint: str | None = None,
               exit_code: int = EXIT_LOCAL) -> None:
    fail(None, code, message, response=None, hint=hint, exit_code=exit_code)


def _hint(status: int | None, code: str | None) -> str | None:
    if code in ("NETWORK_ERROR", "TIMEOUT"):
        return ("网络不可达或超时。若请求实际已发出但回执丢失，原样重放"
                "（同一文件的同一 body / request_id）是安全的幂等操作；"
                "服务器会返回原回执并置 already_committed=true。")
    if status == 409:
        return {
            "REVISION_CONFLICT": (
                "服务器版本已被推进；本次提交完全没有写入。请重新读取 "
                "context/commits 弄清谁改了什么，然后显式重写提交文件："
                "把 expected_revision 更新为当前值并合并 operations 的冲突。"
                "409 未留下任何提交记录，因此保留原 request_id 重提是合法的。"
                "CLI 不会替你刷新文件里已有 revision（离线准备以防误覆盖）。"),
            "IDEMPOTENCY_KEY_REUSED": (
                "该 request_id 已被不同内容成功提交过。想重放原提交：原样重发"
                "当初的 body（同一文件）。想提交新内容：换一个新的 request_id。"
                "切勿对已成功提交的请求修改任何字段后重发。"),
            "DUPLICATE_RELATION": (
                "相同端点与类型的未归档关系已存在（details.existing_relation_id）。"
                "改用 relation.update / relation.restore，不要重复创建。"),
            "PAGINATION_STALE": (
                "分页期间项目版本变化；请放弃游标，从头重新分页。"),
        }.get(code or "", "HTTP 409 冲突；先重读服务器状态再决定重试方式。")
    if status == 422:
        return ("请求体/参数校验失败，服务器未写入任何内容。"
                "按 response.error.details（issues / operation_index / field）"
                "修正提交文件后重试。")
    if status == 401:
        return "令牌缺失或无效；请核对 RESEARCHMAP_TOKEN 环境变量（令牌不要写在命令行里）。"
    if status == 404:
        return "项目/节点/提交不存在或不属于该项目；先用 `projects` 核对 PID 与对象 ID。"
    if status == 413:
        return "请求体超过 2 MiB；把 operations 拆成更小的批次（每批 1–100 条）。"
    if status is not None and status >= 500:
        return ("服务器错误。重试前先重读项目状态；重试保持相同 request_id，"
                "不要改动请求体（幂等重放是安全的）。")
    return None


def respond(status: int, body) -> None:
    """Terminal handler for any HTTP exchange: emit + exit 0, or
    structured stderr JSON + mapped exit code."""
    if 200 <= status < 300:
        emit(body)
        flush_notes()
        sys.exit(EXIT_OK)
    code: str | None = None
    message = ""
    response = body
    if isinstance(body, dict):
        e = body.get("error")
        if isinstance(e, dict):
            code = e.get("code") or f"HTTP_{status}"
            message = e.get("message") or ""
        else:
            code = f"HTTP_{status}"
            message = str(body)[:400]
    else:
        code = f"HTTP_{status}"
        message = str(body)[:400] if body is not None else "（空响应体）"
    fail(status, code, message, response=response, hint=_hint(status, code))


def get_or_die(client: Client, path: str) -> object:
    status, body = call_api(client, "GET", path)
    if not (200 <= status < 300):
        respond(status, body)  # exits (non-2xx)
    return body


# ---------------------------------------------------------------------------
# client factory / identity file helpers
# ---------------------------------------------------------------------------

def resolve_base(args) -> str:
    if getattr(args, "base", None):
        return args.base
    return (os.environ.get("RESEARCHMAP_BASE_URL", "").strip()
            or os.environ.get("RESEARCHMAP_URL", "").strip()
            or DEFAULT_BASE)


def make_client(args) -> Client:
    token = os.environ.get("RESEARCHMAP_TOKEN", "").strip()
    if not token:
        fail_local("MISSING_TOKEN",
                   "缺少访问令牌：请设置环境变量 RESEARCHMAP_TOKEN"
                   "（按合同，令牌不接受出现在命令行参数、文件或日志中）。")
    return Client(resolve_base(args), token)


def load_json_file(path: str, what: str):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        fail_local("LOCAL_FILE_MISSING", f"{what} 文件不存在：{path}")
    except (OSError, ValueError) as e:
        fail_local("LOCAL_BAD_JSON", f"{what} 文件不是合法 JSON（{path}）：{e}")


def save_json_file(path: str, data: dict) -> None:
    """Atomic-ish rewrite so a crash cannot leave a torn request file."""
    directory = os.path.dirname(os.path.abspath(path)) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".rm-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    except OSError as e:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        fail_local("LOCAL_SAVE_FAILED", f"无法回写身份字段到 {path}：{e}")


def _prepare_identity(path: str, body: dict, client: Client, pid: str) -> None:
    """Fill missing request_id / expected_revision and persist them.

    Never overwrites fields that are already present — --auto-rev included.
    """
    changed = []
    if not body.get("request_id"):
        body["request_id"] = str(uuid.uuid4())
        changed.append(f"request_id={body['request_id']}（新生成）")
    if body.get("expected_revision") is None:
        proj = get_or_die(client, f"/api/v1/projects/{pid}")
        body["expected_revision"] = proj["revision"]
        changed.append(
            f"expected_revision={proj['revision']}（= 读取时的当前项目 revision）")
    if "summary" not in body:
        body["summary"] = "commit via researchmap CLI"  # deterministic, body-only
    if changed:
        save_json_file(path, body)
        for field_note in changed:
            note(f"[researchmap] 已写入 {path}：{field_note}。"
                 f"此后重复执行同一命令即为同一请求的安全重放。")


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------

def cmd_health(args):
    client = Client(resolve_base(args), None)
    status, body = call_api(client, "GET", "/healthz")
    respond(status, body)


def cmd_session(args):
    emit(get_or_die(make_client(args), "/api/v1/session"))


def cmd_projects(args):
    emit(get_or_die(make_client(args), "/api/v1/projects"))


def cmd_project(args):
    emit(get_or_die(make_client(args), f"/api/v1/projects/{args.project_id}"))


def cmd_graph(args):
    client = make_client(args)
    status, g = call_api(client, "GET", f"/api/v1/projects/{args.project_id}/graph")
    if not (200 <= status < 300):
        respond(status, g)
        return
    if args.text:
        print(f"project_revision={g.get('project_revision')}"
              f"  nodes(未归档)={len(g.get('nodes', []))}")
        for n in g.get("nodes", []):
            tags = ",".join(n.get("tags") or []) or "-"
            print(f"  {n['kind']:<8} {n['title'][:60]:<60} "
                  f"[{n['status']}, 子={n['child_count']}, "
                  f"关联={n['relation_count']}, tags={tags}]")
            print(f"    id={n['id']}  parent={n['parent_id'] or '(一级)'}"
                  f"  order={n['order_index']}")
    else:
        emit(g)


def cmd_node(args):
    emit(get_or_die(make_client(args),
                    f"/api/v1/projects/{args.project_id}/nodes/{args.node_id}"))


def cmd_relations(args):
    client = make_client(args)
    params = []
    if args.include_archived:
        params.append("include_archived=true")
    if args.cursor:
        params.append(f"cursor={urllib.parse.quote(args.cursor, safe='')}")
    params.append(f"limit={args.limit}")
    emit(get_or_die(client,
                    f"/api/v1/projects/{args.project_id}"
                    f"/nodes/{args.node_id}/relations?{'&'.join(params)}"))


def cmd_attachments(args):
    """D4: 受管附件元数据列表（只读）。字节不经 CLI——写入与下载一律走
    UI/API，令牌永不落盘见 DECISIONS §18。"""
    client = make_client(args)
    params = []
    if args.cursor:
        params.append(f"cursor={urllib.parse.quote(args.cursor, safe='')}")
    params.append(f"limit={args.limit}")
    emit(get_or_die(client,
                    f"/api/v1/projects/{args.project_id}"
                    f"/attachments?{'&'.join(params)}"))


def cmd_search(args):
    client = make_client(args)
    q = urllib.parse.quote(args.query, safe="")
    emit(get_or_die(client,
                    f"/api/v1/projects/{args.project_id}/search?q={q}"
                    f"&limit={args.limit}"))


def cmd_commits(args):
    client = make_client(args)
    params = [f"limit={args.limit}"]
    if args.node:
        params.append(f"node_id={args.node}")
    if args.cursor:
        params.append(f"cursor={urllib.parse.quote(args.cursor, safe='')}")
    emit(get_or_die(client,
                    f"/api/v1/projects/{args.project_id}/commits?{'&'.join(params)}"))


def cmd_commit_detail(args):
    emit(get_or_die(make_client(args),
                    f"/api/v1/projects/{args.project_id}/commits/{args.commit_id}"))


#: Analysis fields the server may attach to ANY context item, not just the
#: focus node — prior_attempts and related_nodes carry them too (B05/R07). The
#: markdown view must not quietly drop the very fields that say why an earlier
#: attempt failed and under which conditions.
_ITEM_FIELDS = (("scope", "适用条件"), ("finding", "直接观察"),
                ("decision", "当前解释与决定"), ("tags", "标签"))


def _item_detail_lines(d: dict, indent: str = "  ") -> list[str]:
    return [f"{indent}- {label} {key}: {d[key]}" for key, label in _ITEM_FIELDS
            if d.get(key)]


def render_context_markdown(r: dict) -> str:
    """Human-readable rendering of the context response. Still carries
    revision, node IDs, statuses, the data-not-instructions notice, omitted
    counts and continuation entries.

    Note: --max-chars is the budget for the JSON the server builds; this view
    is a pure rendering of that JSON and is not itself re-limited, so its
    length differs from max_chars. Truncation marks ("…[截断]") and every
    omitted count come through unchanged."""
    L: list[str] = []
    p = r.get("project") or {}
    L.append(f"# ResearchMap 上下文：{p.get('name', '?')}")
    L.append("")
    L.append(f"- project: `{p.get('id')}`")
    L.append(f"- 目标：{p.get('objective', '')}")
    L.append(f"- **project_revision: {r.get('project_revision')}**"
             f"（下一次写入的 expected_revision 基线）")
    L.append(f"- truncated: {str(bool(r.get('truncated'))).lower()}")

    focus = r.get("focus")
    if focus:
        L += ["", "## 焦点节点",
              f"- `{focus.get('id')}` {focus.get('kind', '')} "
              f"「{focus.get('title', '')}」 [{focus.get('status', '')}]"]
        if focus.get("summary"):
            L.append(f"- 摘要 summary: {focus['summary']}")
        L += _item_detail_lines(focus, indent="")

    if r.get("ancestor_path"):
        L += ["", "## 祖先路径（根 → 焦点）"]
        for i, a in enumerate(r["ancestor_path"], 1):
            L.append(f"{i}. 「{a.get('title', '')}」 `{a.get('id')}` "
                     f"[{a.get('status', '')}]")

    for key, head in (
        ("related_nodes", "## 直接关联（反证/依赖优先；reason ≤ 240 字符）"),
        ("prior_attempts", "## 同分支先前的失败/未决"),
        ("open_nodes", "## 待探索子节点"),
        ("routes", "## 一级路线"),
        ("recent_findings", "## 近期发现"),
        ("matched", "## 关键词命中"),
    ):
        items = r.get(key) or []
        if not items:
            continue
        L += ["", head]
        for d in items:
            line = f"- 「{d.get('title', '')}」 `{d.get('id')}` " \
                   f"[{d.get('status', '')}]"
            if d.get("side"):
                line += f"（{d.get('side')}，{d.get('relation_kind')}）"
            if d.get("summary"):
                line += f" — {d['summary']}"
            if d.get("reason"):
                line += f"｜原因：{d['reason']}"
            L.append(line)
            L += _item_detail_lines(d)

    rc = r.get("recent_changes") or []
    if rc:
        L += ["", "## 近期变化（提交历史）"]
        for c in rc:
            L.append(f"- rev {c.get('revision')} · {c.get('actor')}: "
                     f"{c.get('summary', '')}")

    omitted = r.get("omitted_counts") or {}
    L += ["", "## 未返回与继续读取"]
    L.append(f"- omitted_counts: "
             f"{json.dumps(omitted, ensure_ascii=False) if omitted else '{}'}")
    conts = r.get("continuations") or []
    for c in conts:
        L.append(f"- 继续读取：`{c}`")
    if not conts:
        L.append("- 继续读取：（无）")
    L.append(f"- 任一节点的完整字段/完整证据（不受上述截断上限）："
             f"`researchmap node {p.get('id', '<PID>')} <NODE_ID>`")

    warns = r.get("warnings") or []
    if warns:
        L += ["", "## 警告"]
        L += [f"- {w}" for w in warns]

    if r.get("data_notice"):
        L += ["", "## 数据声明", f"- {r['data_notice']}"]

    L += ["", "> 机器处理请改用 `--format json`（默认）；本视图仅供人读，"
          "字段截断规则与 JSON 完全一致（`--max-chars` 限制的是服务端构造的 "
          "JSON，本视图不再二次限流，篇幅会与该数值不同）。"]
    return "\n".join(L) + "\n"


def cmd_context(args):
    client = make_client(args)
    params = [f"max_chars={args.max_chars}"]
    if args.focus:
        params.append(f"focus_node_id={urllib.parse.quote(args.focus, safe='')}")
    if args.q:
        params.append(f"q={urllib.parse.quote(args.q, safe='')}")
    status, body = call_api(client, "GET",
                            f"/api/v1/projects/{args.project_id}/context?"
                            f"{'&'.join(params)}")
    if not (200 <= status < 300):
        respond(status, body)
        return
    if args.format == "markdown":
        # Documented non-JSON stdout (SPEC 7.3: "context 可选 Markdown").
        print(render_context_markdown(body))
    else:
        emit(body)


def cmd_commit(args):
    client = make_client(args)
    path = args.ops_file or args.file
    if not path:
        fail_local("USAGE", "commit 需要提交文件：位置参数或 --file，二选一")
    if args.ops_file and args.file:
        fail_local("USAGE", "commit 文件只需给一次：位置参数或 --file，二选一")
    body = load_json_file(path, "提交")
    if not isinstance(body, dict):
        fail_local("LOCAL_BAD_COMMIT_FILE", "提交文件必须是 JSON 对象（CommitRequest 主体）")
    if "operations" not in body:
        fail_local("LOCAL_BAD_COMMIT_FILE",
                   "提交文件缺少 operations（应为 {…, 'operations': [op, …]}）")
    if not isinstance(body["operations"], list) or not body["operations"]:
        fail_local("LOCAL_BAD_COMMIT_FILE", "operations 必须是非空数组")

    # Stable identity across dry-run, commit and retries (A05): fill +
    # persist missing request_id / expected_revision; never touch the rest.
    _prepare_identity(path, body, client, args.project_id)

    suffix = "?dry_run=true" if args.dry_run else ""
    status, out = call_api(client, "POST",
                           f"/api/v1/projects/{args.project_id}/commits{suffix}",
                           body)
    respond(status, out)


def cmd_create_project(args):
    client = make_client(args)
    if args.file and (args.name or args.objective):
        fail_local("USAGE",
                   "create-project 用位置参数（name objective）或 --file，二选一")
    if args.file:
        body = load_json_file(args.file, "项目创建")
        if not isinstance(body, dict):
            fail_local("LOCAL_BAD_COMMIT_FILE",
                       "项目创建文件必须是 JSON 对象（request_id/name/objective）")
        if not body.get("request_id"):
            body["request_id"] = str(uuid.uuid4())
            save_json_file(args.file, body)
            note(f"[researchmap] 已写入 {args.file}：request_id="
                 f"{body['request_id']}（新生成）。重复执行同一文件不会创建第二个项目。")
        status, out = call_api(client, "POST", "/api/v1/projects", body)
    else:
        if not args.name or not args.objective:
            fail_local("USAGE",
                       "请同时给出 name 与 objective，或用 --file <project.json>"
                       "（文件须含 request_id/name/objective，重试安全）")
        body = {"request_id": str(uuid.uuid4()),
                "name": args.name, "objective": args.objective}
        note("[researchmap] 命令行模式的 request_id 为临时生成、未落盘；"
             "需要可重放的创建请改用 --file。")
        status, out = call_api(client, "POST", "/api/v1/projects", body)
    respond(status, out)


def cmd_export(args):
    client = make_client(args)
    status, data = call_api(client, "GET",
                            f"/api/v1/projects/{args.project_id}/export")
    if not (200 <= status < 300):
        respond(status, data)
        return
    if args.out:
        raw = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        try:
            with open(args.out, "wb") as f:
                f.write(raw + b"\n")
        except OSError as e:
            fail_local("LOCAL_SAVE_FAILED", f"无法写出导出文件 {args.out}：{e}")
        emit({"file": args.out, "bytes": len(raw),
              "schema_version": (data or {}).get("schema_version"),
              "project_revision": (data or {}).get("project_revision"),
              "counts": (data or {}).get("counts")})
    else:
        emit(data)


# ---------------------------------------------------------------------------
# argument parsing
# ---------------------------------------------------------------------------

class _Parser(argparse.ArgumentParser):
    """Argparse errors also follow the one-JSON-object stderr contract."""

    def error(self, message):
        fail_local("USAGE", message)


def common_args(p: argparse.ArgumentParser):
    # --base is subcommand-level (documented in DECISIONS §7); env vars are
    # the documented credential channel. No --token by design (A05.6).
    p.add_argument("--base", default=None,
                   help="服务器地址（默认取 RESEARCHMAP_BASE_URL / RESEARCHMAP_URL 环境变量）")


def main(argv=None):
    p = _Parser(prog="researchmap",
                description="ResearchMap CLI — 外部 AI 读取/提交科研地图（仅走 HTTP）",
                epilog=EPILOG,
                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("health", help="存活检查（无需令牌）")
    s.add_argument("--base", default=None)
    s.set_defaults(fn=cmd_health)

    s = sub.add_parser("session", help="当前令牌身份（actor 由令牌决定）")
    common_args(s)
    s.set_defaults(fn=cmd_session)

    s = sub.add_parser("projects", help="项目列表")
    common_args(s)
    s.set_defaults(fn=cmd_projects)

    s = sub.add_parser("project", help="项目元信息（含当前 revision）")
    common_args(s)
    s.add_argument("project_id")
    s.set_defaults(fn=cmd_project)

    s = sub.add_parser("graph", help="主树节点列表（layout 输入）；默认输出完整 JSON")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--json", action="store_true",
                   help="（兼容保留；JSON 已是默认输出）")
    s.add_argument("--text", action="store_true", help="人读列表输出")
    s.set_defaults(fn=cmd_graph)

    s = sub.add_parser("node", help="节点完整内容（全量字段，定点补读）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("node_id")
    s.set_defaults(fn=cmd_node)

    s = sub.add_parser("relations", help="节点关联（分页）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("node_id")
    s.add_argument("--include-archived", action="store_true")
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--cursor", default=None)
    s.set_defaults(fn=cmd_relations)

    s = sub.add_parser("attachments", help="项目受管附件元数据列表（分页；只读）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--limit", type=int, default=200)
    s.add_argument("--cursor", default=None)
    s.set_defaults(fn=cmd_attachments)

    s = sub.add_parser("search", help="搜索（标题/摘要/标签/观察/结论，中文子串）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("query")
    s.add_argument("--limit", type=int, default=30)
    s.set_defaults(fn=cmd_search)

    s = sub.add_parser("commits", help="提交历史")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--node", default=None, help="只看涉及某节点的提交")
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--cursor", default=None)
    s.set_defaults(fn=cmd_commits)

    s = sub.add_parser("commit-detail", help="单个提交的 operations/changes")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("commit_id")
    s.set_defaults(fn=cmd_commit_detail)

    s = sub.add_parser("context",
                       help="预算化上下文（AI 首要读取入口；"
                            "--node 为 --focus 别名，--query 为 --q 别名）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--focus", "--node", dest="focus", default=None,
                   help="焦点节点 ID（focus_node_id）")
    s.add_argument("--q", "--query", dest="q", default=None,
                   help="关键词上下文")
    s.add_argument("--max-chars", type=int, default=12000,
                   help="字符预算 4000–50000（默认 12000）")
    s.add_argument("--format", choices=("json", "markdown"), default="json",
                   help="json（默认，机器可解析）| markdown（人读视图）")
    s.set_defaults(fn=cmd_context)

    s = sub.add_parser("commit",
                       help="提交（写入唯一入口；文件缺失 request_id/"
                            "expected_revision 时会生成并回写文件）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("ops_file", nargs="?", default=None,
                   help="CommitRequest JSON 文件（与 --file 二选一）")
    s.add_argument("--file", default=None, help="同位置参数 ops_file")
    s.add_argument("--dry-run", action="store_true",
                   help="以 dry_run=true 演练：全量校验但不落库（dry_run 不会写入文件）")
    s.add_argument("--auto-rev", action="store_true",
                   help="兼容保留：仅当文件缺少 expected_revision 时读取当前 "
                        "revision 并写入文件；文件已有该字段则绝不改动——"
                        "过期的 expected_revision 会 409，需重读内容后显式重写文件")
    s.set_defaults(fn=cmd_commit)

    s = sub.add_parser("create-project",
                       help="创建项目（--file 支持完整 JSON：request_id/name/objective）")
    common_args(s)
    s.add_argument("name", nargs="?", default=None)
    s.add_argument("objective", nargs="?", default=None)
    s.add_argument("--file", default=None,
                   help="项目创建 JSON 文件（须含 request_id/name/objective；"
                        "重试同一文件是幂等的，不会重复建项目）")
    s.set_defaults(fn=cmd_create_project)

    s = sub.add_parser("export", help="导出完整 JSON（含归档与历史）")
    common_args(s)
    s.add_argument("project_id")
    s.add_argument("--out", "--output", dest="out", default=None,
                   help="写入文件（默认输出到 stdout）")
    s.set_defaults(fn=cmd_export)

    args = p.parse_args(argv)
    try:
        args.fn(args)
        # Commands that return instead of exiting through respond() (markdown
        # context, --text graph, export --out) still owe their notes.
        flush_notes()
    except NetError as e:
        fail(None, e.code, str(e), hint=_hint(None, e.code))  # exit 4
    except SystemExit:
        raise
    except Exception as e:  # defensive: keep stderr one-JSON-object
        fail(None, "INTERNAL_CLI", f"CLI 内部错误：{e.__class__.__name__}: {e}",
             exit_code=EXIT_LOCAL)


if __name__ == "__main__":
    main()