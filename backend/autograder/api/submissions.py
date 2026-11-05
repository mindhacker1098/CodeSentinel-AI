"""Uploading submissions and reading their results."""
from __future__ import annotations

import json
import re
from pathlib import PurePath

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlmodel import Session, select
from starlette.datastructures import UploadFile

from ..core.redact import PEER_REF_RE, PEER_TEXT, student_view
from ..db import repo
from ..db.models import Flag, Job, Problem, Result, Submission, User
from .deps import ApiError, SessionDep, UserDep, is_staff, iso
from .problems import (
    GRADE_KINDS,
    chosen,
    get_problem_or_404,
    graded_rows,
    latest_jobs,
    per_user,
    submissions_left,
)

router = APIRouter(tags=["submissions"])

MAX_SOURCE_BYTES = 200 * 1024
FILENAME_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}\.c$")
ACTIVE = ("queued", "running")
TOO_BIG = "The file is larger than 200 KB."


def active_job(session: Session, user_id: int, problem_id: int) -> Job | None:
    stmt = (select(Job).join(Submission, Job.submission_id == Submission.id)
            .where(Submission.user_id == user_id, Submission.problem_id == problem_id,
                   Job.kind.in_(GRADE_KINDS), Job.status.in_(ACTIVE)))
    return session.exec(stmt).first()


def latest_job(session: Session, submission_id: int) -> Job | None:
    return latest_jobs(session, [submission_id]).get(submission_id)


def _clean_filename(name: str | None) -> str:
    name = PurePath((name or "").replace("\\", "/")).name or "main.c"
    if not FILENAME_RE.match(name):
        raise HTTPException(422, "The file name must end in .c and use only letters, digits, _ . and -.")
    return name


async def _read_upload(request: Request) -> tuple[str, bytes]:
    ctype = request.headers.get("content-type", "")
    try:
        declared = int(request.headers.get("content-length") or 0)
    except ValueError:
        declared = 0
    if declared > 4 * MAX_SOURCE_BYTES:
        raise HTTPException(413, TOO_BIG)
    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(422, "Attach the program as the 'file' field.")
        data = await upload.read(MAX_SOURCE_BYTES + 1)
        filename = form.get("filename") or upload.filename
        await upload.close()
        return str(filename or ""), data
    if ctype.startswith("application/json"):
        body = await request.body()
        if len(body) > 4 * MAX_SOURCE_BYTES:
            raise HTTPException(413, TOO_BIG)
        try:
            obj = json.loads(body)
        except ValueError:
            raise HTTPException(422, "The request body is not valid JSON.") from None
        if not isinstance(obj, dict) or not isinstance(obj.get("source"), str):
            raise HTTPException(422, "Source code is required.")
        return str(obj.get("filename") or ""), obj["source"].encode("utf-8")
    raise HTTPException(415, "Upload the program as a file or as JSON {filename, source}.")


@router.post("/problems/{slug}/submissions", status_code=201)
async def submit(slug: str, request: Request, user: UserDep, session: SessionDep):
    problem = get_problem_or_404(session, slug, user)
    if problem.finalized_at is not None:
        raise HTTPException(403, "Grading is closed for this problem.")
    if problem.status != "published" and not is_staff(user):
        raise HTTPException(403, "This problem is not accepting submissions.")
    filename, data = await _read_upload(request)
    filename = _clean_filename(filename)
    if len(data) > MAX_SOURCE_BYTES:
        raise HTTPException(413, TOO_BIG)
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(422, "The file must be UTF-8 text.") from None
    source = source.removeprefix("\ufeff")
    if not source.strip():
        raise HTTPException(422, "The file is empty.")
    if "\x00" in source:
        raise HTTPException(422, "The file contains NUL bytes; upload the .c source, not a binary.")

    running = active_job(session, user.id, problem.id)
    if running:
        raise ApiError(409, "Your previous submission for this problem is still being graded.",
                       job_id=running.id, submission_id=running.submission_id)
    if submissions_left(session, problem, user) <= 0:
        raise HTTPException(429, f"You can submit at most {problem.max_submissions_per_hour} times an hour "
                                 "for this problem. Try again later.")
    try:
        sub = repo.create_submission(session, user, problem, filename, source)
    except ValueError as e:
        raise HTTPException(409, str(e)) from None
    job = repo.enqueue_job(session, "grade", 10, submission_id=sub.id, problem_id=problem.id)
    return {"submission_id": sub.id, "job_id": job.id}


