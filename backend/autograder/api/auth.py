"""Login, logout, current user, password change."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from ..config import get_settings
from ..db import repo
from ..db.models import utcnow
from .deps import (
    COOKIE,
    TOKEN_HOURS,
    SessionDep,
    UserDep,
    make_token,
    user_from_token,
    user_out,
)

router = APIRouter(prefix="/auth", tags=["auth"])

RATE_WINDOW_S = 60.0
RATE_LIMIT = 10                                       # failed logins per (ip, roll) per minute
ROLL_RATE_LIMIT = 30                                  # failed logins per roll from anywhere
IP_RATE_LIMIT = get_settings().LOGIN_FAILS_PER_IP     # failed logins per ip
IP_ATTEMPT_LIMIT = get_settings().LOGIN_ATTEMPTS_PER_IP  # all logins per ip (campus NAT: a whole class)
_attempts: dict[str, deque] = defaultdict(deque)
_lock = threading.Lock()


class LoginIn(BaseModel):
    roll_no: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class ChangePasswordIn(BaseModel):
    old: str = Field(max_length=256)
    new: str = Field(min_length=repo.PW_MIN, max_length=repo.PW_MAX)


def _prune(now: float) -> None:
    for key in [k for k, q in _attempts.items() if not q or now - q[-1] > RATE_WINDOW_S]:
        del _attempts[key]


def _recent(key: str, now: float) -> deque:
    q = _attempts[key]
    while q and now - q[0] > RATE_WINDOW_S:
        q.popleft()
    return q


def _rate_ok(*limits: tuple[str, int]) -> bool:
    """True while every key is under its limit (counts only what _record added)."""
    now = time.monotonic()
    with _lock:
        if len(_attempts) > 10000:
            _prune(now)
        return all(len(_recent(key, now)) < limit for key, limit in limits)


def _record(*keys: str) -> None:
    now = time.monotonic()
    with _lock:
        for key in keys:
            _attempts[key].append(now)


def reset_rate_limit() -> None:
    with _lock:
        _attempts.clear()


def client_ip(request: Request) -> str:
    """Peer address; behind a trusted reverse proxy, the first X-Forwarded-For entry."""
    peer = request.client.host if request.client else "?"
    trusted = {p.strip() for p in get_settings().TRUSTED_PROXIES.split(",") if p.strip()}
    if peer in trusted:
        fwd = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if fwd:
            return fwd
    return peer


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, session: SessionDep):
    # Only failed logins count toward the limits: a whole class behind one campus NAT
    # must be able to log in at once, while password guessing is still throttled.
    roll = repo.normalize_roll(body.roll_no)
    ip = client_ip(request)
    fail_keys = (f"ip:{ip}", f"{ip}|{roll.lower()}", f"roll:{roll.lower()}")
    if not _rate_ok((fail_keys[0], IP_RATE_LIMIT), (fail_keys[1], RATE_LIMIT), (fail_keys[2], ROLL_RATE_LIMIT),
                    (f"all:{ip}", IP_ATTEMPT_LIMIT)):
        raise HTTPException(429, "Too many sign-in attempts. Wait a minute and try again.")
    _record(f"all:{ip}")
    user = repo.get_user_by_roll(session, roll)
    if user is None or not user.is_active or not repo.verify_password(body.password, user.password_hash):
        _record(*fail_keys)
        raise HTTPException(401, "Wrong roll number or password.")
    user.last_login_at = utcnow()
    session.add(user)
    session.commit()
    session.refresh(user)
    _set_cookie(request, response, user)
    return {"user": user_out(user)}


def _set_cookie(request: Request, response: Response, user) -> None:
    secure = get_settings().COOKIE_SECURE or request.url.scheme == "https"
    response.set_cookie(COOKIE, make_token(user), max_age=TOKEN_HOURS * 3600, httponly=True,
                        samesite="strict", path="/", secure=secure)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/", httponly=True, samesite="strict")
    return {"ok": True}


@router.get("/me")
def me(request: Request, session: SessionDep):
    """Never 401: anonymous or expired sessions get {user: null}."""
    try:
        user = user_from_token(request, session)
    except HTTPException:
        return {"user": None}
    return {"user": user_out(user)}


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request, response: Response, user: UserDep,
                    session: SessionDep):
    if not repo.verify_password(body.old, user.password_hash):
        raise HTTPException(400, "The current password is wrong.")
    if body.new == body.old:
        raise HTTPException(400, "The new password must be different from the current one.")
    user.password_hash = repo.hash_password(body.new)
    user.must_change_pw = False
    repo.revoke_sessions(user)
    session.add(user)
    session.commit()
    session.refresh(user)
    # other devices are signed out; this one gets a fresh token
    _set_cookie(request, response, user)
    return {"ok": True, "user": user_out(user)}
