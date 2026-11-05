"""Server-sent events for a job: tails job_event rows and reports status changes."""
from __future__ import annotations

import asyncio
import json
import re
import time

from anyio import to_thread
from fastapi import APIRouter, Request
from sqlmodel import Session, select
from sse_starlette.sse import EventSourceResponse

from ..core.redact import PEER_REF_RE, PEER_TEXT
from ..db import repo
from ..db.models import Job, ProblemVersion, Submission
from ..db.session import get_engine
from .deps import SessionDep, UserDep, is_staff, iso
from .jobs import TERMINAL, get_visible_job

router = APIRouter(prefix="/jobs", tags=["jobs"])

POLL_S = 0.3
MAX_STREAM_S = 2 * 3600


# lines a student never sees: staff-only tools and the pre-analysis internals
STAFF_KINDS = {"security", "perm-allow", "perm-deny", "sandbox"}
STAGE_LABELS = {"queued": "Waiting in the queue", "compile": "Compiling", "tests": "Running tests",
                "memory": "Memory check", "quality": "Code quality", "review": "Writing feedback",
                "done": "Done"}
STAFF_PREFIXES = ("ai_detector", "pre-analysis", "llm pre-read", "pre-read", "similarity_flag:", "corpus")
HOST_PATH_RE = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\)[^\s'\"<>|]*")
# worker bookkeeping a student has no use for: result ids, dict dumps, cache notes, model calls and cache keys
STUDENT_DROP_KINDS = {"stored", "done", "cache", "llm"}
STUDENT_DROP_RE = re.compile(r"^running \w+ \(attempt \d+\)|LLM_DISABLED")
RULES_HASH_RE = re.compile(r" ?\(rules [^)]*\)")
CORPUS_REF_RE = re.compile(r"\b(web|llm):[^\s,;()\"'<>]*[^\s,;()\"'<>.]", re.ASCII)
CORPUS_TEXT = {"web": "a known online source", "llm": "an AI-generated sample"}


def staff_metrics(session: Session, job: Job | None) -> set[str]:
    """Names of the ai_detector metrics in any version of the job's problem."""
    pid = job.problem_id if job else None
    if pid is None and job and job.submission_id:
        sub = session.get(Submission, job.submission_id)
        pid = sub.problem_id if sub else None
    if pid is None:
        return set()
    names = set()
    for rules in session.exec(select(ProblemVersion.rules_json).where(ProblemVersion.problem_id == pid)).all():
        names.update(m.get("name") for m in (rules or {}).get("metrics") or [] if m.get("analyzer") == "ai_detector")
    return names


def student_event(ev: dict, hidden_metrics: set[str]) -> dict | None:
    """The event as a student may see it, or None to drop it."""
    msg = ev.get("msg") or ""
    kind = ev.get("kind")
    if kind in STAFF_KINDS or kind in STUDENT_DROP_KINDS or ev.get("metric") in hidden_metrics:
        return None
    if msg.lower().startswith(STAFF_PREFIXES) or any(msg.startswith(f"{m}:") for m in hidden_metrics):
        return None
    if STUDENT_DROP_RE.search(msg):
        return None
    msg = CORPUS_REF_RE.sub(lambda m: CORPUS_TEXT[m.group(1)], RULES_HASH_RE.sub("", msg))
    msg = HOST_PATH_RE.sub("<path>", PEER_REF_RE.sub(PEER_TEXT, msg))
    return {**ev, "msg": msg}


def _poll(job_id: int, after: int, staff: bool = True) -> tuple[str, list[dict], float | None, int]:
    with Session(get_engine()) as s:
        job = s.get(Job, job_id)
        status = job.status if job else "failed"
        rows = repo.events_after(s, job_id, after)
        last = rows[-1].id if rows else after
        events = [{"id": e.id, "ts": iso(e.ts), "kind": e.kind, "msg": e.msg, "metric": e.metric} for e in rows]
        if not staff:
            hidden = staff_metrics(s, job)
            events = [x for x in (student_event(e, hidden) for e in events) if x is not None]
        grade = None
        if status == "done" and job.submission_id:
            res = repo.current_result(s, job.submission_id)
            grade = res.grade if res else None
        return status, events, grade, last


def _last_id(request: Request) -> int:
    raw = request.headers.get("last-event-id") or request.query_params.get("last_event_id") or "0"
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def stage_event(stage: str) -> dict:
    return {"event": "stage", "data": json.dumps({"stage": stage, "label": STAGE_LABELS.get(stage, stage)})}


async def stream(request: Request, job_id: int, submission_id: int | None, after: int, staff: bool = True):
    status_sent = None
    started = time.monotonic()
    while True:
        status, events, grade, after = await to_thread.run_sync(_poll, job_id, after, staff)
        if status_sent is None and status == "queued":
            yield stage_event("queued")
        for ev in events:
            if ev["kind"] == "stage":
                yield {**stage_event(ev["msg"]), "id": str(ev["id"])}
                continue
            yield {"event": "log", "id": str(ev["id"]), "data": json.dumps(ev, ensure_ascii=False)}
        if status != status_sent:
            status_sent = status
            yield {"event": "status", "data": json.dumps({"status": status})}
        if status in TERMINAL:
            if status == "done":
                yield {"event": "result", "data": json.dumps({"submission_id": submission_id, "grade": grade})}
            yield {"event": "done", "data": json.dumps({"status": status})}
            return
        if await request.is_disconnected() or time.monotonic() - started > MAX_STREAM_S:
            return
        await asyncio.sleep(POLL_S)


@router.get("/{job_id}/events")
async def job_events(job_id: int, request: Request, user: UserDep, session: SessionDep):
    job = get_visible_job(session, user, job_id)
    job_id, submission_id, staff = job.id, job.submission_id, is_staff(user)
    # The request session would otherwise hold a pooled connection for the whole stream
    # (minutes); 15+ students watching at once then exhausted the pool. _poll opens its own.
    session.close()
    return EventSourceResponse(stream(request, job_id, submission_id, _last_id(request), staff), ping=15,
                               headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
