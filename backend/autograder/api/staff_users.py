"""Staff: user accounts. TAs manage students; only an admin creates staff accounts or changes roles."""
from __future__ import annotations

import csv
import io
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import select

from ..db import repo
from ..db.models import Job, Submission, User
from .deps import ApiError, AdminDep, SessionDep, StaffDep, audit, paging, require_staff, user_out

router = APIRouter(prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)])

MAX_CSV = 5 * 1024 * 1024
Role = Literal["student", "ta", "admin"]


def _csv(text: str, name: str) -> Response:
    return Response(text, media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/users")
def list_users(session: SessionDep, q: str | None = None, role: str | None = None, active: bool | None = None,
               page: int = 1, page_size: int = 50):
    stmt = select(User)
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.roll_no).like(like), func.lower(User.name).like(like)))
    if role:
        stmt = stmt.where(User.role == role)
    if active is not None:
        stmt = stmt.where(User.is_active == active)
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    offset, limit = paging(page, page_size, 500)
    rows = session.exec(stmt.order_by(User.roll_no).offset(offset).limit(limit)).all()
    return {"items": [user_out(u) for u in rows], "total": total}


class NewUser(BaseModel):
    roll_no: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    role: Role = "student"


@router.post("/users", status_code=201)
def create_user(body: NewUser, user: StaffDep, session: SessionDep):
    if body.role != "student" and user.role != "admin":
        raise HTTPException(403, "Only an admin can add staff accounts.")
    roll = repo.normalize_roll(body.roll_no)
    err = repo.roll_error(roll)
    if err:
        raise HTTPException(422, err)
    if repo.get_user_by_roll(session, roll):
        raise HTTPException(409, f"A user with roll number {roll} already exists.")
    password = repo.generate_password()
    new = repo.create_user(session, roll, " ".join(body.name.split()), body.role, password, must_change_pw=True)
    audit(session, user, "user.create", new.roll_no, role=new.role)
    session.commit()
    return {"user": user_out(new), "password": password}


class UserPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    role: Role | None = None
    is_active: bool | None = None
    reset_password: bool = False


@router.patch("/users/{user_id}")
def patch_user(user_id: int, body: UserPatch, user: StaffDep, session: SessionDep):
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(404, "User not found.")
    role_change = body.role is not None and body.role != target.role
    if user.role != "admin" and (target.role != "student" or role_change):
        raise HTTPException(403, "Only an admin can change staff accounts or roles.")
    if target.id == user.id and (body.is_active is False or role_change):
        raise HTTPException(409, "You cannot deactivate your own account or change your own role.")
    if target.role == "admin" and target.is_active and (role_change or body.is_active is False):
        others = session.exec(select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active == True, User.id != target.id)).one()
        if not others:
            raise HTTPException(409, "You cannot remove the last active admin.")
    out: dict = {}
    if body.name is not None:
        target.name = " ".join(body.name.split())
    if role_change:
        target.role = body.role
        repo.revoke_sessions(target)
    if body.is_active is not None and body.is_active != target.is_active:
        target.is_active = body.is_active
        if not body.is_active:
            repo.revoke_sessions(target)
    if body.reset_password:
        pw = repo.generate_password()
        target.password_hash = repo.hash_password(pw)
        target.must_change_pw = True
        repo.revoke_sessions(target)
        out["password"] = pw
    session.add(target)
    audit(session, user, "user.update", target.roll_no,
          **body.model_dump(exclude_none=True, exclude={"reset_password"}), reset_password=body.reset_password)
    session.commit()
    session.refresh(target)
    return {"user": user_out(target), **out}


ROLE_NOUN = {"student": "student", "ta": "TA", "admin": "admin"}


