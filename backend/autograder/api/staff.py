"""Staff (TA and admin) endpoints: problems, submissions, gradebook, integrity."""
from __future__ import annotations

import asyncio
import csv
import io
import json
import re
import shutil
import statistics
import tempfile
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Annotated, Any, Literal

from anyio import to_thread
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import Session, select

from ..config import get_settings
from ..core.textfmt import number_text
from ..core.rules import validate_rules
from ..db import repo
from ..db.models import (
    PENALTIES,
    PROBLEM_STATUSES,
    Flag,
    Job,
    PlagiarismScan,
    Problem,
    ProblemVersion,
    Result,
    SimilarityPair,
    Submission,
    User,
    utcnow,
)
from .deps import ApiError, SessionDep, StaffDep, audit, iso, paging, require_staff
from .problems import (
    GRADE_KINDS,
    chosen,
    fill_sample_output,
    get_problem_or_404,
    graded_rows,
    latest_jobs,
    per_user,
)
from .submissions import ACTIVE, staff_notes

router = APIRouter(prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)])

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
NAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")
MAX_UPLOAD = 5 * 1024 * 1024
MAX_ZIP_TOTAL = 50 * 1024 * 1024
MAX_ZIP_MEMBERS = 2000
CORPUS_KINDS = ("web", "llm")


def _analyzers() -> list[str]:
    from ..core.analyzers import analyzer_names
    return analyzer_names()


# problem files

def _rel_path(root: Path, name: str) -> Path:
    parts = PurePosixPath(str(name).replace("\\", "/")).parts
    if not parts or any(p in ("..", "") or not NAME_RE.match(p) for p in parts) or str(name).startswith(("/", "\\")):
        raise HTTPException(422, f"The rules name a file that is not allowed: {name!r}.")
    return root.joinpath(*parts)


async def _read(upload: UploadFile, what: str) -> bytes:
    data = await upload.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, f"The {what} file is larger than 5 MB.")
    return data


