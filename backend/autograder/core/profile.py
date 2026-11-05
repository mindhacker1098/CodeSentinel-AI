"""Tie-break profile for the leaderboard: callgrind instructions and massif peak heap at the largest size."""
from __future__ import annotations

import re
from pathlib import Path

from .analyzers.common import compile
from .analyzers.complexity_estimator import or_default
from .analyzers.llm_review import heuristic_readability
from .cparse import tokenize
from .sandbox.select import sandbox_ctx
from .testgen import get_generator
from .problemcheck import tests_dir

DEFAULT_SIZES = [100, 200, 400, 800]
_COLLECTED = re.compile(r"Collected\s*:\s*(\d+)", re.ASCII)
_HEAP = re.compile(r"^mem_heap_B=(\d+)", re.ASCII | re.MULTILINE)


def largest_size(rules: dict) -> int:
    m = next((m for m in rules.get("metrics") or [] if m.get("analyzer") == "complexity_estimator"), None)
    sizes = or_default((m or {}).get("params", {}).get("sizes"), DEFAULT_SIZES)
    return max(sizes)


def peak_heap(massif_out: str) -> int | None:
    vals = [int(v) for v in _HEAP.findall(massif_out)]
    return max(vals) if vals else None


def static_profile(source: str) -> dict:
    """The parts that need no sandbox."""
    return {"token_count": len(tokenize(source)["tokens"]),
            "readability": heuristic_readability(source)["score"] / 10}


def profiling_input(problem_dir: Path, rules: dict) -> tuple[str, int, str]:
    if rules.get("input_spec"):
        gen = get_generator(rules["input_spec"])
        n = largest_size(rules)
        if not any(m.get("analyzer") == "complexity_estimator" for m in rules.get("metrics", [])):
            n = min(n, getattr(gen, "valid_max_n", getattr(gen, "max_n", n)))
            n = max(n, getattr(gen, "min_n", 1))
        text = gen.of_size(n)
        if not gen.validate(text):
            raise ValueError("Invalid ranking input: fix the input specification or profiling sizes")
        return text, n, "configured generator"
    files = sorted(tests_dir(problem_dir, rules).glob("*.in"))
    sample = problem_dir / (rules.get("sample_input") or "sample.in")
    if not files and sample.is_file():
        files = [sample]
    if not files:
        raise ValueError("Profiling needs an uploaded test or sample input")
    selected = max(files, key=lambda path: path.stat().st_size)
    text = selected.read_text(encoding="utf-8")
    return text, len(text.encode("utf-8")), "largest uploaded test (size in bytes)"


async def profile_submission(problem_dir: str | Path, rules: dict, source: str, settings=None, log=None) -> dict:
    """{n, instr_at_max_n, peak_heap_bytes, token_count, readability, error}; valgrind counts are deterministic."""
    out = {"n": largest_size(rules), "instr_at_max_n": None, "peak_heap_bytes": None,
           **static_profile(source), "error": None}
    limits = {"time_limit_s": rules.get("time_limit_s", 1), "memory_limit_mb": rules.get("memory_limit_mb", 64)}
    text, out["n"], out["input_basis"] = profiling_input(Path(problem_dir), rules)
    data = text.encode("utf-8")
    timeout = max(30, float(limits["time_limit_s"]) * 40)
    async with sandbox_ctx(settings, limits, log) as sb:
        c = await compile(sb, source, "prof", "-O2 -g -std=c11")
        if not c.ok:
            out["error"] = "compile failed"
            return out
        if (await sb.sh("valgrind --version", timeout_s=10)).code != 0:
            out["error"] = "valgrind not available"
            return out
        r = await sb.sh("valgrind --tool=callgrind --callgrind-out-file=cg.out ./prof > /dev/null",
                        input=data, timeout_s=timeout)
        m = _COLLECTED.search(r.err)
        if r.status == "ok" and m:
            out["instr_at_max_n"] = int(m.group(1))
        else:
            out["error"] = f"callgrind run {r.status}"
        r = await sb.sh("valgrind --tool=massif --time-unit=i --massif-out-file=ms.out ./prof > /dev/null"
                        " && cat ms.out", input=data, timeout_s=timeout)
        if r.status == "ok":
            out["peak_heap_bytes"] = peak_heap(r.out) or 0
        else:
            out["error"] = out["error"] or f"massif run {r.status}"
    return out


def store_profile(session, submission_id: int, prof: dict):
    """Insert or replace the ranking_profile row of a submission."""
    from ..db.models import RankingProfile, utcnow

    row = session.get(RankingProfile, submission_id) or RankingProfile(submission_id=submission_id)
    row.instr_at_max_n = prof.get("instr_at_max_n")
    row.peak_heap_bytes = prof.get("peak_heap_bytes")
    row.token_count = prof.get("token_count")
    row.readability = prof.get("readability")
    row.computed_at = utcnow()
    session.add(row)
    session.commit()
    return row
