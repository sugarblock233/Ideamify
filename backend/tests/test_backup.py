"""Backup/restore contract tests for tools/backup.py (D03).

The drill that motivated these: on a container deployment the database is WAL
mode, so `docker cp researchmap.db` alone copies a 4 KB file with no tables —
the live data is still in `researchmap.db-wal`. `backup.py verify` used to call
that "verify 通过" with counts `缺表`, i.e. it certified an empty file. A backup
tool that passes a schema-less source is worse than one that fails.

So: a source without the schema is an error, and a real WAL source (rows written
but not checkpointed) must still produce a complete single-file copy.
"""

import importlib.util
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