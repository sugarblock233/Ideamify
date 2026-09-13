"""Runtime configuration. All settings come from the environment; no secrets here."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict

# 2 MiB hard request-body limit (SPEC 6)
MAX_BODY_BYTES = 2 * 1024 * 1024

_ROOT = Path(__file__).resolve().parents[2]


def _default_db_path() -> str:
    env = os.environ.get("RESEARCHMAP_DB", "").strip()
    if env:
        return env
    return str(_ROOT / "data" / "researchmap.db")


def load_token_config() -> Dict[str, str]:
    """Load {token_name: token_value} from RESEARCHMAP_TOKENS.

    Value may be inline JSON ({"researcher": "...", "agent-a": "..."}) or a path
    to a JSON file with the same shape. Tokens are compared by SHA-256 hash so
    plaintext needs to live only in this protected configuration.
    """
    raw = os.environ.get("RESEARCHMAP_TOKENS", "").strip()
    if not raw:
        raise RuntimeError(
            "RESEARCHMAP_TOKENS is required: set inline JSON or a path to a JSON "
            "file mapping token names to bearer tokens."
        )
    if raw.startswith("{"):
        data = json.loads(raw)
    else:
        path = Path(raw)
        if not path.is_file():
            raise RuntimeError(f"RESEARCHMAP_TOKENS file not found: {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not data:
        raise RuntimeError("RESEARCHMAP_TOKENS must be a non-empty JSON object {name: token}")
    for name, token in data.items():
        if not isinstance(token, str) or len(token) < 12:
            raise RuntimeError(f"token {name!r} must be a string of at least 12 chars")
    return data


@dataclass(frozen=True)
class Settings:
    db_path: str = field(default_factory=_default_db_path)
    static_dir: str = field(
        default_factory=lambda: os.environ.get("RESEARCHMAP_STATIC", "").strip()
    )
    busy_timeout_ms: int = field(
        default_factory=lambda: int(os.environ.get("RESEARCHMAP_BUSY_TIMEOUT_MS", "5000"))
    )
    allowed_cors_origins: tuple[str, ...] = field(
        default_factory=lambda: tuple(
            o.strip()
            for o in os.environ.get(
                "RESEARCHMAP_CORS_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            ).split(",")
            if o.strip()
        )
    )
    token_hashes: Dict[str, str] = field(default_factory=dict)  # sha256 -> name


def get_settings() -> Settings:
    tokens = load_token_config()
    return Settings(
        token_hashes={hashlib.sha256(t.encode("utf-8")).hexdigest(): name for name, t in tokens.items()}
    )


def max_body_bytes() -> int:
    return MAX_BODY_BYTES