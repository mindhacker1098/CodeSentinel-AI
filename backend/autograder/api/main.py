"""FastAPI application: `uvicorn autograder.api.main:app --port 8000`."""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from datetime import timedelta
from pathlib import Path

from anyio import to_thread
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, select
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..config import PROJECT_ROOT, get_settings
from ..db.models import Job, WorkerBeat, utcnow
from ..db.session import get_engine, init_db
from . import auth, jobs, problems, sse, staff, staff_ops, staff_users, submissions
from .deps import aware, require_staff
from .errors import validation_message

VERSION = "2.0.0"

FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
HEALTH_TTL_S = 30.0
_health_cache: dict = {"at": 0.0, "value": None}


def _sandbox_status() -> dict:
    from ..core.sandbox.select import sandbox_status
    try:
        return asyncio.run(sandbox_status(get_settings()))
    except Exception as e:  # noqa: BLE001
        return {"selected": None, "error": f"{type(e).__name__}: {e}"}


async def _slow_health() -> dict:
    now = time.monotonic()
    if _health_cache["value"] is not None and now - _health_cache["at"] < HEALTH_TTL_S:
        return _health_cache["value"]
    from ..core.llm import ollama_status
    sandbox = await to_thread.run_sync(_sandbox_status)
    try:
        ollama = await ollama_status(get_settings())
    except Exception as e:  # noqa: BLE001
        ollama = {"running": False, "models": [], "error": str(e)}
    try:
        from ..core.codacy import codacy_status
        codacy = await codacy_status(get_settings())
    except Exception as e:  # noqa: BLE001
        codacy = {"available": False, "reason": f"{type(e).__name__}: {e}"}
    value = {"sandbox": sandbox, "ollama": ollama, "codacy": codacy}
    _health_cache.update(at=now, value=value)
    return value


def _workers_alive() -> list[str]:
    cutoff = utcnow() - timedelta(seconds=60)
    with Session(get_engine()) as s:
        rows = set(s.exec(select(Job.worker_id).where(Job.status == "running", Job.heartbeat_at >= cutoff)
                          .distinct()).all())
        rows |= {b.worker_id for b in s.exec(select(WorkerBeat)).all()
                 if aware(b.last_seen) >= utcnow() - timedelta(seconds=30)}
    return sorted(w for w in rows if w)


def _analyzers() -> dict:
    from ..core.analyzers import IMPORT_ERRORS, analyzer_names
    return {"available": analyzer_names(), "import_errors": dict(IMPORT_ERRORS)}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db(get_engine())
    get_settings().jwt_key()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="AutoGrader", version=VERSION, lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                       allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    for module in (auth, problems, submissions, jobs, sse, staff, staff_users, staff_ops):
        app.include_router(module.router, prefix="/api")

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        body = {"detail": exc.detail, **getattr(exc, "extra", {})}
        return JSONResponse(body, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        return JSONResponse({"detail": validation_message(exc.errors())}, status_code=422)

    @app.get("/api/health", tags=["health"])
    async def health():
        return {"ok": True, "version": VERSION}

    @app.get("/api/staff/health", tags=["health"], dependencies=[Depends(require_staff)])
    async def staff_health(quick: bool = False):
        out = {"ok": True, "version": VERSION, "workers_alive": await to_thread.run_sync(_workers_alive),
               "analyzers": _analyzers()}
        if not quick:
            out.update(await _slow_health())
        return out

    @app.api_route("/api/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
    async def api_not_found(rest: str):
        raise HTTPException(404, "This API endpoint does not exist.")

    if (FRONTEND_DIST / "index.html").is_file():
        _mount_spa(app, FRONTEND_DIST)
    return app


def _mount_spa(app: FastAPI, dist: Path) -> None:
    if (dist / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        target = (root / path).resolve()
        if path and target.is_file() and target.is_relative_to(root):
            return FileResponse(target)
        return FileResponse(root / "index.html")


app = create_app()
