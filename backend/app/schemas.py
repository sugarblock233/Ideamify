"""Pydantic API contracts (SPEC 6). This module is the authority on accepted
shapes; every model rejects unknown fields (T19)."""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------

UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

NODE_KINDS = ("question", "idea", "attempt", "finding")
CONFIRMED_STATUSES = ("supported", "not_supported")  # SPEC 4.3 完整性规则
RELATION_KINDS = ("related", "motivates", "supports", "contradicts", "depends_on")


def _validate_uuid(value: Any, field: str) -> str:
    v = (value or "").strip()
    if not UUID_RE.match(v):
        raise ValueError(f"{field} 不是合法 UUID")
    return v.lower()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


NodeId = Annotated[str, Field(pattern=UUID_RE.pattern, min_length=36, max_length=36)]
OptionalNodeId = Annotated[Optional[str], Field(default=None, pattern=UUID_RE.pattern)]


# ---------------------------------------------------------------------------
# evidence
# ---------------------------------------------------------------------------

class EvidenceItem(StrictModel):
    kind: Literal["inline", "url", "path"]
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=4000)
    note: str = Field(default="", max_length=500)

    @field_validator("value")
    @classmethod
    def _check_value(cls, v: str, info: Any) -> str:
        v = v.strip()
        if not v:
            raise ValueError("evidence.value 不能为空白")
        kind = info.data.get("kind")
        if kind == "url" and not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("evidence(kind=url) 的 value 必须是 http/https 地址")
        return v


# ---------------------------------------------------------------------------
# node content field shapes (lengths per SPEC 5.2)
# ---------------------------------------------------------------------------

class NodeContentShapes(StrictModel):
    kind: Literal["question", "idea", "attempt", "finding"] = "idea"
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(default="", max_length=280)
    status: Literal[
        "unexplored", "in_progress", "promising", "supported", "not_supported", "inconclusive"
    ] = "unexplored"
    rationale: str = Field(default="", max_length=2000)
    finding: str = Field(default="", max_length=2000)
    decision: str = Field(default="", max_length=2000)
    scope: str = Field(default="", max_length=1000)
    details_md: str = Field(default="", max_length=30000)
    tags: list[str] = Field(default_factory=list, max_length=10)
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=20)

    @field_validator("title")
    @classmethod
    def _v_title(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("title 不能为空白")
        return v

    @field_validator("tags")
    @classmethod
    def _check_tags(cls, v: list[str]) -> list[str]:
        out: list[str] = []
        for t in v:
            t = (t or "").strip()
            if not (1 <= len(t) <= 32):
                raise ValueError("每个 tag 需为 1–32 字符")
            if t not in out:
                out.append(t)
        return out


# ---------------------------------------------------------------------------
# project operations
# ---------------------------------------------------------------------------

class ProjectCreate(StrictModel):
    request_id: NodeId
    name: str = Field(min_length=1, max_length=100)
    objective: str = Field(min_length=1, max_length=4000)

    @field_validator("request_id")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_uuid(v, "request_id")


class ProjectUpdateFields(StrictModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    objective: Optional[str] = Field(default=None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("project.update.fields 至少包含 name 或 objective")
        return self


class OpProjectUpdate(StrictModel):
    op: Literal["project.update"]
    fields: ProjectUpdateFields


# ---------------------------------------------------------------------------
# node operations
# ---------------------------------------------------------------------------

class OpNodeCreate(NodeContentShapes):
    op: Literal["node.create"]
    id: NodeId
    parent_id: OptionalNodeId = None
    after_id: OptionalNodeId = None
    # E 批 §7：科研版本归属；省略 = 不分配（空数组也是显式的空分配）
    version_ids: list[str] = Field(default_factory=list)

    @field_validator("version_ids")
    @classmethod
    def _v_version_ids(cls, v: list[str]) -> list[str]:
        return _check_version_ids(v)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "node.id")

    @field_validator("parent_id")
    @classmethod
    def _v_parent(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_uuid(v, "parent_id")

    @field_validator("after_id")
    @classmethod
    def _v_after(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_uuid(v, "after_id")

    @property
    def after_id_set(self) -> bool:
        return "after_id" in self.model_fields_set


class NodeUpdateFields(NodeContentShapes):
    # Partial update (SPEC 6.3): every content field is optional; only
    # explicitly supplied fields are applied by the commit engine.
    title: Optional[str] = Field(default=None, min_length=1, max_length=80)
    # E 批 §7：显式数组 = 整组替换；省略（或显式 null）= 不动既有归属
    version_ids: Optional[list[str]] = Field(default=None)

    @field_validator("version_ids")
    @classmethod
    def _v_version_ids(cls, v: Optional[list[str]]) -> Optional[list[str]]:
        return None if v is None else _check_version_ids(v)


class OpNodeUpdate(StrictModel):
    op: Literal["node.update"]
    id: NodeId
    fields: NodeUpdateFields

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "node.id")

    @model_validator(mode="after")
    def _not_empty(self):
        # Explicit nulls count as absent; an all-null fields object is a no-op
        # and is rejected here instead of committing an empty change.
        if not any(getattr(self.fields, k, None) is not None
                   for k in self.fields.model_fields_set):
            raise ValueError("node.update.fields 不能为空（显式 null 视为未提供）")
        return self


class OpNodeMove(StrictModel):
    op: Literal["node.move"]
    id: NodeId
    parent_id: OptionalNodeId = None
    after_id: OptionalNodeId = None

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "node.id")

    @field_validator("parent_id")
    @classmethod
    def _v_parent(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_uuid(v, "parent_id")

    @field_validator("after_id")
    @classmethod
    def _v_after(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_uuid(v, "after_id")

    @property
    def after_id_set(self) -> bool:
        return "after_id" in self.model_fields_set


class OpNodeArchive(StrictModel):
    op: Literal["node.archive"]
    id: NodeId
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "node.id")


class OpNodeRestore(StrictModel):
    op: Literal["node.restore"]
    id: NodeId
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "node.id")


# ---------------------------------------------------------------------------
# version operations（E 批 §7：科研版本 ≠ 保存 revision）
# ---------------------------------------------------------------------------

def _check_version_ids(v: list[str]) -> list[str]:
    out: list[str] = []
    for x in v:
        vid = _validate_uuid(x, "version_ids[]")
        if vid not in out:
            out.append(vid)
    return out


class VersionCreate(StrictModel):
    op: Literal["version.create"]
    id: NodeId
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=500)
    after_id: Optional[NodeId] = None

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "version.id")

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("version.name 不能为空白")
        return v

    @field_validator("after_id")
    @classmethod
    def _v_after(cls, v: Optional[str]) -> Optional[str]:
        return None if v is None else _validate_uuid(v, "after_id")

    @property
    def after_id_set(self) -> bool:
        return "after_id" in self.model_fields_set


