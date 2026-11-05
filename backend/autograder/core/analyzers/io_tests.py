"""io_tests: run the hidden test set and compare outputs."""
from __future__ import annotations

import os
import re
from pathlib import Path

from ..textfmt import WS_CHARS, text_sort_key
from .base import AnalyzerResult, GradeContext, LogFn
from .common import (
    BASE_FLAGS,
    clip,
    compile,
    diagnoser,
    explain_failure,
    outputs_match,
    round3,
    run_batch,
)

_TRAIL_WS = re.compile(f"[{WS_CHARS}]+\\Z")


def _trim_end(s: str) -> str:
    return _TRAIL_WS.sub("", s)


def _read(p: Path) -> str:
    return p.read_bytes().decode("utf-8", errors="replace")


class IoTests:
    name = "io_tests"
    kind = "exec"
    description = "Runs the hidden input/output test set and compares outputs."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        rel = params.get("testset_dir") or "tests"
        dir = Path(os.path.normpath(os.path.join(str(ctx.problem_dir), rel)))
        if not dir.exists():
            raise FileNotFoundError(f"testset_dir not found: {dir}")
        names = sorted((p.name for p in dir.iterdir() if p.name.endswith(".in")), key=text_sort_key)
        if not names:
            raise FileNotFoundError(f"no .in files in {dir}")

        sb = ctx.sandbox
        c = await compile(sb, ctx.source, "prog", BASE_FLAGS)
        if not c.ok:
            return {"score": 0, "evidence": {"compiled": False}, "feedback": "Did not compile, so no test could run."}

        inputs = [_read(dir / f) for f in names]
        expected: list[str | None] = []
        for f in names:
            out = dir / (f[:-3] + ".out")
            expected.append(_read(out) if out.exists() else None)
        if any(e is None for e in expected):
            if not ctx.reference:
                raise RuntimeError("some tests lack .out files and no reference_solution is configured")
            # the reference runs in its own sandbox, never next to the submission
            from .common import ref_build, reference_sandbox
            async with reference_sandbox(ctx) as rsb:
                await ref_build(rsb, ctx)
                ref_out = await run_batch(rsb, "ref", inputs, ctx.limits)
            expected = [e if e is not None else ref_out[i].stdout for i, e in enumerate(expected)]

        log({"kind": "tool", "msg": f"io_tests: running {len(inputs)} hidden tests"})
        results = await run_batch(sb, "prog", inputs, ctx.limits)
        diagnose = await diagnoser(sb, ctx.source, ctx.limits)

        failing = []
        passed = 0
        for i, r in enumerate(results):
            if r.status == "ok" and outputs_match(expected[i], r.stdout):
                passed += 1
                continue
            ub = await diagnose(inputs[i])
            # on Windows this gives tests\01.in (kept so stored hashes stay the same)
            test_file = os.path.normpath(os.path.join(rel, names[i]))
            failing.append({
                "test": names[i][:-3],
                "input": clip(_trim_end(inputs[i]), 400, test_file),
                "expected": clip(_trim_end(expected[i]), 400, test_file[:-3] + ".out"),
                "got": clip(_trim_end(r.stdout), 400) if r.status == "ok" else f"({r.label})",
                "status": r.status,
                "note": ub or (r.label if r.status != "ok" else "wrong answer"),
                "why": explain_failure(status=r.status, signal_label=r.label, expected=expected[i],
                                       got=r.stdout, ub=ub),
            })

        total = len(results)
        if failing:
            feedback = f"{passed}/{total} tests pass. First failure: test {failing[0]['test']} ({failing[0]['note']})."
        else:
            feedback = f"All {total} hidden tests pass."
        suggestions = ["Re-run the failing inputs shown in the report and compare your output with the expected one."]
        return {
            "score": round3(passed / total),
            "evidence": {
                "tests_passed": passed,
                "tests_total": total,
                "failing": failing,
                "max_ms": max(r.ms or 0 for r in results),
            },
            "feedback": feedback,
            "suggestions": suggestions if failing else [],
            "counterexamples": [{"source": "hidden test", **f} for f in failing],
        }


ANALYZER = IoTests()
