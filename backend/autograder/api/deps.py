"""Shared FastAPI dependencies: DB session, the logged-in user, role checks."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request
from sqlmodel import Session

from ..config import get_settings
from ..db.models import AuditLog, User
from ..db.session import get_session

COOKIE = "ag_token"
TOKEN_HOURS = 12
STAFF_ROLES = ("ta", "admin")
# reachable while a password change is pending
PW_CHANGE_PATHS = ("/api/auth/me", "/api/auth/change-password", "/api/auth/logout")
SESSION_ENDED = "Your session has ended. Sign in again."

SessionDep = Annotated[Session, Depends(get_session)]


class ApiError(HTTPException):
    """HTTPException whose JSON body carries extra keys next to detail."""

    def __init__(self, status_code: int, detail: str, **extra: Any):
        super().__init__(status_code, detail)
        self.extra = extra


def make_token(user: User) -> str:
    exp = datetime.now(UTC) + timedelta(hours=TOKEN_HOURS)
    payload = {"sub": str(user.id), "role": user.role, "tv": user.token_version or 0, "exp": exp}
    return jwt.encode(payload, get_settings().jwt_key(), algorithm="HS256")


def _token(request: Request) -> str | None:
    tok = request.cookies.get(COOKIE)
    if tok:
        return tok
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


def user_from_token(request: Request, session: Session) -> User:
    tok = _token(request)
    if not tok:
        raise HTTPException(401, "You are not signed in.")
    try:
        data = jwt.decode(tok, get_settings().jwt_key(), algorithms=["HS256"])
        uid = int(data["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(401, SESSION_ENDED) from None
    user = session.get(User, uid)
    if user is None or not user.is_active or int(data.get("tv", 0)) != (user.token_version or 0):
        raise HTTPException(401, SESSION_ENDED)
    return user


def current_user(request: Request, session: SessionDep) -> User:
    user = user_from_token(request, session)
    if user.must_change_pw and request.url.path not in PW_CHANGE_PATHS:
        raise ApiError(403, "Password change required. Choose a new password to continue.",
                       code="password_change_required")
    return user


UserDep = Annotated[User, Depends(current_user)]


def is_staff(user: User) -> bool:
    return user.role in STAFF_ROLES


def require_staff(user: UserDep) -> User:
    if not is_staff(user):
        raise HTTPException(403, "Only course staff can do this.")
    return user


def require_admin(user: UserDep) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only an admin can do this.")
    return user


StaffDep = Annotated[User, Depends(require_staff)]
AdminDep = Annotated[User, Depends(require_admin)]


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.isoformat()


def aware(dt: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; they are UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


def user_out(user: User) -> dict:
    return {"id": user.id, "roll_no": user.roll_no, "name": user.name, "role": user.role,
            "is_active": user.is_active, "must_change_pw": user.must_change_pw,
            "created_at": iso(user.created_at), "last_login_at": iso(user.last_login_at)}


def paging(page: int, page_size: int, max_size: int = 200) -> tuple[int, int]:
    """(offset, limit) from 1-based page numbers, clamped."""
    size = max(1, min(page_size, max_size))
    return (max(1, page) - 1) * size, size


def audit(session: Session, actor: User | None, action: str, target: str | None = None, **detail: Any) -> None:
    session.add(AuditLog(actor_id=actor.id if actor else None, action=action, target=target, detail=detail or None))
