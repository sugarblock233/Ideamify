"""Bearer-token authentication (SPEC 9).

Tokens are configured by name; only SHA-256 hashes are kept in the app runtime.
The actor identity shown in records comes from the token, never from request
bodies (a `client_label` is self-attested and never authoritative).
"""

from __future__ import annotations

import hashlib

from fastapi import Request

from .config import get_settings
from .errors import unauthorized

_settings = None


def _token_name(token: str) -> str | None:
    global _settings
    if _settings is None:
        _settings = get_settings()
    return _settings.token_hashes.get(hashlib.sha256(token.encode("utf-8")).hexdigest())


def require_auth(request: Request) -> str:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise unauthorized()
    token = header[7:].strip()
    if not token:
        raise unauthorized("访问令牌为空")
    name = _token_name(token)
    if name is None:
        raise unauthorized("访问令牌无效")
    return name