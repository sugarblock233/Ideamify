"""Local single-user access, with explicit token mode for remote deployments.

Tokens are configured by name; only SHA-256 hashes are kept in the app runtime.
The actor identity shown in records comes from the token, never from request
bodies (a `client_label` is self-attested and never authoritative).
"""

from __future__ import annotations

import hashlib
import ipaddress

from fastapi import Request

from .config import get_settings
from .errors import err, unauthorized

_settings = None


def _token_name(token: str) -> str | None:
    global _settings
    if _settings is None:
        _settings = get_settings()
    return _settings.token_hashes.get(hashlib.sha256(token.encode("utf-8")).hexdigest())


def require_auth(request: Request) -> str:
    global _settings
    if _settings is None:
        _settings = get_settings()
    header = request.headers.get("authorization", "")
    if _settings.auth_mode == "local" and not header:
        # Local mode relies on a loopback-only listener/host port (compose).
        # Host validation blocks DNS rebinding. Origin + custom-header checks
        # prevent another website from reading/writing this local service.
        host = request.url.hostname or ""
        try:
            local_host = ipaddress.ip_address(host).is_loopback
        except ValueError:
            local_host = host == "localhost"
        origin = request.headers.get("origin")
        if not local_host or request.headers.get("sec-fetch-site") == "cross-site" or (
            origin and origin != str(request.base_url).rstrip("/")
        ):
            raise err(403, "LOCAL_ACCESS_ONLY", "本机模式仅支持从本机 ResearchMap 页面访问")
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-researchmap-request") != "1":
            raise err(403, "LOCAL_REQUEST_REQUIRED", "请从 ResearchMap 页面或 CLI 发起操作")
        return "researcher"
    if not header.lower().startswith("bearer "):
        raise unauthorized()
    token = header[7:].strip()
    if not token:
        raise unauthorized("访问令牌为空")
    name = _token_name(token)
    if name is None:
        raise unauthorized("访问令牌无效")
    return name