class VersionUpdateFields(StrictModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def _v_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("version.name 不能为空白")
        return v

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("version.update.fields 至少包含 name 或 description")
        return self


class OpVersionUpdate(StrictModel):
    op: Literal["version.update"]
    id: NodeId
    fields: VersionUpdateFields

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "version.id")


class OpVersionArchive(StrictModel):
    op: Literal["version.archive"]
    id: NodeId
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "version.id")


# ---------------------------------------------------------------------------
# relation operations
# ---------------------------------------------------------------------------

class OpRelationCreate(StrictModel):
    op: Literal["relation.create"]
    id: NodeId
    source_id: NodeId
    target_id: NodeId
    kind: Literal["related", "motivates", "supports", "contradicts", "depends_on"]
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "relation.id")

    @field_validator("source_id")
    @classmethod
    def _v_source(cls, v: str) -> str:
        return _validate_uuid(v, "source_id")

    @field_validator("target_id")
    @classmethod
    def _v_target(cls, v: str) -> str:
        return _validate_uuid(v, "target_id")


class RelationUpdateFields(StrictModel):
    kind: Optional[Literal["related", "motivates", "supports", "contradicts", "depends_on"]] = None
    reason: Optional[str] = Field(default=None, min_length=1, max_length=500)


class OpRelationUpdate(StrictModel):
    op: Literal["relation.update"]
    id: NodeId
    fields: RelationUpdateFields

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "relation.id")

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.fields.model_fields_set:
            raise ValueError("relation.update.fields 不能为空")
        return self


class OpRelationArchive(StrictModel):
    op: Literal["relation.archive"]
    id: NodeId
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "relation.id")


class OpRelationRestore(StrictModel):
    op: Literal["relation.restore"]
    id: NodeId
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("id")
    @classmethod
    def _v_id(cls, v: str) -> str:
        return _validate_uuid(v, "relation.id")


Operation = Annotated[
    Union[
        OpProjectUpdate,
        OpNodeCreate,
        OpNodeUpdate,
        OpNodeMove,
        OpNodeArchive,
        OpNodeRestore,
        OpRelationCreate,
        OpRelationUpdate,
        OpRelationArchive,
        OpRelationRestore,
        VersionCreate,
        OpVersionUpdate,
        OpVersionArchive,
    ],
    Field(discriminator="op"),
]


# ---------------------------------------------------------------------------
# commit request
# ---------------------------------------------------------------------------

class CommitRequest(StrictModel):
    request_id: NodeId
    expected_revision: int = Field(ge=0)
    summary: str = Field(min_length=1, max_length=500)
    client_label: Optional[str] = Field(default=None, max_length=100)
    operations: list[Operation] = Field(min_length=1, max_length=100)

    @field_validator("request_id")
    @classmethod
    def _v(cls, v: str) -> str:
        return _validate_uuid(v, "request_id")

    def canonical(self) -> dict:
        """Normalized content used for the SHA-256 idempotency hash: explicit
        defaults are applied, so equivalent payloads hash identically."""
        return {
            "expected_revision": self.expected_revision,
            "summary": self.summary,
            "client_label": self.client_label,
            "operations": [op.model_dump(mode="json") for op in self.operations],
        }