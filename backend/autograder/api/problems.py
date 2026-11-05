"""Student view of problems."""
from __future__ import annotations

import asyncio
import re
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, HTTPException
from sqlalchemy import func
from sqlmodel import Session, select

from ..config import get_settings
from ..db import repo
from ..db.models import Job, Problem, ProblemVersion, Result, Submission, User, utcnow
from ..db.session import new_session
from .deps import SessionDep, UserDep, aware, is_staff, iso

router = APIRouter(prefix="/problems", tags=["problems"])

SAMPLE_MAX = 4000
GRADE_KINDS = ("grade", "regrade")

# analyzer -> (label, description) shown to students instead of analyzer ids
METRIC_LABELS = {
    "io_tests": ("Correctness", "Hidden test cases"),
    "compiler_warnings": ("Clean build", "Compiler warnings and errors under strict flags"),
    "static_analysis": ("Structure", "Function length and branching complexity"),
    "function_split": ("Modularity", "Splitting the work into helper functions"),
    "edge_case_runner": ("Edge cases", "Tricky and random inputs compared with the reference"),
    "complexity_estimator": ("Efficiency", "How the running time grows with the input size"),
    "sanitizer_run": ("Memory safety", "Leaks and invalid memory use"),
    "llm_review": ("Readability", "Review of naming, comments and layout"),
    "similarity_flag": ("Similarity review", "Comparison with available sources; does not establish originality"),
    "codacy_review": ("Code quality", "Static analysis rules"),
    "ai_detector": ("AI-origin check", "Staff-only signal; it does not change the grade"),
}


def visible(problem: Problem, user: User | None) -> bool:
    """Staff see everything; students only published problems that have opened."""
    if user is not None and is_staff(user):
        return True
    opens = aware(problem.opens_at)
    return problem.status == "published" and (opens is None or opens <= utcnow())


def get_problem_or_404(session: Session, slug: str, user: User | None = None) -> Problem:
    p = repo.get_problem_by_slug(session, slug)
    if p is None or (user is not None and not visible(p, user)):
        raise HTTPException(404, "Problem not found.")
    return p


def read_sample(pv: ProblemVersion | None) -> str:
    if pv is None:
        return ""
    name = (pv.rules_json or {}).get("sample_input")
    if not name:
        return ""
    path = Path(pv.dir_path) / name
    if not path.is_file():
        return ""
    return path.read_bytes()[:SAMPLE_MAX].decode("utf-8", errors="replace")


def strip_title(md: str, title: str) -> str:
    """Drop a leading '# heading' that only repeats the title."""
    m = re.match(r"\s*#\s+(.+?)\s*(?:\n|$)", md or "")
    if m and m.group(1).strip().lower() == (title or "").strip().lower():
        return md[m.end():].lstrip("\n")
    return md


def metric_rows(rules: dict | None, *, staff: bool = False) -> list[dict]:
    out = []
    for m in (rules or {}).get("metrics") or []:
        if not isinstance(m, dict):
            continue
        if m.get("analyzer") == "ai_detector" and not m.get("weight") and not staff:
            continue
        label, desc = METRIC_LABELS.get(m.get("analyzer"), (str(m.get("name") or "").replace("_", " ").capitalize(),
                                                           ""))
        out.append({"name": m.get("name"), "analyzer": m.get("analyzer"), "label": label, "description": desc,
                    "weight": m.get("weight")})
    return out


def deadline_passed(problem: Problem) -> bool:
    due = aware(problem.due_at)
    return due is not None and utcnow() > due


def graded_rows(session: Session, problem_id: int, user_id: int | None = None) -> list[tuple[Submission, Result | None]]:
    """Every submission of a problem with its current result (or None), oldest first."""
    stmt = (select(Submission, Result)
            .join(Result, (Result.submission_id == Submission.id) & (Result.is_current == True), isouter=True)
            .where(Submission.problem_id == problem_id))
    if user_id is not None:
        stmt = stmt.where(Submission.user_id == user_id)
    return list(session.exec(stmt.order_by(Submission.id)).all())


def per_user(rows: list[tuple[Submission, Result | None]]) -> dict[int, dict]:
    """Group rows by user: latest submission, best graded one and the count."""
    out: dict[int, dict] = {}
    for sub, res in rows:
        d = out.setdefault(sub.user_id, {"latest": None, "best": None, "count": 0})
        d["count"] += 1
        d["latest"] = (sub, res)
        if res is not None and (d["best"] is None or res.grade > d["best"][1].grade):
            d["best"] = (sub, res)
    return out


def chosen(problem: Problem, d: dict) -> tuple[Submission, Result | None]:
    """The submission that counts for the gradebook under the problem's grade policy."""
    if problem.grade_policy == "best" and d["best"] is not None:
        return d["best"]
    return d["latest"]


def latest_jobs(session: Session, sub_ids: list[int]) -> dict[int, Job]:
    """Newest grade/regrade job per submission (follow-up enrich/profile jobs are not shown)."""
    out: dict[int, Job] = {}
    if sub_ids:
        for j in session.exec(select(Job).where(Job.submission_id.in_(sub_ids), Job.kind.in_(GRADE_KINDS))
                              .order_by(Job.id)).all():
            out[j.submission_id] = j
    return out


