"""Typed application errors and their HTTP mapping.

Error body shape (SPEC 6.4): {"error": {"code": ..., "message": ..., "details": {...}}}
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: Optional[dict[str, Any]] = None,
        **extra: Any,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        merged: dict[str, Any] = dict(details or {})
        merged.update(extra)
        self.details = merged

    def body(self) -> dict[str, Any]:
        return {"error": {"code": self.code, "message": self.message, "details": self.details}}


def err(status: int, code: str, message: str, **details: Any) -> AppError:
    return AppError(status, code, message, details)


# -- frequently used error factories -----------------------------------------

def not_found(message: str, code: str = "NOT_FOUND", **details: Any) -> AppError:
    return err(404, code, message, **details)


def invalid(message: str, code: str = "VALIDATION", operation_index: Optional[int] = None,
            field_path: Optional[str] = None, **details: Any) -> AppError:
    if operation_index is not None:
        details["operation_index"] = operation_index
    if field_path is not None:
        details["field"] = field_path
    return err(422, code, message, **details)


def conflict(message: str, code: str, **details: Any) -> AppError:
    return err(409, code, message, **details)


def unauthorized(message: str = "缺少或无效的访问令牌") -> AppError:
    return err(401, "UNAUTHORIZED", message)


def db_busy() -> AppError:
    return err(503, "DB_BUSY", "数据库繁忙，请稍后重试（保持相同的 request_id）")


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status, content=exc.body())

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI-level validation (path/query/body signature). Keep the shape
        # uniform with AppError 422s.
        first = exc.errors()[0] if exc.errors() else {}
        loc = [str(p) for p in first.get("loc", [])]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "VALIDATION",
                    "message": "请求参数无效",
                    "details": {
                        "issues": [
                            {"loc": ".".join(str(p) for p in e.get("loc", [])),
                             "msg": e.get("msg", ""), "type": e.get("type", "")}
                            for e in exc.errors()[:20]
                        ]
                    },
                }
            },
            headers={"X-Validation-Loc": ",".join(loc) if loc else None},
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        # Never leak stack traces or private paths to clients (SPEC 9).
        return JSONResponse(
            status_code=500,
            content={"error": {"code": "INTERNAL", "message": "服务器内部错误"}},
        )