def submission_out(sub: Submission, res: Result | None, job: Job | None, slug: str | None) -> dict:
    return {
        "id": sub.id, "problem": slug, "filename": sub.filename, "created_at": iso(sub.created_at),
        "is_late": sub.is_late, "user_id": sub.user_id,
        "grade": res.grade if res else None, "partial": res.partial if res else None,
        "provisional": res.provisional if res else None,
        "job": {"id": job.id, "kind": job.kind, "status": job.status,
                "error": job.error.splitlines()[0] if job.error else None} if job else None,
        "job_status": job.status if job else None,
    }


def get_visible_submission(session: Session, user: User, sub_id: int) -> Submission:
    """Owner or staff; everyone else gets the same 404 as for a missing id."""
    sub = session.get(Submission, sub_id)
    if sub is None or (sub.user_id != user.id and not is_staff(user)):
        raise HTTPException(404, "Submission not found.")
    return sub


def report_for(session: Session, user: User, problem: Problem, res: Result) -> dict:
    report = res.report_json or {}
    if is_staff(user):
        return report
    rows = session.exec(select(Flag).where(Flag.result_id == res.id)).all()
    raised = [{"type": f.type, "detail": f.detail} for f in rows if f.source == "staff"]
    if raised:
        report = {**report, "flags": [*(report.get("flags") or []), *raised]}
    return student_view(report, reveal_hidden_tests=problem.reveal_hidden_tests,
                        reviews={(f.type, f.detail): f.review_status for f in rows})


def staff_notes(session: Session, sub: Submission) -> dict:
    """override, staff_comment and effective_grade for a submission."""
    names = {u.id: u.name or u.roll_no for u in session.exec(
        select(User).where(User.id.in_([x for x in (sub.override_by, sub.comment_by) if x]))).all()}
    res = repo.current_result(session, sub.id)
    flags = repo.current_flags(session, [sub.id]).get(sub.id, [])
    problem = session.get(Problem, sub.problem_id)
    return {
        "override": None if sub.override_grade is None else {
            "grade": sub.override_grade, "reason": sub.override_reason or "", "by": names.get(sub.override_by),
            "at": iso(sub.override_at)},
        "staff_comment": None if not sub.staff_comment else {
            "text": sub.staff_comment, "by": names.get(sub.comment_by), "at": iso(sub.comment_at)},
        "effective_grade": repo.effective_grade(problem, sub, res, repo.confirmed_copy(flags)),
    }


def counted_ids(session: Session, user_id: int, problem_ids: set[int]) -> set[int]:
    out = set()
    for pid in problem_ids:
        problem = session.get(Problem, pid)
        d = per_user(graded_rows(session, pid, user_id)).get(user_id)
        if problem and d:
            out.add(chosen(problem, d)[0].id)
    return out


@router.get("/submissions")
def list_submissions(user: UserDep, session: SessionDep, problem: str | None = None):
    stmt = select(Submission).where(Submission.user_id == user.id)
    problems = {p.id: p for p in session.exec(select(Problem)).all()}
    if problem:
        p = get_problem_or_404(session, problem, user)
        stmt = stmt.where(Submission.problem_id == p.id)
    subs = list(session.exec(stmt.order_by(Submission.id.desc())).all())
    ids = [s.id for s in subs]
    results = {r.submission_id: r for r in session.exec(
        select(Result).where(Result.submission_id.in_(ids), Result.is_current == True)).all()} if ids else {}
    jobs = latest_jobs(session, ids)
    flags = repo.current_flags(session, ids)
    counted = counted_ids(session, user.id, {s.problem_id for s in subs})
    items = []
    for sub in subs:
        p = problems.get(sub.problem_id)
        res, job = results.get(sub.id), jobs.get(sub.id)
        items.append({
            "id": sub.id, "problem_slug": p.slug if p else None, "problem_title": p.title if p else None,
            "filename": sub.filename, "created_at": iso(sub.created_at),
            "grade": res.grade if res else None,
            "effective_grade": repo.effective_grade(p, sub, res, repo.confirmed_copy(flags.get(sub.id, []))),
            "provisional": res.provisional if res else None, "partial": res.partial if res else None,
            "job_status": job.status if job else None, "counted": sub.id in counted, "is_late": sub.is_late,
        })
    return {"items": items, "total": len(items)}


