"""Backup/restore contract tests for tools/backup.py (D03).

The drill that motivated these: on a container deployment the database is WAL
mode, so `docker cp researchmap.db` alone copies a 4 KB file with no tables —
the live data is still in `researchmap.db-wal`. `backup.py verify` used to call
that "verify 通过" with counts `缺表`, i.e. it certified an empty file. A backup
tool that passes a schema-less source is worse than one that fails.

So: a source without the schema is an error, and a real WAL source (rows written
but not checkpointed) must still produce a complete single-file copy.
"""

import base64
import hashlib
import importlib.util
import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKUP = ROOT / "tools" / "backup.py"

TABLES = ("projects", "nodes", "relations", "commits")


def _load():
    spec = importlib.util.spec_from_file_location("rm_backup", BACKUP)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bk = _load()


def _run(*args, cwd=None):
    return subprocess.run([sys.executable, str(BACKUP), *args],
                          capture_output=True, text=True, cwd=cwd)


def _empty_db(path: Path) -> Path:
    """A file that is a valid SQLite database but has no ResearchMap schema."""
    sqlite3.connect(path).close()
    return path


def _schema_db(path: Path, rows=(("p1", "演练项目", 3),)) -> Path:
    """A closed, checkpointed, single-file database with the schema."""
    con = sqlite3.connect(path)
    _create_schema(con)
    for r in rows:
        con.execute("INSERT INTO projects VALUES (?, ?, ?)", r)
    con.commit()
    con.close()  # last close checkpoints and drops any -wal sidecar
    assert not path.with_name(path.name + "-wal").exists()
    return path


def _wal_db(path: Path):
    """A *live* WAL database: connection left open, rows committed but not
    checkpointed, so the data sits in the -wal sidecar.

    Returns (path, connection) — the caller closes the connection. (The sidecar
    only survives while a connection is open: SQLite checkpoints and deletes it
    on the last close, which is precisely why a running server is what makes
    `docker cp` of the main file alone lose the data.)
    """
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode=WAL")
    _create_schema(con)
    con.execute("INSERT INTO projects VALUES ('p1', '演练项目', 3)")
    con.execute("INSERT INTO nodes VALUES ('n1', '演练节点', NULL)")
    con.commit()
    wal = path.with_name(path.name + "-wal")
    assert wal.exists() and wal.stat().st_size > 0, "expected a non-empty WAL sidecar"
    return path, con


def _create_schema(con):
    for t in TABLES:
        con.execute(f"CREATE TABLE {t} (id TEXT PRIMARY KEY, name TEXT, revision INTEGER)")


# ------------------------------- schema guard -------------------------------

def test_verify_rejects_a_database_without_the_schema(tmp_path):
    r = _run("verify", str(_empty_db(tmp_path / "empty.db")))
    assert r.returncode != 0, r.stdout + r.stderr
    assert "缺表" in r.stdout + r.stderr
    assert "verify 通过" not in r.stdout


def test_backup_rejects_a_schema_less_source_and_writes_nothing(tmp_path):
    out = tmp_path / "out"
    r = _run("backup", "--db", str(_empty_db(tmp_path / "empty.db")), "--out", str(out))
    assert r.returncode != 0, r.stdout + r.stderr
    assert not out.exists() or not list(out.glob("*.db")), "an empty source must not yield a backup"


def test_check_db_names_the_wal_trap(tmp_path):
    # The message has to tell the operator what actually went wrong on a
    # container deployment, not just "missing table".
    try:
        bk.check_db(str(_empty_db(tmp_path / "empty.db")))
    except SystemExit as e:
        assert "-wal" in str(e)
    else:
        raise AssertionError("check_db accepted a schema-less database")


# ------------------------- WAL source still backs up ------------------------