@router.delete("/users/{user_id}")
def delete_user(user_id: int, user: AdminDep, session: SessionDep, force: bool = False):
    """Hard-delete an account. Users with submissions are kept unless force=1, which removes their
    submissions, results, flags, fingerprints, jobs and job events in the same transaction."""
    target = session.get(User, user_id)
    if target is None:
        raise HTTPException(404, "User not found.")
    if target.id == user.id:
        raise HTTPException(409, "You cannot delete your own account.")
    if target.role == "admin":
        others = session.exec(select(func.count()).select_from(User).where(
            User.role == "admin", User.is_active == True, User.id != target.id)).one()
        if not others:
            raise HTTPException(409, "You cannot delete the last admin.")
    n = session.exec(select(func.count()).select_from(Submission).where(Submission.user_id == target.id)).one()
    if n and not force:
        noun = ROLE_NOUN.get(target.role, "user")
        raise ApiError(409, f"This {noun} has {n} submission{'s' if n != 1 else ''}. Deactivate them instead, "
                            "so their grades stay in the gradebook.", code="has_submissions", submissions=n)
    if n:
        running = session.exec(select(func.count()).select_from(Job).join(Submission, Submission.id == Job.submission_id)
                               .where(Submission.user_id == target.id, Job.status == "running")).one()
        if running:
            raise HTTPException(409, "A grading job for this user is running. Try again when it finishes.")
    roll, role = target.roll_no, target.role
    counts = repo.purge_user(session, target)
    audit(session, user, "user.delete", roll, role=role, force=bool(n), **counts)
    session.commit()
    return {"deleted": user_id, "roll_no": roll, **counts}


def _roster_rows(text: str) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    if reader.fieldnames is None or "roll_no" not in [(h or "").strip().lower() for h in reader.fieldnames]:
        raise HTTPException(422, "The CSV needs a header row: roll_no,name,role.")
    rows = []
    for row in reader:
        clean = {(k or "").strip().lower(): (v or "").strip() if isinstance(v, str) else "" for k, v in row.items()}
        clean.pop("password", None)
        clean["_line"] = reader.line_num
        rows.append(clean)
    return rows


async def _roster_text(request: Request) -> str:
    if request.headers.get("content-type", "").startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if upload is None or isinstance(upload, str):
            raise HTTPException(422, "Attach the roster CSV as the 'file' field.")
        data = await upload.read(MAX_CSV + 1)
    else:
        data = await request.body()
    if len(data) > MAX_CSV:
        raise HTTPException(413, "The CSV is larger than 5 MB.")
    return data.decode("utf-8", errors="replace")


@router.post("/users/import")
async def import_users(request: Request, user: StaffDep, session: SessionDep, dry_run: bool = False,
                       format: str | None = None):
    rows = _roster_rows(await _roster_text(request))
    staff_ok = user.role == "admin"
    if dry_run:
        return {"rows": repo.plan_import(session, rows, allow_staff=staff_ok)}
    out = repo.import_roster(session, rows, allow_staff=staff_ok)
    counts = {k: sum(r["status"] == s for r in out) for k, s in
              (("created", "create"), ("skipped", "skip"), ("rejected", "reject"))}
    audit(session, user, "users.import", None, **counts)
    session.commit()
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        w.writerow(["roll_no", "name", "role", "password", "status", "reason"])
        for r in out:
            w.writerow([r["roll_no"], r["name"], r["role"], r.get("password", ""), r["status"], r["reason"]])
        return _csv(buf.getvalue(), "passwords.csv")
    return {"rows": out, **counts}


@router.get("/users/template.csv")
def roster_template():
    return _csv("roll_no,name,role\n2601CS01,Aarav Sharma,student\n2601CS02,Diya Patel,student\n",
                "roster_template.csv")


@router.get("/users/export.csv")
def export_users(session: SessionDep):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["roll_no", "name", "role", "is_active", "created_at", "last_login_at"])
    for u in session.exec(select(User).order_by(User.roll_no)).all():
        out = user_out(u)
        w.writerow([u.roll_no, u.name, u.role, int(u.is_active), out["created_at"], out["last_login_at"] or ""])
    return _csv(buf.getvalue(), "roster.csv")
