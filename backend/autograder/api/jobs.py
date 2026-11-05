"""Job status for the owner of the submission (or staff)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlmodel import Session

from ..db import repo
from ..db.models import Job, Submission, User
from .deps import SessionDep, UserDep, is_staff, iso

router = APIRouter(prefix="/jobs", tags=["jobs"])

TERMINAL = ("done", "failed", "cancelled")


def can_see_job(session: Session, user: User, job: Job) -> bool:
    if is_staff(user):
        return True
    if job.submission_id is None:
        return False
    sub = session.get(Submission, job.submission_id)
    return sub is not None and sub.user_id == user.id


def get_visible_job(session: Session, user: User, job_id: int) -> Job:
    job = session.get(Job, job_id)
    if job is None or not can_see_job(session, user, job):
        raise HTTPException(404, "Job not found.")
    return job


def job_out(job: Job, *, staff: bool = False) -> dict:
    out = {
        "id": job.id, "kind": job.kind, "status": job.status, "submission_id": job.submission_id,
        "problem_id": job.problem_id, "priority": job.priority, "attempts": job.attempts,
        "created_at": iso(job.created_at), "claimed_at": iso(job.claimed_at), "finished_at": iso(job.finished_at),
        "error": job.error, "result": job.result,
    }
    if staff:
        out.update(worker_id=job.worker_id, heartbeat_at=iso(job.heartbeat_at), payload=job.payload,
                   traceback=job.traceback,
                   max_attempts=job.max_attempts)
    return out


@router.get("/{job_id}")
def get_job(job_id: int, user: UserDep, session: SessionDep):
    job = get_visible_job(session, user, job_id)
    out = job_out(job, staff=is_staff(user))
    if job.status == "done" and job.submission_id:
        res = repo.current_result(session, job.submission_id)
        out["grade"] = res.grade if res else None
    return out
