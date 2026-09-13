"""FastAPI application (SPEC 9).

- All project data, export and even the OpenAPI schema require a bearer token;
  only /healthz and the static shell are public.
- Unknown /api/* paths return JSON 404 — never the SPA HTML (SPEC 7).
- In production the built frontend is served same-origin from this process.
"""

from __future__ import annotations

import os

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from .auth import require_auth
from .config import MAX_BODY_BYTES, get_settings
from .db import init_db
from .errors import register_error_handlers
from .views import router as api_router

settings = get_settings()
init_db()


def create_app() -> FastAPI:
    app = FastAPI(
        title="ResearchMap API",
        version=__version__,
        description="轻量科研演化地图 API（浏览器编辑与 AI 提交共用同一写入路径）",
        openapi_url="/api/v1/openapi.json",
        docs_url=None,       # HTML 文档停用；JSON schema 走受保护端点（SPEC 7）
        redoc_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_cors_origins),
        allow_credentials=False,          # 无 Cookie，令牌走 Authorization 头
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["authorization", "content-type"],
        max_age=600,
    )

    @app.middleware("http")
    async def body_size_guard(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            cl = request.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > MAX_BODY_BYTES:
                return JSONResponse(
                    status_code=413,
                    content={"error": {"code": "REQUEST_TOO_LARGE",
                                       "message": "请求体超过 2 MiB 上限", "details": {}}},
                )
        return await call_next(request)

    register_error_handlers(app)

    # 最小健康检查：不暴露数据，不需要认证（SPEC 7）
    @app.get("/healthz")
    def healthz() -> dict:
        return {"ok": True, "app": "researchmap", "version": __version__}

    app.include_router(api_router)

    # 接口 schema 要求认证（SPEC 7）：替换自动生成的公开 openapi 路由
    def _protected_openapi() -> dict:
        return app.openapi()

    app.router.routes = [
        r for r in app.router.routes
        if getattr(r, "path", None) != "/api/v1/openapi.json"
    ]
    app.add_api_route(
        "/api/v1/openapi.json", _protected_openapi, include_in_schema=False,
        dependencies=[Depends(require_auth)],
    )

    # 任何未匹配的 /api/* 一律 JSON 404，绝不回退到 SPA 壳（SPEC 7）
    @app.get("/api/{path:path}", include_in_schema=False)
    def api_unknown(path: str) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "NOT_FOUND",
                               "message": f"API 路径 /api/{path} 不存在", "details": {}}},
        )

    # 静态前端（生产同源部署）；开发时用 Vite + 代理
    # SPA 深链接（/p/<pid>…）需要回落到 index.html，而
    # StaticFiles(html=True) 对未知路径返回 404 —— 这里改为：
    # 命中真实文件则按文件返回，否则回 index.html（/api/* 已在前面被 404 拦截）。
    static = settings.static_dir or None
    if static and os.path.isdir(static):
        index_path = os.path.join(static, "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            candidate = os.path.normpath(os.path.join(static, full_path))
            if full_path and candidate.startswith(os.path.normpath(static)) \
                    and os.path.isfile(candidate):
                return FileResponse(candidate)
            return FileResponse(index_path)

    return app


app = create_app()

__all__ = ["app", "create_app"]