def test_backup_from_a_live_wal_source_keeps_uncheckpointed_rows(tmp_path):
    src, con = _wal_db(tmp_path / "live.db")

    # The trap, made concrete: the main file *alone* is not the database. This is
    # what `docker cp researchmap.db` hands you while the server is running.
    main_only = tmp_path / "main-only.db"
    shutil.copy2(src, main_only)
    r = _run("verify", str(main_only))
    assert r.returncode != 0 and "缺表" in r.stdout + r.stderr

    out = tmp_path / "out"
    r = _run("backup", "--db", str(src), "--out", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    con.close()

    copies = list(out.glob("researchmap-*.db"))
    assert len(copies) == 1
    # single file, no sidecars: readable by any sqlite3 CLI
    assert not list(out.glob("*-wal")) and not list(out.glob("*-shm"))
    con = sqlite3.connect(copies[0])
    try:
        assert con.execute("SELECT COUNT(*) FROM projects").fetchone()[0] == 1
        assert con.execute("SELECT revision FROM projects").fetchone()[0] == 3
    finally:
        con.close()

    v = _run("verify", str(copies[0]))
    assert v.returncode == 0 and "verify 通过" in v.stdout


# --------------------------- attachments (D4) -------------------------------

ATT_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _create_attachments(con):
    con.execute("CREATE TABLE attachments (id TEXT PRIMARY KEY, project_id TEXT, "
                "mime TEXT, bytes INTEGER, sha256 TEXT, width INTEGER, height INTEGER, "
                "original_name TEXT, state TEXT, created_by TEXT, created_at TEXT)")


def _db_with_attachments(path: Path, storage: Path, rows=("a1", "a2"),
                         corrupt_last: bool = False) -> Path:
    """有 attachments 表的库 + 对应字节目录（最后一行故意无文件/坏文件）。"""
    con = sqlite3.connect(path)
    _create_schema(con)
    _create_attachments(con)
    for i, rid in enumerate(rows):
        body = ATT_PNG
        if corrupt_last and i == len(rows) - 1:
            body = b"x"  # 同名但字节损坏：元数据仍记原 PNG 的 sha/大小
        con.execute("INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (rid, "p1", "image/png", len(ATT_PNG),
                     hashlib.sha256(ATT_PNG).hexdigest(),
                     1, 1, "fig.png", "staged", "tester", "2026-09-15T00:00:00Z"))
        (storage / rid).write_bytes(body)
    con.commit()
    con.close()
    return path


def test_backup_copies_attachment_bytes_with_manifest(tmp_path):
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "live.db", storage, rows=("a1",))
    out = tmp_path / "out"

    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage))
    assert r.returncode == 0, r.stdout + r.stderr
    assert "1/1 个文件入包" in r.stdout
    assert "备份" in r.stdout and "退出码 3" not in r.stdout

    copied = out / "attachments" / "a1"
    assert copied.read_bytes() == ATT_PNG

    mf = json.loads(next(out.glob("attachments-manifest-*.json")).read_text(encoding="utf-8"))
    statuses = {f["id"]: (f["status"], f["ok"]) for f in mf["files"]}
    assert statuses == {"a1": ("ok", True)}
    assert mf["files"][0]["sha256"] == hashlib.sha256(ATT_PNG).hexdigest()


def test_backup_without_attachment_table_skips_the_directory(tmp_path):
    src = _schema_db(tmp_path / "old.db")
    out = tmp_path / "out"
    r = _run("backup", "--db", str(src), "--out", str(out))
    assert r.returncode == 0, r.stdout + r.stderr
    assert not (out / "attachments").exists()


