"""SQLite engine, pragmas and a tiny versioned migration runner.

- WAL journal mode, foreign keys ON, bounded busy_timeout (SPEC 9).
- Write transactions are explicitly opened as BEGIN IMMEDIATE, so the
  idempotency check, revision check and mutation serialize on one lock;
  with a 5 s busy_timeout a short concurrent writer waits instead of
  corrupting. Read snapshots stay on plain BEGIN so WAL readers do not
  block each other (v0.1 does not promise high-frequency parallel writes).
- Migrations are additive and never wipe existing user data (SPEC 9).
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import get_settings

settings = get_settings()

_db_dir = os.path.dirname(os.path.abspath(settings.db_path))
if _db_dir:
    os.makedirs(_db_dir, exist_ok=True)

engine: Engine = create_engine(
    f"sqlite:///{settings.db_path}",
    pool_pre_ping=True,
    # FastAPI runs sync endpoints on a thread pool; the pool may hand a
    # pysqlite connection to a different worker thread. Safe here because a
    # connection is only used by the thread that checked it out, and SQLite
    # (WAL + BEGIN IMMEDIATE + busy_timeout) coordinates the connections.
    connect_args={
        "timeout": max(1, settings.busy_timeout_ms // 1000),
        "check_same_thread": False,
    },
    future=True,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragmas(dbapi_conn, _record) -> None:
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute(f"PRAGMA busy_timeout={settings.busy_timeout_ms}")
    cur.close()


# autoflush OFF everywhere: mutation code flushes explicitly at defined
# points. With autoflush on, a SELECT inside order placement would INSERT a
# new node with its (not-yet-final) order_index and trip the
# (project_id, order_index) unique index (caught by the dry-run path).
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False,
                            future=True)

# NOTE: deliberately no *global* "begin" hook — read snapshots keep the
# dialect default (plain BEGIN) so WAL readers do not block each other.
# Only write_txn() installs the hook on its own connection, so the
# idempotency check + revision check + mutation share one serialized
# BEGIN IMMEDIATE boundary while the session still owns the transaction
# (commit/rollback handled by SQLAlchemy, not raw SQL).
def _begin_immediate(conn: Connection) -> None:
    conn.exec_driver_sql("BEGIN IMMEDIATE")


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------

_SCHEMA_0001 = [
    """
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
      objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 4000),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      create_request_id TEXT UNIQUE,
      create_request_hash TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      order_index INTEGER NOT NULL,
      kind TEXT NOT NULL DEFAULT 'idea',
      title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'unexplored',
      rationale TEXT NOT NULL DEFAULT '',
      finding TEXT NOT NULL DEFAULT '',
      decision TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT '',
      details_md TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      evidence TEXT NOT NULL DEFAULT '[]',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL
    )
    """,
    # order_index is server-managed and unique within a sibling group.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_node_order_top
      ON nodes(project_id, order_index) WHERE parent_id IS NULL
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS uq_node_order_parent
      ON nodes(project_id, parent_id, order_index) WHERE parent_id IS NOT NULL
    """,
    "CREATE INDEX IF NOT EXISTS idx_nodes_project ON nodes(project_id, archived)",
    "CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(parent_id)",
    """
    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_relations_project ON relations(project_id, archived)",
    "CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id)",
    "CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id)",
    """
    CREATE TABLE IF NOT EXISTS commits (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      base_revision INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      actor TEXT NOT NULL,
      client_label TEXT,
      summary TEXT NOT NULL,
      operations_json TEXT NOT NULL,
      changes_json TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, request_id),
      UNIQUE (project_id, revision)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS commit_nodes (
      commit_id TEXT NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      PRIMARY KEY (commit_id, node_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
    """,
]


def _migrate_0001(conn) -> None:
    for stmt in _SCHEMA_0001:
        conn.execute(text(stmt))


MIGRATIONS: list[tuple[int, str]] = [
    (1, "initial schema (projects/nodes/relations/commits/commit_nodes)"),
]
_APPLY = {1: _migrate_0001}


def init_db() -> None:
    """Run pending migrations. Idempotent; never drops user data."""
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations ("
            " version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
        ))
        cur = conn.execute(text("SELECT version FROM schema_migrations ORDER BY version"))
        have = {row[0] for row in cur.fetchall()}
        for version, _description in MIGRATIONS:
            if version in have:
                continue
            _APPLY[version](conn)
            conn.execute(
                text("INSERT INTO schema_migrations(version, applied_at) VALUES (:v, :at)"),
                {"v": version, "at": now_utc()},
            )


@contextmanager
def read_session() -> Iterator[Session]:
    """One read transaction: every query in the response shares one WAL
    snapshot, so a graph/export/context response never mixes revisions."""
    s = SessionLocal()
    try:
        s.begin()
        yield s
    except BaseException:
        if s.in_transaction():
            s.rollback()
        raise
    finally:
        if s.in_transaction():
            s.rollback()  # pure read; releases the snapshot
        s.close()


@contextmanager
def write_txn() -> Iterator[Session]:
    """One serialized write boundary (BEGIN IMMEDIATE) covering the
    idempotency check, the revision check and the mutation (SPEC 6.2)."""
    with engine.connect() as conn:
        event.listen(conn, "begin", _begin_immediate)
        s = Session(bind=conn, expire_on_commit=False, autoflush=False)
        s.begin()
        try:
            yield s
            s.commit()
        except BaseException:
            if s.in_transaction():
                s.rollback()
            raise
        finally:
            s.close()