"""Leaderboard for a problem (DESIGN section 10, Ranking)."""
from __future__ import annotations

from sqlmodel import Session, select

from ..db import repo
from ..db.models import Flag, Problem, RankingProfile, Result, Submission, User
from .cparse import tokenize

FAILS_TESTS = "Fails some hidden tests"
CONFIRMED_COPY = "Confirmed copy"
UNDER_REVIEW = "Under review for possible copying"

COPY_FLAGS = ("suspected_copy_peer", "suspected_copy_web", "suspected_copy_llm", "suspected_copy",
              "possible_copy_low_confidence")


def _metric(report: dict, analyzer: str) -> dict | None:
    return next((m for m in report.get("metrics") or [] if m.get("analyzer") == analyzer), None)


def io_tests_pass(report: dict) -> bool:
    m = _metric(report, "io_tests")
    if m is None:
        return False
    ev = m.get("evidence") or {}
    if "tests_total" in ev:
        return ev.get("tests_total", 0) > 0 and ev.get("tests_passed") == ev.get("tests_total")
    return m.get("score") == 1


def _instr_from_report(report: dict) -> int | None:
    m = _metric(report, "complexity_estimator")
    if not m:
        return None
    meas = [x for x in (m.get("evidence") or {}).get("measurements") or [] if x.get("instructions") is not None]
    return int(max(meas, key=lambda x: x["n"])["instructions"]) if meas else None


def _readability_from_report(report: dict) -> float | None:
    m = _metric(report, "llm_review")
    return None if m is None or m.get("score") is None else float(m["score"])


def sort_key(row: dict) -> tuple:
    """(-effective grade, instr_at_max_n, peak_heap_bytes, -readability, token_count, submitted_at, id);
    missing values last."""
    def asc(v):
        return (v is None, v if v is not None else 0)

    def desc(v):
        return (v is None, -v if v is not None else 0)

    return (-row.get("effective_grade", row["grade"]), asc(row["instr_at_max_n"]), asc(row["peak_heap_bytes"]), desc(row["readability"]),
            asc(row["token_count"]), row["submitted_at"], row["submission_id"])


def _chosen(session: Session, problem: Problem) -> list[tuple[Submission, Result]]:
    """One graded submission per student, by the problem's grade policy."""
    rows = session.exec(select(Submission, Result).join(Result, Result.submission_id == Submission.id)
                        .where(Submission.problem_id == problem.id, Result.is_current)
                        .order_by(Submission.user_id, Submission.id)).all()
    pick: dict[int, tuple[Submission, Result]] = {}
    for sub, res in rows:
        cur = pick.get(sub.user_id)
        if cur is None:
            pick[sub.user_id] = (sub, res)
        elif problem.grade_policy == "best":
            if res.grade > cur[1].grade:
                pick[sub.user_id] = (sub, res)
        else:
            pick[sub.user_id] = (sub, res)
    return list(pick.values())


def leaderboard(session: Session, problem_id: int) -> list[dict]:
    """Ranked eligible rows first, then ineligible rows (rank None) with the reason."""
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise ValueError(f"no problem with id {problem_id}")
    chosen = _chosen(session, problem)
    ids = [s.id for s, _ in chosen]
    confirmed, open_ = set(), set()
    profiles: dict[int, RankingProfile] = {}
    if ids:
        confirmed = set(session.exec(select(Flag.submission_id).where(
            Flag.submission_id.in_(ids), Flag.review_status == "confirmed", Flag.type.in_(COPY_FLAGS))).all())
        # an unreviewed copy flag on the current result keeps the row off the podium until staff decide
        open_ = set(session.exec(select(Flag.submission_id).join(Result, Result.id == Flag.result_id).where(
            Flag.submission_id.in_(ids), Result.is_current == True, Flag.review_status == "open",
            Flag.type.in_(COPY_FLAGS))).all())
        profiles = {p.submission_id: p for p in session.exec(
            select(RankingProfile).where(RankingProfile.submission_id.in_(ids))).all()}
    users = {u.id: u for u in session.exec(select(User).where(User.id.in_([s.user_id for s, _ in chosen]))).all()}

    good, bad = [], []
    for sub, res in chosen:
        report = res.report_json or {}
        prof = profiles.get(sub.id)
        user = users.get(sub.user_id)
        row = {
            "submission_id": sub.id,
            "user_id": sub.user_id,
            "roll_no": user.roll_no if user else None,
            "name": user.name if user else None,
            "grade": float(res.grade),
            "effective_grade": repo.effective_grade(problem, sub, res, sub.id in confirmed),
            "instr_at_max_n": prof.instr_at_max_n if prof and prof.instr_at_max_n is not None
            else _instr_from_report(report),
            "peak_heap_bytes": prof.peak_heap_bytes if prof else None,
            "readability": prof.readability if prof and prof.readability is not None
            else _readability_from_report(report),
            "token_count": prof.token_count if prof and prof.token_count is not None
            else len(tokenize(sub.source)["tokens"]),
            "submitted_at": sub.created_at.isoformat(),
            "profiled": prof is not None,
        }
        if not io_tests_pass(report):
            bad.append({**row, "rank": None, "ineligible_reason": FAILS_TESTS})
        elif sub.id in confirmed:
            bad.append({**row, "rank": None, "ineligible_reason": CONFIRMED_COPY})
        elif sub.id in open_:
            bad.append({**row, "rank": None, "ineligible_reason": UNDER_REVIEW, "under_review": True})
        else:
            good.append(row)
    good.sort(key=sort_key)
    bad.sort(key=sort_key)
    return [{"rank": i, **r} for i, r in enumerate(good, 1)] + bad