def submissions_left(session: Session, problem: Problem, user: User) -> int:
    if is_staff(user):
        return problem.max_submissions_per_hour
    since = utcnow() - timedelta(hours=1)
    n = session.exec(select(func.count()).select_from(Submission).where(
        Submission.user_id == user.id, Submission.problem_id == problem.id, Submission.created_at >= since)).one()
    return max(0, problem.max_submissions_per_hour - n)


def problem_summary(session: Session, p: Problem, user: User, pv: ProblemVersion | None) -> dict:
    mine = per_user(graded_rows(session, p.id, user.id)).get(user.id)
    rules = (pv.rules_json if pv else None) or {}
    out = {
        "slug": p.slug, "title": p.title, "status": p.status, "due_at": iso(p.due_at), "opens_at": iso(p.opens_at),
        "deadline_passed": deadline_passed(p), "finalized": p.finalized_at is not None,
        "grade_policy": p.grade_policy, "max_submissions_per_hour": p.max_submissions_per_hour,
        "submissions_left_this_hour": submissions_left(session, p, user),
        "limits": {"time_limit_s": rules.get("time_limit_s"), "memory_limit_mb": rules.get("memory_limit_mb")},
        "my_count": mine["count"] if mine else 0, "my_best": None, "my_latest": None,
    }
    if mine:
        subs = [x[0] for x in (mine["best"], mine["latest"]) if x]
        flags = repo.current_flags(session, [s.id for s in subs])
        jobs = latest_jobs(session, [mine["latest"][0].id])

        def grade(pair) -> float | None:
            sub, res = pair
            return repo.effective_grade(p, sub, res, repo.confirmed_copy(flags.get(sub.id, [])))

        if mine["best"]:
            sub, res = mine["best"]
            out["my_best"] = {"grade": grade(mine["best"]), "provisional": res.provisional, "submission_id": sub.id}
        sub, res = mine["latest"]
        job = jobs.get(sub.id)
        out["my_latest"] = {"grade": grade(mine["latest"]), "provisional": res.provisional if res else None,
                            "submission_id": sub.id, "job_status": job.status if job else None}
    return out


_sample_tried: set[int] = set()


def fill_sample_output(pv_id: int) -> None:
    """Run the reference on the sample input once per version and cache the output (a second or two).
    Blocking: call it from a worker thread, never from the event loop."""
    from ..core.problemcheck import sample_output

    if pv_id in _sample_tried or not get_settings().SAMPLE_OUTPUT_AUTO:
        return
    _sample_tried.add(pv_id)
    with new_session() as s:
        pv = s.get(ProblemVersion, pv_id)
        if pv is None or pv.sample_output is not None:
            return
        try:
            text = asyncio.run(sample_output(pv.dir_path, pv.rules_json or {}, get_settings()))
        except Exception:  # noqa: BLE001
            return
        if text is not None:
            pv.sample_output = text
            s.add(pv)
            s.commit()


@router.get("")
def list_problems(user: UserDep, session: SessionDep):
    out = []
    for p in session.exec(select(Problem).order_by(Problem.id)).all():
        if visible(p, user) and (p.status != "archived" or is_staff(user)):
            out.append(problem_summary(session, p, user, repo.current_version(session, p)))
    return out


@router.get("/{slug}")
def get_problem(slug: str, user: UserDep, session: SessionDep):
    p = get_problem_or_404(session, slug, user)
    pv = repo.current_version(session, p)
    sample = read_sample(pv)
    if pv and pv.sample_output is None and sample:
        fill_sample_output(pv.id)
        session.refresh(pv)
    out = problem_summary(session, p, user, pv)
    out.update(statement_md=strip_title(p.statement_md, p.title), sample_input=sample,
               sample_output=pv.sample_output if pv else None, version=p.current_version,
               metrics=metric_rows(pv.rules_json if pv else None, staff=is_staff(user)),
               best_available=bool(p.show_best_after_deadline and deadline_passed(p)))
    if is_staff(user):
        out.update(rules_json=pv.rules_json if pv else None, rules_hash=pv.rules_hash if pv else None,
                   inputs_hash=pv.inputs_hash if pv else None, show_best_after_deadline=p.show_best_after_deadline,
                   reveal_hidden_tests=p.reveal_hidden_tests, integrity_penalty=p.integrity_penalty,
                   finalized_at=iso(p.finalized_at), statement_raw=p.statement_md)
    return out


@router.get("/{slug}/best")
def best_solutions(slug: str, user: UserDep, session: SessionDep):
    p = get_problem_or_404(session, slug, user)
    if not is_staff(user) and not (p.show_best_after_deadline and deadline_passed(p)):
        raise HTTPException(403, "Model solutions are shown only after the deadline, when staff enable them.")
    best = [d["best"] for d in per_user(graded_rows(session, p.id)).values() if d["best"] is not None]
    best = [b for b in best if b[0].share_as_example and not b[1].provisional]
    best.sort(key=lambda b: (-b[1].grade, b[0].created_at, b[0].id))
    out = []
    for rank, (sub, res) in enumerate(best[:3], 1):
        item = {"rank": rank, "grade": res.grade, "filename": "solution.c", "source": sub.source}
        if is_staff(user):
            u = session.get(User, sub.user_id)
            item.update(submission_id=sub.id, roll_no=u.roll_no if u else None)
        out.append(item)
    return out
