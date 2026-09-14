#!/usr/bin/env python3
"""ResearchMap 备份与恢复（v0.1，面向单容器/卷部署）。

数据库是 WAL 模式 SQLite。备份**不需要**停服务器（走 sqlite3 Online
Backup API）；**恢复需要**服务器停止写入（v0.1 不做在线热替换）。

子命令：
  backup   完整在线备份：<out>/<ts>.db + <ts>.sql（iterdump），可选
           <ts>.json（向运行中的服务器要 /export 的 JSON 快照）
           并对副本做 PRAGMA integrity_check + 计数摘要
  verify   对一个 .db 副本做完整性检查与计数，不改动文件
  restore  服务器停止后：校验源副本 → 原子替换目标 data.db，旧库留档为
           .pre-restore-<ts>；清理残留 -wal/-shm；给出重启提示
  show     打印某 db 的 project 清单与计数（用于恢复前人工核对）

环境变量：
  RESEARCHMAP_BASE_URL / RESEARCHMAP_TOKEN   仅 backup --json 需要
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
import urllib.request
from datetime import datetime, timezone

SCHEMA_TABLES = ("projects", "nodes", "relations", "commits")
# D4: attachments 表在迁移 0002 之后才存在——旧库副本 verify 不因缺它失败，
# 只在新库上计入。
OPTIONAL_TABLES = ("attachments",)


def ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def urlopen_json(base: str, token: str, path: str) -> list | dict:
    req = urllib.request.Request(base.rstrip("/") + path,
                                 headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode("utf-8"))


def open_ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def check_db(path: str) -> dict:
    """完整性检查 + 计数摘要。read-only 打开，绝不写目标文件。

    缺表是**错误**，不是"空库"。容器部署上有一个真实的踩坑路径：库是 WAL
    模式，用 `docker cp` 只拷主文件会得到一个 4 KB、没有任何表的文件——真正的
    数据还在 researchmap.db-wal 里。旧版本对这种文件照打 "verify 通过"，
    等于给一份空库背书，比直接失败更危险。所以这里直接退出。
    """
    if not os.path.exists(path):
        raise SystemExit(f"文件不存在：{path}")
    con = open_ro(path)
    try:
        rc = con.execute("PRAGMA integrity_check").fetchone()[0]
        if rc != "ok":
            raise SystemExit(f"integrity_check 失败：{rc[:400]}")
        counts = {}
        missing = []
        for t in SCHEMA_TABLES:
            try:
                counts[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            except sqlite3.OperationalError:
                counts[t] = "缺表"
                missing.append(t)
        for t in OPTIONAL_TABLES:
            try:
                counts[t] = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            except sqlite3.OperationalError:
                counts[t] = "旧库（迁移 0002 前）"
        if missing:
            raise SystemExit(
                f"缺表：{path} 里没有 {', '.join(missing)}——这不是一个"
                "ResearchMap 数据库。\n"
                "若这是从容器里拷出来的文件，多半只拷到了主文件，而数据还在同目录的"
                " -wal 侧写文件里（WAL 模式；`docker cp` 不带上它，主文件可能只有"
                " 4 KB、一个表都没有）。\n"
                "正确做法：见 tools/backup.py 的备份流程——用本工具（sqlite3 Online"
                " Backup API，对 WAL 安全）或在容器内先做 checkpoint 再拷贝。"
            )
        return {"file": path, "integrity": "ok", "counts": counts}
    finally:
        con.close()


def cmd_verify(args) -> None:
    info = check_db(args.file)
    print(json.dumps(info, ensure_ascii=False, indent=2))
    print("verify 通过。")


def cmd_show(args) -> None:
    con = open_ro(args.file)
    try:
        rows = con.execute(
            "SELECT id, name, revision, updated_at FROM projects ORDER BY updated_at"
        ).fetchall()
    finally:
        con.close()
    if not rows:
        print("（库内无项目）")
        return
    for pid, name, rev, upd in rows:
        print(f"  {pid}  rev={rev}  updated={upd}  {name[:48]}")


def attachment_rows(db_path: str) -> list[dict]:
    """读出 attachments 元数据行（旧库无此表则返回空）。"""
    con = open_ro(db_path)
    try:
        try:
            cols = [r[1] for r in con.execute("PRAGMA table_info(attachments)")]
            if not cols:
                return []
            rows = con.execute(
                "SELECT id, project_id, mime, bytes, sha256, state, created_at "
                "FROM attachments ORDER BY created_at, id").fetchall()
        except sqlite3.OperationalError:
            return []
    finally:
        con.close()
    keys = ("id", "project_id", "mime", "bytes", "sha256", "state", "created_at")
    return [dict(zip(keys, r)) for r in rows]


def copy_attachments(db_path: str, storage_dir: str | None, out_dir: str, stamp: str) -> dict | None:
    """D4: 附件字节随备份包拷到 <out>/attachments/，manifest 落 JSON。

    完整性按行内 sha256 核对副本字节；缺失/损坏**只记录不中断**（备份尽量
    带走能带走的），manifest 里逐文件记录 ok/missing/mismatch。旧库或未配置
    storage 时返回 None（不产出附件目录）。
    """
    rows = attachment_rows(db_path)
    if not rows:
        return None
    if not storage_dir or not os.path.isdir(storage_dir):
        print(f"警告：库内有 {len(rows)} 条附件元数据，但附件目录不可用"
              f"（{storage_dir or '未配置 --storage'}），字节未入备份包。",
              file=sys.stderr)
        return None
    att_dir = os.path.join(out_dir, "attachments")
    os.makedirs(att_dir, exist_ok=True)
    import hashlib
    manifest = {"stamp": stamp, "source_storage": storage_dir, "files": []}
    for r in rows:
        src = os.path.join(storage_dir, r["id"])
        entry = {**r, "ok": False}
        if not os.path.isfile(src):
            entry["status"] = "missing"
        else:
            data = open(src, "rb").read()
            digest = hashlib.sha256(data).hexdigest()
            if digest != r["sha256"]:
                entry["status"] = "mismatch"
            else:
                with open(os.path.join(att_dir, r["id"]), "wb") as f:
                    f.write(data)
                entry["status"] = "ok"
                entry["ok"] = True
        manifest["files"].append(entry)
    mpath = os.path.join(out_dir, f"attachments-manifest-{stamp}.json")
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    n_ok = sum(1 for x in manifest["files"] if x["ok"])
    print(f"附件：{n_ok}/{len(rows)} 个文件入包（manifest：{mpath}）")
    return manifest


def cmd_backup(args) -> None:
    info = check_db(args.db)
    print("源库校验：", json.dumps(info["counts"], ensure_ascii=False))
    out_dir = args.out
    os.makedirs(out_dir, exist_ok=True)
    stamp = ts()
    dst = os.path.join(out_dir, f"researchmap-{stamp}.db")

    src = sqlite3.connect(args.db)
    try:
        dst_con = sqlite3.connect(dst)
        try:
            src.backup(dst_con)  # Online Backup API：对 WAL 安全
        finally:
            # 把副本转成 delete 日志模式：产物是单文件，任何 sqlite3 CLI
            # 都能直接打开，不依赖 -wal/-shm。
            dst_con.execute("PRAGMA journal_mode=DELETE")
            dst_con.commit()
        dst_con.close()
    finally:
        src.close()

    # SQL 文本快照（可移植/可手工恢复）
    sql_path = os.path.join(out_dir, f"researchmap-{stamp}.sql")
    con = open_ro(dst)
    try:
        with open(sql_path, "w", encoding="utf-8") as f:
            for line in con.iterdump():
                f.write(line + "\n")
    finally:
        con.close()

    json_path = None
    if args.json:
        token = os.environ.get("RESEARCHMAP_TOKEN", "")
        base = os.environ.get("RESEARCHMAP_BASE_URL") or args.base
        if not token:
            print("警告：未配置 RESEARCHMAP_TOKEN，跳过 JSON 快照", file=sys.stderr)
        elif not base:
            raise SystemExit("需要 --base 或 RESEARCHMAP_BASE_URL 才能取 JSON 快照")
        else:
            projects = urlopen_json(base, token, "/api/v1/projects")
            items = (projects.get("items") if isinstance(projects, dict)
                     else projects) or []
            data = {"snapshot_at": stamp, "projects": []}
            for p in items:
                pid = p.get("id") or p.get("project_id")
                if not pid:
                    continue
                data["projects"].append(
                    urlopen_json(base, token, f"/api/v1/projects/{pid}/export"))
            json_path = os.path.join(out_dir, f"researchmap-{stamp}.json")
            with open(json_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

    storage = args.storage or os.path.join(os.path.dirname(os.path.abspath(args.db)), "attachments")
    att_manifest = copy_attachments(dst, storage, out_dir, stamp)

    check = check_db(dst)
    for suffix in ("-wal", "-shm"):
        extra = dst + suffix
        if os.path.exists(extra):
            os.remove(extra)
    print(f"备份完成：\n  db     {dst}\n  sql    {sql_path}"
          + (f"\n  json   {json_path}" if json_path else "")
          + (f"\n  att    {os.path.join(out_dir, 'attachments')}" if att_manifest else ""))
    print("副本校验：integrity ok，counts =", json.dumps(check["counts"], ensure_ascii=False))


def cmd_restore(args) -> None:
    src = os.path.abspath(args.src)
    dst = os.path.abspath(args.dst)
    if not args.server_stopped:
        raise SystemExit("拒绝：恢复前必须确认服务器已停止写入（--server-stopped）。")
    info = check_db(src)
    print("源副本校验：", json.dumps(info["counts"], ensure_ascii=False))
    print("恢复前目标内容：")
    try:
        con = open_ro(dst)
        with con:
            for pid, name, rev in con.execute(
                    "SELECT id, name, revision FROM projects ORDER BY updated_at"):
                print(f"  {pid}  rev={rev}  {name[:48]}")
        con.close()
    except Exception:
        print("  （目标不存在或不可读）")
    if not args.yes:
        ans = input("确认用源副本替换目标？输入 yes 继续：").strip()
        if ans != "yes":
            print("已取消。")
            return

    stamp = ts()
    keep = dst + f".pre-restore-{stamp}"
    if os.path.exists(dst):
        shutil.move(dst, keep)
        print(f"旧库留档：{keep}")
    for suffix in ("-wal", "-shm"):
        extra = dst + suffix
        if os.path.exists(extra):
            os.remove(extra)
            print(f"清理残留：{extra}")
    shutil.copy2(src, dst)
    # D4: 附件目录核对（只提示，不自动搬移——恢复决策由运维做）
    atts = attachment_rows(dst)
    if atts:
        storage = args.storage or os.path.join(os.path.dirname(dst), "attachments")
        have = sum(1 for r in atts if os.path.isfile(os.path.join(storage, r["id"])))
        print(f"附件核对：库内 {len(atts)} 条元数据，附件目录 {storage} 命中 {have} 个文件。"
              + ("请随备份包一起恢复 attachments/（manifest 逐文件核对 sha256）。"
                 if have < len(atts) else ""))
    check = check_db(dst)
    print(f"恢复完成（重启服务器后即可读）：integrity ok, counts = "
          f"{json.dumps(check['counts'], ensure_ascii=False)}\n"
          "提示：恢复后请重新加载 UI 校验版本号；不要往旧 .pre-restore 文件再写。")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("backup", help="在线备份 db + sql（+可选 json 快照）")
    s.add_argument("--db", required=True, help="data.db 路径")
    s.add_argument("--out", default=".", help="输出目录")
    s.add_argument("--json", action="store_true",
                   help="同时向运行中的服务器取 /export JSON（需 RESEARCHMAP_* 环境变量）")
    s.add_argument("--storage", default=None,
                   help="附件字节目录（默认取 --db 同目录的 attachments/；D 批 §9.2）")
    s.add_argument("--base", default=None)
    s.set_defaults(fn=cmd_backup)

    s = sub.add_parser("verify", help="完整性检查一个 db 副本")
    s.add_argument("file")
    s.set_defaults(fn=cmd_verify)

    s = sub.add_parser("show", help="列出 db 中的项目")
    s.add_argument("file")
    s.set_defaults(fn=cmd_show)

    s = sub.add_parser("restore", help="服务器停止后用备份替换数据文件")
    s.add_argument("--src", required=True, help="备份 .db 路径")
    s.add_argument("--dst", required=True, help="目标 data.db 路径")
    s.add_argument("--server-stopped", action="store_true")
    s.add_argument("--storage", default=None,
                   help="附件字节目录（默认取 --dst 同目录的 attachments/）")
    s.add_argument("--yes", action="store_true", help="跳过交互确认")
    s.set_defaults(fn=cmd_restore)

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()