def _extract(data: bytes, dest: Path, suffixes: tuple[str, ...], what: str) -> int:
    """Flatten matching members of a zip into dest; returns how many were written."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise HTTPException(422, f"The {what} file is not a zip archive.") from None
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) > MAX_ZIP_MEMBERS or sum(i.file_size for i in infos) > MAX_ZIP_TOTAL:
        raise HTTPException(413, f"The {what} archive is too large.")
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    n = 0
    for info in infos:
        base = PurePosixPath(info.filename.replace("\\", "/")).name
        if base.startswith(".") or "__MACOSX" in info.filename or not base.endswith(suffixes):
            continue
        if not NAME_RE.match(base):
            raise HTTPException(422, f"The {what} archive has a file name that is not allowed: {base!r}.")
        (dest / base).write_bytes(zf.read(info))
        n += 1
    return n


def _testset_dir(rules: dict) -> str:
    for m in rules.get("metrics") or []:
        if isinstance(m, dict) and m.get("analyzer") == "io_tests":
            return str((m.get("params") or {}).get("testset_dir") or "tests/")
    return "tests/"


async def _build_problem_dir(root: Path, rules: dict, *, statement_md: str | None, reference_c, sample_in,
                             tests_zip, starter_c, web_corpus_zip) -> dict:
    """Lay out an uploaded problem in the standard problem folder layout under root."""
    if reference_c is not None:
        rules.setdefault("reference_solution", "reference.c")
        _rel_path(root, rules["reference_solution"]).write_bytes(await _read(reference_c, "reference"))
    if sample_in is not None:
        rules.setdefault("sample_input", "sample.in")
        _rel_path(root, rules["sample_input"]).write_bytes(await _read(sample_in, "sample input"))
    if starter_c is not None:
        rules.setdefault("starter_code", "starter.c")
        _rel_path(root, rules["starter_code"]).write_bytes(await _read(starter_c, "starter code"))
    if tests_zip is not None:
        tdir = _rel_path(root, _testset_dir(rules).rstrip("/\\") or "tests")
        if _extract(await _read(tests_zip, "tests"), tdir, (".in", ".out"), "tests") == 0:
            raise HTTPException(422, "The tests archive has no .in or .out files.")
    if web_corpus_zip is not None:
        _extract(await _read(web_corpus_zip, "web corpus"), root / "corpus" / "web", (".c",), "web corpus")
    if statement_md is not None:
        (root / "problem.md").write_text(statement_md, "utf-8", newline="")

    ref = rules.get("reference_solution")
    if not ref or not _rel_path(root, ref).is_file():
        raise HTTPException(422, "Upload a reference solution.")
    tdir = _rel_path(root, _testset_dir(rules).rstrip("/\\") or "tests")
    if not tdir.is_dir() or not any(p.suffix == ".in" for p in tdir.iterdir()):
        raise HTTPException(422, "Upload at least one test (.in file).")
    (root / "rules.json").write_text(json.dumps(rules, indent=2, ensure_ascii=False) + "\n", "utf-8", newline="\n")
    return rules


def _parse_rules(text: str | dict) -> dict:
    if isinstance(text, dict):
        rules = text
    else:
        try:
            rules = json.loads(text)
        except ValueError as e:
            raise ApiError(422, f"The rules are not valid JSON ({e}).", errors=[f"not valid JSON: {e}"]) from None
    if not isinstance(rules, dict):
        raise ApiError(422, "The rules must be a JSON object.", errors=["rules must be a JSON object"])
    errors = validate_rules(rules, _analyzers())
    if errors:
        more = f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""
        raise ApiError(422, f"The rules have a problem: {errors[0]}{more}.", errors=errors)
    return rules


def _parse_dt(raw: str | None, what: str) -> datetime | None:
    if raw is None or not str(raw).strip():
        return None
    try:
        dt = datetime.fromisoformat(str(raw).strip())
    except ValueError:
        raise HTTPException(422, f"{what} must be a date and time like 2026-11-05T23:59.") from None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def _apply_meta(problem: Problem, fields: dict) -> None:
    """Metadata only; nothing here creates a grading version. '' or None clears the dates."""
    if fields.get("title") is not None:
        if not fields["title"].strip():
            raise HTTPException(422, "Title is required.")
        problem.title = fields["title"].strip()
    if fields.get("statement_md") is not None:
        problem.statement_md = fields["statement_md"]
    for key, what in (("due_at", "Deadline"), ("opens_at", "Opening time")):
        if key in fields:
            setattr(problem, key, _parse_dt(fields[key], what))
    checks = (("status", PROBLEM_STATUSES), ("grade_policy", ("latest", "best")), ("integrity_penalty", PENALTIES))
    for key, allowed in checks:
        if fields.get(key) is not None:
            if fields[key] not in allowed:
                label = key.replace("_", " ").capitalize()
                raise HTTPException(422, f"{label} must be one of {', '.join(allowed)}.")
            setattr(problem, key, fields[key])
    for key in ("show_best_after_deadline", "reveal_hidden_tests"):
        if fields.get(key) is not None:
            setattr(problem, key, bool(fields[key]))
    if fields.get("max_submissions_per_hour") is not None:
        if int(fields["max_submissions_per_hour"]) < 1:
            raise HTTPException(422, "Submissions per hour must be at least 1.")
        problem.max_submissions_per_hour = int(fields["max_submissions_per_hour"])


def _chosen_rows(session: Session, p: Problem, user_ids: set[int] | None = None) -> dict[int, tuple]:
    """user id -> (counted submission, result, flags, effective grade)."""
    groups = per_user(graded_rows(session, p.id))
    picks = {uid: chosen(p, d) for uid, d in groups.items() if user_ids is None or uid in user_ids}
    flags = repo.current_flags(session, [s.id for s, _ in picks.values()])
    out = {}
    for uid, (sub, res) in picks.items():
        fl = flags.get(sub.id, [])
        out[uid] = (sub, res, fl, repo.effective_grade(p, sub, res, repo.confirmed_copy(fl)))
    return out


def _problem_out(session: Session, p: Problem) -> dict:
    pv = repo.current_version(session, p)
    n_sub = session.exec(select(func.count()).select_from(Submission).where(Submission.problem_id == p.id)).one()
    rows = _chosen_rows(session, p)
    grades = [g for _, _, _, g in rows.values() if g is not None]
    open_flags = session.exec(select(func.count()).select_from(Flag).join(Result, Result.id == Flag.result_id)
                              .join(Submission, Submission.id == Flag.submission_id)
                              .where(Submission.problem_id == p.id, Result.is_current == True,
                                     Flag.review_status == "open", repo.needs_review(Flag.type))).one()
    return {"id": p.id, "slug": p.slug, "title": p.title, "status": p.status, "due_at": iso(p.due_at),
            "opens_at": iso(p.opens_at), "finalized_at": iso(p.finalized_at), "version": p.current_version,
            "n_submissions": n_sub, "n_students": len(rows),
            "avg_grade": round(sum(grades) / len(grades), 1) if grades else None, "open_flags": open_flags,
            "grade_policy": p.grade_policy, "show_best_after_deadline": p.show_best_after_deadline,
            "reveal_hidden_tests": p.reveal_hidden_tests, "max_submissions_per_hour": p.max_submissions_per_hour,
            "integrity_penalty": p.integrity_penalty,
            "rules_hash": pv.rules_hash if pv else None, "inputs_hash": pv.inputs_hash if pv else None}


# problems

@router.get("/problems")
def list_problems(session: SessionDep):
    return [_problem_out(session, p) for p in session.exec(select(Problem).order_by(Problem.id)).all()]


@router.post("/problems", status_code=201)
async def create_problem(
    user: StaffDep,
    session: SessionDep,
    slug: Annotated[str, Form()],
    rules_json: Annotated[str, Form()],
    reference_c: Annotated[UploadFile, File()],
    tests_zip: Annotated[UploadFile, File()],
    title: str = Form(""),
    statement_md: str = Form(""),
    sample_in: Annotated[UploadFile | None, File()] = None,
    starter_c: Annotated[UploadFile | None, File()] = None,
    web_corpus_zip: Annotated[UploadFile | None, File()] = None,
    status: str = Form("draft"),
    due_at: str | None = Form(None),
    opens_at: str | None = Form(None),
    grade_policy: str | None = Form(None),
    show_best_after_deadline: bool | None = Form(None),
    reveal_hidden_tests: bool | None = Form(None),
    max_submissions_per_hour: int | None = Form(None),
    integrity_penalty: str | None = Form(None),
):
    slug = slug.strip()
    if not SLUG_RE.match(slug):
        raise HTTPException(422, "The short name may only use a-z, 0-9, _ and -, starting with a letter or digit.")
    if repo.get_problem_by_slug(session, slug):
        raise HTTPException(409, f"A problem called {slug} already exists.")
    rules = _parse_rules(rules_json)
    with tempfile.TemporaryDirectory(prefix="ag-problem-") as tmp:
        await _build_problem_dir(Path(tmp), rules, statement_md=statement_md, reference_c=reference_c,
                                 sample_in=sample_in, tests_zip=tests_zip, starter_c=starter_c,
                                 web_corpus_zip=web_corpus_zip)
        problem, pv = repo.create_problem_from_dir(session, slug, title.strip() or None, tmp)
    meta = {"status": status, "grade_policy": grade_policy, "show_best_after_deadline": show_best_after_deadline,
            "reveal_hidden_tests": reveal_hidden_tests, "max_submissions_per_hour": max_submissions_per_hour,
            "integrity_penalty": integrity_penalty, "due_at": due_at, "opens_at": opens_at}
    _apply_meta(problem, meta)
    session.add(problem)
    audit(session, user, "problem.create", slug, version=pv.version, rules_hash=pv.rules_hash, status=problem.status)
    session.commit()
    await to_thread.run_sync(fill_sample_output, pv.id)
    return _problem_out(session, problem)


class MetaIn(BaseModel):
    title: str | None = Field(None, max_length=200)
    statement_md: str | None = Field(None, max_length=200_000)
    due_at: str | None = None
    opens_at: str | None = None
    status: Literal["draft", "published", "archived"] | None = None
    grade_policy: Literal["latest", "best"] | None = None
    reveal_hidden_tests: bool | None = None
    show_best_after_deadline: bool | None = None
    max_submissions_per_hour: int | None = Field(None, ge=1, le=1000)
    integrity_penalty: Literal["none", "zero", "half"] | None = None


@router.patch("/problems/{slug}/meta")
def patch_meta(slug: str, body: MetaIn, user: StaffDep, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    fields = body.model_dump(exclude_unset=True)
    _apply_meta(problem, fields)
    session.add(problem)
    audit(session, user, "problem.meta", slug, **{k: v for k, v in fields.items() if k != "statement_md"},
          statement_changed="statement_md" in fields)
    session.commit()
    session.refresh(problem)
    return _problem_out(session, problem)


@router.put("/problems/{slug}")
async def update_problem(
    slug: str,
    user: StaffDep,
    session: SessionDep,
    title: str | None = Form(None),
    statement_md: str | None = Form(None),
    rules_json: str | None = Form(None),
    reference_c: Annotated[UploadFile | None, File()] = None,
    sample_in: Annotated[UploadFile | None, File()] = None,
    tests_zip: Annotated[UploadFile | None, File()] = None,
    starter_c: Annotated[UploadFile | None, File()] = None,
    web_corpus_zip: Annotated[UploadFile | None, File()] = None,
    due_at: str | None = Form(None),
    grade_policy: str | None = Form(None),
    show_best_after_deadline: bool | None = Form(None),
    reveal_hidden_tests: bool | None = Form(None),
    max_submissions_per_hour: int | None = Form(None),
):
    """Grading changes (rules, reference, tests, sample, starter, web corpus) make a new version.
    The statement and the other fields are metadata and never do."""
    problem = get_problem_or_404(session, slug)
    grading = [rules_json, reference_c, sample_in, tests_zip, starter_c, web_corpus_zip]
    new_version = None
    if any(x is not None for x in grading):
        pv = repo.current_version(session, problem)
        if pv is None:
            raise HTTPException(409, "This problem has no current version.")
        rules = _parse_rules(rules_json) if rules_json is not None else dict(pv.rules_json or {})
        with tempfile.TemporaryDirectory(prefix="ag-problem-") as tmp:
            root = Path(tmp) / "p"
            shutil.copytree(pv.dir_path, root)
            await _build_problem_dir(root, rules, statement_md=None, reference_c=reference_c,
                                     sample_in=sample_in, tests_zip=tests_zip, starter_c=starter_c,
                                     web_corpus_zip=web_corpus_zip)
            statement = problem.statement_md
            new_version = repo.new_version(session, problem, root)
            problem.statement_md = statement
    meta = {"title": title, "statement_md": statement_md, "grade_policy": grade_policy,
            "show_best_after_deadline": show_best_after_deadline, "reveal_hidden_tests": reveal_hidden_tests,
            "max_submissions_per_hour": max_submissions_per_hour}
    if due_at is not None:
        meta["due_at"] = due_at
    _apply_meta(problem, meta)
    session.add(problem)
    audit(session, user, "problem.update", slug, version=new_version.version if new_version else None)
    session.commit()
    if new_version is not None:
        await to_thread.run_sync(fill_sample_output, new_version.id)
    session.refresh(problem)
    return _problem_out(session, problem)


@router.get("/problems/{slug}/versions")
def versions(slug: str, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    counts = dict(session.exec(select(Submission.problem_version_id, func.count())
                               .where(Submission.problem_id == problem.id)
                               .group_by(Submission.problem_version_id)).all())
    rows = session.exec(select(ProblemVersion).where(ProblemVersion.problem_id == problem.id)
                        .order_by(ProblemVersion.version.desc())).all()
    return [{"version": v.version, "created_at": iso(v.created_at), "rules_hash": v.rules_hash,
             "inputs_hash": v.inputs_hash, "n_submissions": counts.get(v.id, 0),
             "current": v.version == problem.current_version} for v in rows]


@router.post("/problems/{slug}/validate")
async def validate_problem(slug: str, user: StaffDep, session: SessionDep):
    from ..core.problemcheck import check_problem

    problem = get_problem_or_404(session, slug)
    pv = repo.current_version(session, problem)
    if pv is None:
        raise HTTPException(409, "This problem has no current version.")
    rules, root = dict(pv.rules_json or {}), pv.dir_path
    # a fresh event loop in a thread: uvicorn's loop on Windows cannot start subprocesses
    try:
        out = await to_thread.run_sync(lambda: asyncio.run(check_problem(root, rules, get_settings())))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"The sandbox is not available, so the problem could not be checked ({e}).") \
            from None
    if out.get("sample_output") is not None and pv.sample_output != out["sample_output"]:
        pv.sample_output = out["sample_output"]
        session.add(pv)
    audit(session, user, "problem.validate", slug, ok=out["ok"], version=pv.version)
    session.commit()
    return {k: out[k] for k in ("ok", "rules_errors", "compile", "tests")}


@router.post("/problems/{slug}/finalize")
def finalize(slug: str, user: StaffDep, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    rows = graded_rows(session, problem.id)
    groups = per_user(rows)
    frozen = sorted(d["latest"][0].id for d in groups.values())
    if problem.grade_policy == "best":
        # the best one can change once everything is regraded, so regrade every graded submission
        picks = [sub for sub, res in rows if res is not None]
        picks += [d["latest"][0] for d in groups.values() if d["best"] is None]
    else:
        picks = [chosen(problem, d)[0] for d in groups.values()]
    busy = _busy(session, [s.id for s in picks])
    if busy:
        raise HTTPException(409, f"{len(busy)} submission(s) are still being graded. Finalize when the queue is "
                                 "empty.")
    pv = repo.current_version(session, problem)
    jobs = [repo.enqueue_job(session, "regrade", 10, submission_id=s.id, problem_id=problem.id,
                             payload={"finalize": True, "frozen_peer_ids": frozen, "force": True,
                                      "problem_version_id": pv.id if pv else None}, commit=False)
            for s in picks]
    problem.finalized_at = utcnow()
    session.add(problem)
    audit(session, user, "problem.finalize", slug, n=len(jobs), frozen_peer_ids=frozen)
    session.commit()
    return {"job_ids": [j.id for j in jobs], "frozen_peer_ids": frozen, "finalized_at": iso(problem.finalized_at)}


@router.delete("/problems/{slug}/finalize")
def reopen(slug: str, user: StaffDep, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    problem.finalized_at = None
    session.add(problem)
    audit(session, user, "problem.reopen", slug)
    session.commit()
    return _problem_out(session, problem)


def _corpus_dir(session: Session, problem: Problem, kind: str) -> Path:
    if kind not in CORPUS_KINDS:
        raise HTTPException(404, "The corpus kind must be web or llm.")
    pv = repo.current_version(session, problem)
    if pv is None:
        raise HTTPException(409, "This problem has no current version.")
    return Path(pv.dir_path) / "corpus" / kind


@router.get("/problems/{slug}/corpus")
def corpus(slug: str, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    out = []
    for kind in CORPUS_KINDS:
        d = _corpus_dir(session, problem, kind)
        for f in sorted(d.glob("*.c")) if d.is_dir() else []:
            text = f.read_bytes().decode("utf-8", errors="replace")
            out.append({"file": f.name, "kind": kind, "size": f.stat().st_size,
                        "preview": "\n".join(text.splitlines()[:30])})
    return out


@router.delete("/problems/{slug}/corpus/{kind}/{file}")
def delete_corpus_file(slug: str, kind: str, file: str, user: StaffDep, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    if not NAME_RE.match(file) or not file.endswith(".c"):
        raise HTTPException(422, "That file name is not allowed.")
    path = _corpus_dir(session, problem, kind) / file
    if not path.is_file():
        raise HTTPException(404, "Corpus file not found.")
    path.unlink()
    audit(session, user, "corpus.delete", slug, kind=kind, file=file)
    session.commit()
    return {"ok": True}


class WebCorpusIn(BaseModel):
    urls: list[str] = []
    query: str | None = None


@router.post("/problems/{slug}/web-corpus")
async def build_web_corpus(slug: str, body: WebCorpusIn, user: StaffDep, session: SessionDep):
    """Save known web solutions for copy detection. Only the query and page downloads leave the server."""
    from ..core.webcorpus import build

    problem = get_problem_or_404(session, slug)
    urls = [u.strip() for u in body.urls if u.strip()]
    if any(not u.startswith(("http://", "https://")) for u in urls):
        raise HTTPException(422, "Each URL must start with http:// or https://.")
    query = (body.query or "").strip() or None
    if not urls and not query:
        raise HTTPException(422, "Give at least one page URL or a search query.")
    if len(urls) > 20:
        raise HTTPException(422, "Give at most 20 URLs at a time.")
    root = _corpus_dir(session, problem, "web").parent.parent
    try:
        out = await to_thread.run_sync(lambda: asyncio.run(build(root, urls=urls, query=query,
                                                                   settings=get_settings())))
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, f"Could not build the web corpus ({e}).") from None
    audit(session, user, "corpus.web_build", slug, urls=len(urls), query=query, kept=len(out["kept"]))
    session.commit()
    return out


class RulesIn(BaseModel):
    rules: Any


@router.post("/rules/validate")
def validate(body: RulesIn):
    rules = body.rules
    if isinstance(rules, str):
        try:
            rules = json.loads(rules)
        except ValueError as e:
            return {"errors": [f"not valid JSON: {e}"]}
    return {"errors": validate_rules(rules, _analyzers())}


# submissions and grading

def _flag_out(f: Flag) -> dict:
    return {"id": f.id, "type": f.type, "detail": f.detail, "severity": f.severity,
            "review_status": f.review_status, "review_note": f.review_note, "reviewed_by": f.reviewed_by,
            "submission_id": f.submission_id, "result_id": f.result_id, "source": f.source,
            **repo.flag_fields(f)}


def _flag_brief(f: Flag) -> dict:
    return {"id": f.id, "type": f.type, "review_status": f.review_status}


SORTS = {"-created": "-created", "created": "created", "grade": "grade", "-grade": "-grade"}


def _until(raw: str | None) -> datetime | None:
    """`until` is inclusive: a bare date means the end of that day."""
    dt = _parse_dt(raw, "Until")
    if dt is not None and len(raw.strip()) == 10:
        dt += timedelta(days=1)
    return dt


def submission_rows(session: Session, *, problem: str | None = None, q: str | None = None, flag: str | None = None,
                    user: str | None = None, sort: str = "-created", page: int = 1, page_size: int = 50,
                    since: str | None = None, until: str | None = None) -> tuple[list[dict], int]:
    stmt = (select(Submission, User, Problem, Result)
            .join(User, User.id == Submission.user_id)
            .join(Problem, Problem.id == Submission.problem_id)
            .join(Result, (Result.submission_id == Submission.id) & (Result.is_current == True), isouter=True))
    if problem:
        stmt = stmt.where(Problem.slug == problem)
    if since:
        stmt = stmt.where(Submission.created_at >= _parse_dt(since, "Since"))
    if until:
        stmt = stmt.where(Submission.created_at < _until(until))
    if user:
        stmt = stmt.where(func.upper(User.roll_no) == repo.normalize_roll(user))
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(User.roll_no).like(like), func.lower(User.name).like(like)))
    if flag:
        flagged = select(Flag.submission_id).join(Result, Result.id == Flag.result_id).where(Result.is_current == True)
        if flag == "open":
            flagged = flagged.where(Flag.review_status == "open", repo.needs_review(Flag.type))
        elif flag == "any":
            flagged = flagged.where(Flag.review_status != "dismissed")
        else:
            flagged = flagged.where(Flag.type == flag, Flag.review_status != "dismissed")
        stmt = stmt.where(Submission.id.in_(flagged))
    total = session.exec(select(func.count()).select_from(stmt.subquery())).one()
    order = {"-created": [Submission.id.desc()], "created": [Submission.id],
             "grade": [Result.grade.is_(None), Result.grade, Submission.id.desc()],
             "-grade": [Result.grade.is_(None), Result.grade.desc(), Submission.id.desc()]}[SORTS.get(sort, "-created")]
    offset, limit = paging(page, page_size, 5000)
    rows = session.exec(stmt.order_by(*order).offset(offset).limit(limit)).all()
    ids = [s.id for s, *_ in rows]
    flags = repo.current_flags(session, ids)
    jobs = latest_jobs(session, ids)
    items = []
    for sub, u, p, res in rows:
        fl = flags.get(sub.id, [])
        job = jobs.get(sub.id)
        items.append({
            "id": sub.id, "user_id": u.id, "roll_no": u.roll_no, "name": u.name, "problem_slug": p.slug,
            "problem_title": p.title, "filename": sub.filename, "created_at": iso(sub.created_at),
            "grade": res.grade if res else None,
            "effective_grade": repo.effective_grade(p, sub, res, repo.confirmed_copy(fl)),
            "provisional": res.provisional if res else None, "partial": res.partial if res else None,
            "flags": [_flag_brief(f) for f in fl],
            "job_status": job.status if job else None,
            "job": {"id": job.id, "kind": job.kind, "status": job.status} if job else None,
            "is_late": sub.is_late, "overridden": sub.override_grade is not None,
        })
    return items, total


@router.get("/submissions")
def staff_submissions(session: SessionDep, problem: str | None = None, q: str | None = None,
                      flag: str | None = None, user: str | None = None, sort: str = "-created", page: int = 1,
                      page_size: int = 50, since: str | None = None, until: str | None = None):
    items, total = submission_rows(session, problem=problem, q=q, flag=flag, user=user, sort=sort, page=page,
                                   page_size=page_size, since=since, until=until)
    return {"items": items, "total": total}


@router.get("/submissions/{sub_id}/flags")
def submission_flags(sub_id: int, session: SessionDep):
    if session.get(Submission, sub_id) is None:
        raise HTTPException(404, "Submission not found.")
    return [_flag_out(f) for f in repo.current_flags(session, [sub_id]).get(sub_id, [])]


class SubmissionPatch(BaseModel):
    override_grade: float | None = Field(None, ge=0, le=100)
    override_reason: str | None = Field(None, max_length=2000)
    comment: str | None = Field(None, max_length=5000)


@router.patch("/submissions/{sub_id}")
def patch_submission(sub_id: int, body: SubmissionPatch, user: StaffDep, session: SessionDep):
    sub = session.get(Submission, sub_id)
    if sub is None:
        raise HTTPException(404, "Submission not found.")
    given = body.model_fields_set
    now = utcnow()
    if "override_grade" in given:
        setting = body.override_grade is not None
        reason = (body.override_reason or "").strip()
        if setting and not reason:
            raise HTTPException(422, "Give a reason for the grade override.")
        sub.override_grade = body.override_grade
        sub.override_reason = reason if setting else None
        sub.override_by = user.id if setting else None
        sub.override_at = now if setting else None
    elif "override_reason" in given and sub.override_grade is not None:
        sub.override_reason = (body.override_reason or "").strip() or None
    if "comment" in given:
        text = (body.comment or "").strip()
        sub.staff_comment = text or None
        sub.comment_by = user.id if text else None
        sub.comment_at = now if text else None
    session.add(sub)
    audit(session, user, "submission.update", str(sub_id), **body.model_dump(exclude_unset=True))
    session.commit()
    session.refresh(sub)
    return {"id": sub.id, **staff_notes(session, sub)}


def _busy(session: Session, sub_ids: list[int]) -> set[int]:
    """Submissions with a grade or regrade job still queued or running (enrich/profile do not count)."""
    if not sub_ids:
        return set()
    return set(session.exec(select(Job.submission_id).where(Job.submission_id.in_(sub_ids),
                                                            Job.kind.in_(GRADE_KINDS),
                                                            Job.status.in_(ACTIVE))).all())


def _version_ids(session: Session, subs: list[Submission]) -> dict[int, int | None]:
    out: dict[int, int | None] = {}
    for pid in {s.problem_id for s in subs}:
        pv = repo.current_version(session, session.get(Problem, pid))
        out[pid] = pv.id if pv else None
    return out


class RegradeIn(BaseModel):
    submission_ids: list[int] | None = None
    problem_slug: str | None = None


@router.post("/regrade")
def regrade(body: RegradeIn, user: StaffDep, session: SessionDep):
    if body.submission_ids:
        subs = list(session.exec(select(Submission).where(Submission.id.in_(body.submission_ids))).all())
    elif body.problem_slug:
        subs = repo.latest_submissions_per_user(session, get_problem_or_404(session, body.problem_slug).id)
    else:
        raise HTTPException(422, "Choose the submissions or the problem to regrade.")
    busy = _busy(session, [s.id for s in subs])
    versions = _version_ids(session, subs)
    jobs = [repo.enqueue_job(session, "regrade", 10, submission_id=s.id, problem_id=s.problem_id,
                             payload={"requested_by": user.id, "force": True,
                                      "problem_version_id": versions[s.problem_id]}, commit=False)
            for s in subs if s.id not in busy]
    audit(session, user, "regrade", body.problem_slug, submission_ids=[s.id for s in subs])
    session.commit()
    return {"job_ids": [j.id for j in jobs], "skipped_busy": sorted(busy)}


# gradebook

def _students(session: Session, include_inactive: bool) -> list[User]:
    stmt = select(User).where(User.role == "student")
    if not include_inactive:
        stmt = stmt.where(User.is_active == True)
    return list(session.exec(stmt.order_by(User.roll_no)).all())


def _stats(grades: list[float]) -> dict:
    hist = [0] * 10
    for g in grades:
        hist[min(9, max(0, int(g // 10)))] += 1
    return {"n": len(grades), "mean": round(statistics.fmean(grades), 1) if grades else None,
            "median": round(statistics.median(grades), 1) if grades else None, "histogram": hist}


@router.get("/gradebook")
def gradebook_json(session: SessionDep, include_inactive: bool = False):
    problems = list(session.exec(select(Problem).where(Problem.status == "published").order_by(Problem.id)).all())
    students = _students(session, include_inactive)
    ids = {u.id for u in students}
    picks = {p.slug: _chosen_rows(session, p, ids) for p in problems}
    rows = []
    for u in students:
        cells, total = {}, 0.0
        for p in problems:
            hit = picks[p.slug].get(u.id)
            if hit is None:
                cells[p.slug] = None
                continue
            sub, res, fl, eff = hit
            cells[p.slug] = {"grade": res.grade if res else None, "effective_grade": eff, "submission_id": sub.id,
                             "provisional": res.provisional if res else None, "late": sub.is_late,
                             "flags": [_flag_brief(f) for f in fl]}
            total += eff or 0
        rows.append({"id": u.id, "roll_no": u.roll_no, "name": u.name, "is_active": u.is_active, "cells": cells,
                     "total": round(total / len(problems), 1) if problems else None})
    stats = {p.slug: _stats([c["effective_grade"] for r in rows if (c := r["cells"][p.slug])
                             and c["effective_grade"] is not None]) for p in problems}
    return {"problems": [{"slug": p.slug, "title": p.title} for p in problems], "students": rows, "stats": stats}


@router.get("/gradebook.csv")
def gradebook(session: SessionDep, problem: str | None = None, include_inactive: bool = False):
    problems = [get_problem_or_404(session, problem)] if problem else \
        list(session.exec(select(Problem).order_by(Problem.id)).all())
    students = _students(session, include_inactive)
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["roll_no", "name", "problem", "grade", "submission_id", "submitted_at", "is_late", "partial",
                "provisional", "n_submissions", "flags", "effective_grade"])
    for p in problems:
        groups = per_user(graded_rows(session, p.id))
        picks = _chosen_rows(session, p)
        for u in students:
            d = groups.get(u.id)
            if d is None:
                w.writerow([u.roll_no, u.name, p.slug, "", "", "", "", "", "", 0, "", ""])
                continue
            sub, res, fl, eff = picks[u.id]
            flags = ";".join(dict.fromkeys(f.type for f in fl if f.review_status != "dismissed"))
            w.writerow([u.roll_no, u.name, p.slug, "" if res is None else number_text(res.grade), sub.id,
                        iso(sub.created_at), int(sub.is_late), "" if res is None else int(res.partial),
                        "" if res is None else int(res.provisional), d["count"], flags,
                        "" if eff is None else number_text(eff)])
    name = f"gradebook_{problem or 'all'}.csv"
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# plagiarism

class ScanIn(BaseModel):
    threshold: float = Field(0.85, ge=0.0, le=1.0)
    background: bool = False


@router.post("/problems/{slug}/plagiarism-scan")
def plagiarism_scan(slug: str, user: StaffDep, session: SessionDep, body: ScanIn | None = None):
    body = body or ScanIn()
    problem = get_problem_or_404(session, slug)
    if body.background:
        job = repo.enqueue_job(session, "plagiarism_scan", problem_id=problem.id,
                               payload={"threshold": body.threshold, "requested_by": user.id})
        return {"job_id": job.id, "scan_id": None}
    from ..core.plagiarism.pairwise import run_scan
    scan_id = run_scan(session, problem.id, body.threshold)
    audit(session, user, "plagiarism.scan", slug, scan_id=scan_id, threshold=body.threshold)
    session.commit()
    return {"scan_id": scan_id, "job_id": None}


def _ref_labels(session: Session, refs: set[str]) -> dict[str, dict]:
    labels = {}
    ids = {}
    for ref in refs:
        kind, _, rest = ref.partition(":")
        if kind == "sub" and rest.isdigit():
            ids[int(rest)] = ref
        else:
            labels[ref] = {"kind": kind, "label": rest or ref}
    if ids:
        for sub, u in session.exec(select(Submission, User).join(User, User.id == Submission.user_id)
                                   .where(Submission.id.in_(list(ids)))).all():
            labels[ids[sub.id]] = {"kind": "sub", "label": f"{u.roll_no} ({sub.filename})", "submission_id": sub.id,
                                   "roll_no": u.roll_no, "name": u.name}
    return labels


@router.get("/problems/{slug}/plagiarism/scans")
def plagiarism_scans(slug: str, session: SessionDep):
    problem = get_problem_or_404(session, slug)
    scans = session.exec(select(PlagiarismScan).where(PlagiarismScan.problem_id == problem.id)
                         .order_by(PlagiarismScan.id.desc())).all()
    counts = dict(session.exec(select(SimilarityPair.scan_id, func.count())
                               .where(SimilarityPair.scan_id.in_([s.id for s in scans]))
                               .group_by(SimilarityPair.scan_id)).all()) if scans else {}
    return [{"id": s.id, "created_at": iso(s.created_at), "threshold": s.threshold, "n_submissions": s.n_submissions,
             "n_pairs": counts.get(s.id, 0)} for s in scans]


@router.get("/problems/{slug}/plagiarism")
def plagiarism(slug: str, session: SessionDep, min: float = 0.5, scan: int | None = None):
    problem = get_problem_or_404(session, slug)
    stmt = select(PlagiarismScan).where(PlagiarismScan.problem_id == problem.id)
    if scan is not None:
        stmt = stmt.where(PlagiarismScan.id == scan)
    sc = session.exec(stmt.order_by(PlagiarismScan.id.desc())).first()
    if sc is None:
        if scan is not None:
            raise HTTPException(404, "Scan not found.")
        return {"scan": None, "pairs": [], "labels": {}}
    pairs = session.exec(select(SimilarityPair).where(SimilarityPair.scan_id == sc.id, SimilarityPair.sim >= min)
                         .order_by(SimilarityPair.sim.desc(), SimilarityPair.id)).all()
    refs = {p.a_ref for p in pairs} | {p.b_ref for p in pairs}
    for cl in sc.clusters_json or []:
        members = cl.get("members") if isinstance(cl, dict) else cl
        refs.update(m for m in members or [] if isinstance(m, str))
    return {
        "scan": {"id": sc.id, "created_at": iso(sc.created_at), "threshold": sc.threshold, "params": sc.params,
                 "n_submissions": sc.n_submissions, "clusters": sc.clusters_json or []},
        "pairs": [{"a": p.a_ref, "b": p.b_ref, "sim": p.sim, "ast_sim": p.ast_sim, "shared": p.shared}
                  for p in pairs],
        "labels": _ref_labels(session, refs),
    }


@router.get("/plagiarism/pair")
def plagiarism_pair(scan: int, a: str, b: str, session: SessionDep):
    from ..core.plagiarism.regions import pair_detail
    if session.get(PlagiarismScan, scan) is None:
        raise HTTPException(404, "Scan not found.")
    try:
        detail = pair_detail(session, scan, a, b)
    except (KeyError, LookupError, ValueError):
        detail = None
    if detail is None:
        raise HTTPException(404, "This pair is not part of the scan.")
    detail.setdefault("labels", _ref_labels(session, {a, b}))
    return detail


Review = Literal["open", "dismissed", "confirmed"]


class FlagPatch(BaseModel):
    review_status: Review
    review_note: str | None = Field(None, max_length=2000)


def _review(session: Session, user: User, f: Flag, status: str, note: str | None) -> Flag:
    was_dismissed = f.review_status == "dismissed"
    f.review_status = status
    f.review_note = note
    f.reviewed_by = user.id
    session.add(f)
    audit(session, user, "flag.review", str(f.id), review_status=status, type=f.type)
    session.commit()
    session.refresh(f)
    res = session.get(Result, f.result_id)
    if (f.type.startswith(repo.COPY_FLAG_PREFIX) and res is not None and res.is_current
            and was_dismissed != (status == "dismissed")):
        # dismissing a copy flag gives the originality points back (and re-opening removes them)
        new = repo.store_result(session, res.submission_id, None, dict(res.report_json or {}), res.report_txt or "",
                                enrichment=res.enrichment_json)
        f = session.exec(select(Flag).where(Flag.result_id == new.id, Flag.type == f.type,
                                            Flag.detail == f.detail)).first() or f
    return f


@router.patch("/flags/{flag_id}")
def review_flag(flag_id: int, body: FlagPatch, user: StaffDep, session: SessionDep):
    f = session.get(Flag, flag_id)
    if f is None:
        raise HTTPException(404, "Flag not found.")
    return _flag_out(_review(session, user, f, body.review_status, body.review_note))


class PairFlagIn(BaseModel):
    scan: int
    a: str = Field(min_length=1, max_length=300)
    b: str = Field(min_length=1, max_length=300)
    review_status: Review = "confirmed"
    review_note: str | None = Field(None, max_length=2000)


@router.post("/plagiarism/pair/flag")
def flag_pair(body: PairFlagIn, user: StaffDep, session: SessionDep):
    """Raise (or update) a copy flag on each submission of a scanned pair, e.g. to confirm a pair the
    grader did not flag. Staff-raised flags survive regrades."""
    pair = session.exec(select(SimilarityPair).where(
        SimilarityPair.scan_id == body.scan,
        or_((SimilarityPair.a_ref == body.a) & (SimilarityPair.b_ref == body.b),
            (SimilarityPair.a_ref == body.b) & (SimilarityPair.b_ref == body.a)))).first()
    if pair is None:
        raise HTTPException(404, "This pair is not part of the scan.")
    out = []
    for ref, other in ((pair.a_ref, pair.b_ref), (pair.b_ref, pair.a_ref)):
        kind, _, rest = ref.partition(":")
        if kind != "sub" or not rest.isdigit():
            continue
        sid = int(rest)
        res = repo.current_result(session, sid)
        if res is None:
            continue
        okind = other.partition(":")[0]
        ftype = f"suspected_copy_{'peer' if okind in ('sub', 'peer') else okind}"
        detail = f"{number_text(round(pair.sim, 2))} similarity with {other}"
        f = session.exec(select(Flag).where(Flag.result_id == res.id, Flag.type == ftype,
                                            Flag.detail == detail)).first()
        if f is None:
            f = Flag(result_id=res.id, submission_id=sid, type=ftype, detail=detail, severity="high", source="staff")
            session.add(f)
            session.flush()
            audit(session, user, "flag.raise", str(f.id), scan=body.scan, a=pair.a_ref, b=pair.b_ref)
        out.append(_flag_out(_review(session, user, f, body.review_status, body.review_note)))
    if not out:
        raise HTTPException(409, "Neither side of this pair is a graded submission.")
    return {"flags": out}


class BulkFlags(BaseModel):
    flag_ids: list[int] = Field(min_length=1, max_length=1000)
    review_status: Review
    review_note: str | None = Field(None, max_length=2000)


@router.post("/flags/bulk")
def review_flags(body: BulkFlags, user: StaffDep, session: SessionDep):
    flags = session.exec(select(Flag).where(Flag.id.in_(body.flag_ids)).order_by(Flag.id)).all()
    if not flags:
        raise HTTPException(404, "None of these flags exist.")
    out = [_flag_out(_review(session, user, f, body.review_status, body.review_note)) for f in flags]
    return {"updated": len(out), "flags": out}


@router.get("/problems/{slug}/leaderboard")
def leaderboard(slug: str, session: SessionDep):
    from ..core.ranking import leaderboard as rank
    return rank(session, get_problem_or_404(session, slug).id)


class CorpusIn(BaseModel):
    models: list[str] | None = None
    prompts: list[int] | None = None
    temps: list[float] | None = None
    seeds: list[int] | None = None


@router.post("/problems/{slug}/llm-corpus")
def llm_corpus(slug: str, user: StaffDep, session: SessionDep, body: CorpusIn | None = None):
    problem = get_problem_or_404(session, slug)
    payload = (body or CorpusIn()).model_dump(exclude_none=True)
    job = repo.enqueue_job(session, "corpus_gen", problem_id=problem.id, payload=payload, commit=False)
    audit(session, user, "corpus.generate", slug, **payload)
    session.commit()
    return {"job_id": job.id}
