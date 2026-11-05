"""Staff: job queue, workers, overview and the audit log."""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from ..db.models import (
    AuditLog,
    Flag,
    Job,
    Problem,
    Result,
    Submission,
    User,
    WorkerBeat,
    utcnow,
)
from ..db import repo
from .deps import SessionDep, StaffDep, audit, aware, iso, paging, require_staff
from .jobs import job_out

router = APIRouter(prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)])

ACTIVE = ("queued", "running")
ONLINE_S = 30


def _jobs_out(session: Session, jobs: list[Job]) -> list[dict]:
    """job_out plus roll_no, problem_slug and duration_s."""
    sub_ids = {j.submission_id for j in jobs if j.submission_id}
    rolls: dict[int, str] = {}
    if sub_ids:
        rolls = dict(session.exec(select(Submission.id, User.roll_no).join(User, User.id == Submission.user_id)
                                  .where(Submission.id.in_(sub_ids))).all())
    slugs = dict(session.exec(select(Problem.id, Problem.slug)).all())
    now = utcnow()
    out = []
    for j in jobs:
        start = aware(j.claimed_at)
        end = aware(j.finished_at) or now
        out.append({**job_out(j, staff=True), "roll_no": rolls.get(j.submission_id),
                    "problem_slug": slugs.get(j.problem_id),
                    "duration_s": round((end - start).total_seconds(), 1) if start else None})
    return out


def workers(session: Session) -> list[dict]:
    now = utcnow()
    rows = session.exec(select(WorkerBeat).order_by(WorkerBeat.worker_id)).all()
    return [{"worker_id": b.worker_id, "host": b.host, "last_seen": iso(b.last_seen),
             "online": (now - aware(b.last_seen)).total_seconds() < ONLINE_S, "busy": b.busy, "lanes": b.lanes}
            for b in rows]


@router.get("/queue")
def queue(session: SessionDep, page: int = 1, page_size: int = 50, limit: int | None = None):
    counts = dict(session.exec(select(Job.status, func.count()).group_by(Job.status)).all())
    active = list(session.exec(select(Job).where(Job.status.in_(ACTIVE))
                               .order_by(Job.status.desc(), Job.priority.desc(), Job.id)).all())
    offset, size = paging(page, limit or page_size, 500)
    recent = list(session.exec(select(Job).where(Job.status.not_in(ACTIVE))
                               .order_by(Job.id.desc()).offset(offset).limit(size)).all())
    total = sum(n for s, n in counts.items() if s not in ACTIVE)
    return {"counts": {s: counts.get(s, 0) for s in ("queued", "running", "done", "failed", "cancelled")},
            "workers": workers(session),
            "active": _jobs_out(session, active),
            "recent": {"items": _jobs_out(session, recent), "total": total}}


@router.post("/jobs/retry-failed")
def retry_failed(user: StaffDep, session: SessionDep):
    """Requeue failed jobs that were not superseded by a later job of the same kind."""
    failed = session.exec(select(Job).where(Job.status == "failed").order_by(Job.id)).all()
    newest: dict[tuple, int] = {}
    for kind, sid, pid, jid in session.exec(select(Job.kind, Job.submission_id, Job.problem_id, func.max(Job.id))
                                            .group_by(Job.kind, Job.submission_id, Job.problem_id)).all():
        newest[(kind, sid, pid)] = jid
    n = 0
    for j in failed:
        if j.submission_id and newest.get((j.kind, j.submission_id, j.problem_id)) != j.id:
            continue
        j.status, j.attempts, j.worker_id, j.finished_at = "queued", 0, None, None
        j.error = j.traceback = j.result = None
        session.add(j)
        n += 1
    audit(session, user, "jobs.retry_failed", None, requeued=n)
    session.commit()
    return {"requeued": n}


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int, user: StaffDep, session: SessionDep):
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(404, "Job not found.")
    if job.status not in ACTIVE:
        raise HTTPException(409, f"This job has already finished ({job.status}).")
    job.status = "cancelled"
    job.finished_at = utcnow()
    job.error = f"Cancelled by {user.roll_no}"
    session.add(job)
    audit(session, user, "job.cancel", str(job_id))
    session.commit()
    return job_out(job, staff=True)


def _today_start() -> datetime:
    local = datetime.now().astimezone()
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


@router.get("/overview")
def overview(session: SessionDep):
    from .staff import submission_rows

    def count(stmt) -> int:
        return session.exec(select(func.count()).select_from(stmt.subquery())).one()

    open_flags = count(select(Flag.id).join(Result, Result.id == Flag.result_id)
                       .where(Result.is_current == True, Flag.review_status == "open", repo.needs_review(Flag.type)))
    statuses = dict(session.exec(select(Job.status, func.count()).group_by(Job.status)).all())
    now = utcnow()
    upcoming = [p for p in session.exec(select(Problem).where(Problem.status == "published",
                                                              Problem.due_at != None)).all()
                if aware(p.due_at) > now]
    nxt = min(upcoming, key=lambda p: aware(p.due_at), default=None)
    recent, _ = submission_rows(session, page_size=5)
    return {
        "open_flags": open_flags,
        "submissions_today": count(select(Submission.id).where(Submission.created_at >= _today_start())),
        "failed_jobs": statuses.get("failed", 0),
        "queued": statuses.get("queued", 0),
        "running": statuses.get("running", 0),
        "workers_online": sum(1 for w in workers(session) if w["online"]),
        "next_deadline": {"slug": nxt.slug, "title": nxt.title, "due_at": iso(nxt.due_at)} if nxt else None,
        "recent_submissions": recent,
    }


@router.get("/audit")
def audit_log(session: SessionDep, page: int = 1, page_size: int = 50, action: str | None = None):
    stmt = select(AuditLog, User).join(User, User.id == AuditLog.actor_id, isouter=True)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    offset, size = paging(page, page_size, 200)
    rows = session.exec(stmt.order_by(AuditLog.id.desc()).offset(offset).limit(size)).all()
    return {"items": [{"id": a.id, "ts": iso(a.ts), "actor_roll": u.roll_no if u else None, "action": a.action,
                       "target": a.target, "detail": a.detail} for a, u in rows], "total": total}