@router.get("/submissions/{sub_id}")
def get_submission(sub_id: int, user: UserDep, session: SessionDep):
    sub = get_visible_submission(session, user, sub_id)
    problem = session.get(Problem, sub.problem_id)
    res = repo.current_result(session, sub.id)
    out = submission_out(sub, res, latest_job(session, sub.id), problem.slug)
    out.update(problem_slug=problem.slug, problem_title=problem.title, source=sub.source,
               report=report_for(session, user, problem, res) if res else None, **staff_notes(session, sub))
    feedback = feedback_job(session, sub.id, res.id) if res else None
    out["feedback_job"] = ({"id": feedback.id, "status": feedback.status,
                            "error": "Feedback job failed. Retry or ask staff to check the worker logs."
                            if feedback.error else None} if feedback else None)
    if is_staff(user):
        owner = session.get(User, sub.user_id)
        out["user"] = {"id": owner.id, "roll_no": owner.roll_no, "name": owner.name} if owner else None
        out["problem_version_id"] = sub.problem_version_id
    return out


def feedback_job(session: Session, sub_id: int, result_id: int) -> Job | None:
    jobs = session.exec(select(Job).where(Job.submission_id == sub_id, Job.kind == "enrich")
                        .order_by(Job.id.desc())).all()
    return next((j for j in jobs if (j.payload or {}).get("result_id") == result_id), None)


@router.post("/submissions/{sub_id}/feedback")
def request_feedback(sub_id: int, user: UserDep, session: SessionDep):
    sub = get_visible_submission(session, user, sub_id)
    result = repo.current_result(session, sub.id)
    if result is None:
        raise HTTPException(409, "Wait for grading to finish before requesting feedback.")
    current = feedback_job(session, sub.id, result.id)
    if current and current.status in ACTIVE:
        return {"job_id": current.id, "status": current.status}
    if current:
        from .deps import aware
        from ..db.models import utcnow
        if (utcnow() - aware(current.created_at)).total_seconds() < 60:
            raise HTTPException(429, "Wait one minute before requesting another AI review.")
    job = repo.enqueue_job(session, "enrich", 5, submission_id=sub.id, problem_id=sub.problem_id,
                           payload={"result_id": result.id})
    result.report_json = {**(result.report_json or {}), "code_feedback": {
        **((result.report_json or {}).get("code_feedback") or {}), "status": "queued"}}
    session.add(result)
    session.commit()
    return {"job_id": job.id, "status": job.status}


def _result_or_404(session: Session, user: User, sub_id: int) -> tuple[Problem, Result]:
    sub = get_visible_submission(session, user, sub_id)
    res = repo.current_result(session, sub.id)
    if res is None:
        raise HTTPException(404, "This submission has not been graded yet.")
    return session.get(Problem, sub.problem_id), res


@router.get("/submissions/{sub_id}/source.c")
def source_c(sub_id: int, user: UserDep, session: SessionDep):
    sub = get_visible_submission(session, user, sub_id)
    return Response(sub.source, media_type="text/x-csrc; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{sub.filename}"'})


@router.get("/submissions/{sub_id}/report.json")
def report_json(sub_id: int, user: UserDep, session: SessionDep):
    problem, res = _result_or_404(session, user, sub_id)
    return JSONResponse(report_for(session, user, problem, res),
                        headers={"Content-Disposition": f'inline; filename="report_{sub_id}.json"'})


@router.get("/submissions/{sub_id}/report.txt")
def report_txt(sub_id: int, user: UserDep, session: SessionDep):
    problem, res = _result_or_404(session, user, sub_id)
    if is_staff(user) and res.report_txt:
        text = res.report_txt
    else:
        from ..core.report import render_text
        try:
            text = render_text(report_for(session, user, problem, res))
        except (KeyError, TypeError, ValueError):
            text = PEER_REF_RE.sub(PEER_TEXT, res.report_txt or "")
    return PlainTextResponse(text)