def test_backup_with_missing_attachment_fails_strict(tmp_path):
    """F02：库里有附件元数据、字节缺失 → 默认硬失败，不打印「备份完成」。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "live.db", storage)  # a2 无文件
    (storage / "a2").unlink()
    out = tmp_path / "out"

    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage))
    assert r.returncode != 0, r.stdout + r.stderr
    assert "备份不完整" in r.stdout + r.stderr
    assert "缺失" in r.stdout + r.stderr
    assert "备份完成" not in r.stdout and "部分备份完成" not in r.stdout
    # manifest 仍然产出，记账给运维
    mf = json.loads(next(out.glob("attachments-manifest-*.json")).read_text(encoding="utf-8"))
    assert {f["id"]: f["status"] for f in mf["files"]} == {"a1": "ok", "a2": "missing"}


def test_backup_with_missing_attachment_allow_partial_exits_3(tmp_path):
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "live.db", storage)
    (storage / "a2").unlink()
    out = tmp_path / "out"

    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage),
             "--allow-partial")
    assert r.returncode == 3, r.stdout + r.stderr  # 可区分的部分成功
    assert "部分备份完成" in r.stdout
    assert "退出码 3" in r.stdout or "部分" in r.stdout


def test_backup_with_corrupted_attachment_fails_strict(tmp_path):
    """F02：同名但字节已损坏 → sha256 不符 → 默认失败，而不是照常「完成」。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "live.db", storage, corrupt_last=True)
    r = _run("backup", "--db", str(src), "--out", str(tmp_path / "out"),
             "--storage", str(storage))
    assert r.returncode != 0 and "不符" in r.stdout + r.stderr


def test_backup_with_missing_storage_dir_fails_strict_and_partial_exits_3(tmp_path):
    storage = tmp_path / "ghost-storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "live.db", storage)
    shutil.rmtree(storage)  # 库里有元数据、字节目录被整目录删掉的情形
    out = tmp_path / "out"

    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage))
    assert r.returncode != 0, r.stdout + r.stderr
    assert "不是一份完整备份" in r.stdout + r.stderr

    out2 = tmp_path / "out2"
    r2 = _run("backup", "--db", str(src), "--out", str(out2), "--storage", str(storage),
              "--allow-partial")
    assert r2.returncode == 3, r2.stdout + r2.stderr


# ------------------------------- restore (F02) ------------------------------

