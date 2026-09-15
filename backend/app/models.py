"""SQLAlchemy ORM models for the four core business objects (SPEC 5).

Technical notes: timestamps are ISO-8601 UTC strings; JSON fields (tags,
evidence, *_json columns) are stored as TEXT and (de)serialized explicitly so
the stored shape stays stable and easy to audit.
"""

from __future__ import annotations

from sqlalchemy import Boolean, Integer, String, Text, func, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    objective: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(Text)
    create_request_id: Mapped[str | None] = mapped_column(String(36), unique=True, nullable=True)
    create_request_hash: Mapped[str | None] = mapped_column(Text, nullable=True)


class Node(Base):
    __tablename__ = "nodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(Text, index=True)
    parent_id: Mapped[str | None] = mapped_column(Text, index=True, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    kind: Mapped[str] = mapped_column(String(16), default="idea")
    title: Mapped[str] = mapped_column(String(80))
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="unexplored")
    rationale: Mapped[str] = mapped_column(Text, default="")
    finding: Mapped[str] = mapped_column(Text, default="")
    decision: Mapped[str] = mapped_column(Text, default="")
    scope: Mapped[str] = mapped_column(Text, default="")
    details_md: Mapped[str] = mapped_column(Text, default="")
    tags: Mapped[str] = mapped_column(Text, default="[]")
    evidence: Mapped[str] = mapped_column(Text, default="[]")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(Text)


class Relation(Base):
    __tablename__ = "relations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(Text, index=True)
    source_id: Mapped[str] = mapped_column(Text, index=True)
    target_id: Mapped[str] = mapped_column(Text, index=True)
    kind: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str] = mapped_column(Text)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(Text)

    __table_args__ = (UniqueConstraint("project_id", "source_id", "target_id", "kind",
                                       name="uq_relation_triple_all"),)


class Commit(Base):
    __tablename__ = "commits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(Text)
    request_id: Mapped[str] = mapped_column(String(36))
    request_hash: Mapped[str] = mapped_column(Text)
    base_revision: Mapped[int] = mapped_column(Integer)
    revision: Mapped[int] = mapped_column(Integer)
    actor: Mapped[str] = mapped_column(Text)
    client_label: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text)
    operations_json: Mapped[str] = mapped_column(Text)
    changes_json: Mapped[str] = mapped_column(Text)
    response_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class CommitNode(Base):
    """Technical index table: which nodes a commit touched (for history filters)."""

    __tablename__ = "commit_nodes"

    commit_id: Mapped[str] = mapped_column(Text, primary_key=True)
    node_id: Mapped[str] = mapped_column(Text, primary_key=True)


class Attachment(Base):
    """Managed image attachment metadata (D 批 §9.2).

    Bytes live in the storage directory under the attachment id; this row is
    the only index. state: staged (uploaded, not yet referenced) → attached
    (referenced by at least one committed node body). Attached rows are never
    deleted — content is immutable, replacing means a new id.
    """

    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(Text, index=True)
    mime: Mapped[str] = mapped_column(Text)
    bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(Text, index=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str] = mapped_column(String(16))
    created_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)


class ResearchVersion(Base):
    """科研版本标签（E 批 §7.2）：v1/v2/v3 这类研究阶段标签，只呈现当前内容的
    归属，不承载时间旅行。order_index 决定展示顺序（与创建顺序一致，after_id
    调整）；archived 版本不再参与分配，但既有归属保留（历史可读）。"""

    __tablename__ = "research_versions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(Text, index=True)
    name: Mapped[str] = mapped_column(String(80))
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[str] = mapped_column(Text)


class NodeVersionAssignment(Base):
    """node ↔ research_version 多对多（同一节点可属多个版本）。"""

    __tablename__ = "node_version_assignments"

    node_id: Mapped[str] = mapped_column(Text, primary_key=True)
    version_id: Mapped[str] = mapped_column(Text, primary_key=True)
    project_id: Mapped[str] = mapped_column(Text, index=True)