def test_restore_reports_attachment_coverage_hint(tmp_path):
    """完整附件随包恢复：字节从备份包补入目标字节目录。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    src = _db_with_attachments(pkg / "backup.db", storage, rows=("a1",))
    out = tmp_path / "out"
    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage))
    assert r.returncode == 0, r.stdout + r.stderr
    srcdb = next(out.glob("researchmap-*.db"))
    dst = _schema_db(tmp_path / "data.db", rows=(("p9", "被换掉的旧库", 42),))
    tar_storage = tmp_path / "tar-storage"
    tar_storage.mkdir()

    r = _run("restore", "--src", str(srcdb), "--dst", str(dst),
             "--storage", str(tar_storage), "--server-stopped", "--yes")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "1 条元数据，1 个文件逐字节核对通过" in r.stdout
    assert "恢复完成" in r.stdout
    assert (tar_storage / "a1").read_bytes() == ATT_PNG  # 字节从备份包补入


def _run_restore(args, cwd=None):
    return subprocess.run([sys.executable, str(BACKUP), "restore", *args],
                          capture_output=True, text=True, cwd=cwd)


# ------------------------------- restore gate -------------------------------

def test_restore_refuses_without_the_server_stopped_flag(tmp_path):
    src = _schema_db(tmp_path / "backup.db")
    dst = _schema_db(tmp_path / "data.db", rows=(("p9", "后来写的", 42),))
    r = _run("restore", "--src", str(src), "--dst", str(dst))  # no --server-stopped
    assert r.returncode != 0
    assert "server-stopped" in r.stdout + r.stderr
    # the target is untouched
    con = sqlite3.connect(dst)
    try:
        assert con.execute("SELECT id FROM projects").fetchall() == [("p9",)]
    finally:
        con.close()


def test_restore_replaces_the_target_and_clears_a_stale_wal(tmp_path):
    src = _schema_db(tmp_path / "backup.db")
    # The target is a *live* WAL database with an un-checkpointed sidecar — the
    # state a stopped container leaves behind. A restore that swapped the main
    # file but kept that -wal would let SQLite replay the old rows back over the
    # restored data.
    dst, dst_con = _wal_db(tmp_path / "data.db")
    assert Path(str(dst) + "-wal").exists()

    r = _run("restore", "--src", str(src), "--dst", str(dst), "--server-stopped", "--yes")
    dst_con.close()
    assert r.returncode == 0, r.stdout + r.stderr
    assert "恢复完成" in r.stdout
    assert list(tmp_path.glob("data.db.pre-restore-*")), "the replaced file must be kept"
    assert not Path(str(dst) + "-wal").exists(), "a stale -wal must not survive the restore"

    con = sqlite3.connect(dst)
    try:
        assert con.execute("SELECT id, revision FROM projects").fetchall() == [("p1", 3)]
    finally:
        con.close()
    assert _run("verify", str(dst)).returncode == 0


def test_restore_with_missing_attachment_aborts_and_leaves_target_untouched(tmp_path):
    """F02：附件缺件 → 替换目标库**之前**中止；旧库字节原位不动。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "backup.db", storage)  # a2 无文件
    (storage / "a2").unlink()
    dst = _schema_db(tmp_path / "data.db", rows=(("p9", "后来的生产数据", 42),))

    r = _run("restore", "--src", str(src), "--dst", str(dst),
             "--storage", str(storage), "--server-stopped", "--yes")
    assert r.returncode != 0, r.stdout + r.stderr
    assert "恢复中止" in r.stdout + r.stderr
    assert "目标库未被改动" in r.stdout + r.stderr
    con = sqlite3.connect(dst)
    try:
        assert con.execute("SELECT id, revision FROM projects").fetchall() == [("p9", 42)]
    finally:
        con.close()
    assert not list(tmp_path.glob("data.db.pre-restore-*"))


def test_restore_with_missing_attachment_allow_partial_exits_3(tmp_path):
    storage = tmp_path / "storage"
    storage.mkdir()
    src = _db_with_attachments(tmp_path / "backup.db", storage)
    (storage / "a2").unlink()
    dst = _schema_db(tmp_path / "data.db", rows=(("p9", "旧", 42),))

    r = _run("restore", "--src", str(src), "--dst", str(dst),
             "--storage", str(storage), "--server-stopped", "--yes", "--allow-partial")
    assert r.returncode == 3, r.stdout + r.stderr
    assert "部分恢复完成" in r.stdout
    assert "退出码 3" in r.stdout  # 只是不中止，仍不算完整成功


def test_restore_with_corrupted_package_attachment_aborts(tmp_path):
    """F02：备份包里同名但字节损坏 → 核对不过 → 中止，目标库不动。"""
    storage = tmp_path / "storage"
    storage.mkdir()
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    src = _db_with_attachments(pkg / "backup.db", storage, corrupt_last=True)
    out = tmp_path / "out"
    r = _run("backup", "--db", str(src), "--out", str(out), "--storage", str(storage),
             "--allow-partial")
    assert r.returncode == 3, r.stdout + r.stderr
    srcdb = next(out.glob("researchmap-*.db"))
    dst = _schema_db(tmp_path / "data.db", rows=(("p9", "旧", 42),))

    r = _run("restore", "--src", str(srcdb), "--dst", str(dst),
             "--storage", str(tmp_path / "tar-storage"), "--server-stopped", "--yes")
    assert r.returncode != 0, r.stdout + r.stderr
    assert "恢复中止" in r.stdout + r.stderr
    assert "a2" in r.stdout + r.stderr  # 坏件未被入包，恢复侧按缺件中止
    con = sqlite3.connect(dst)
    try:
        assert con.execute("SELECT id FROM projects").fetchall() == [("p9",)]
    finally:
        con.close()