"""edge_case_runner: named corner cases plus seeded differential testing."""
from __future__ import annotations

import re

from ..textfmt import WS_CHARS, number_text, round3
from ..prng import mulberry32
from ..testgen import get_generator
from .base import AnalyzerResult, GradeContext, LogFn
from .common import (
    BASE_FLAGS,
    compile,
    diagnoser,
    explain_failure,
    outputs_match,
    ref_build,
    reference_sandbox,
    run_batch,
)
from .complexity_estimator import or_default

_TRAIL_WS = re.compile(f"[{WS_CHARS}]+\\Z")

SUGGEST = {
    "int_overflow": "Sums of two ints can exceed INT_MAX: compute in long long (or check the operands before adding).",
    "int_extremes": "Test with INT_MAX and INT_MIN; make sure no intermediate value overflows.",
    "large_values": ("Values near the int limits can overflow intermediate results; use a wider type or compare "
                     "instead of subtracting."),
    "negatives": "Check that negative inputs are read and handled correctly.",
    "zero": "Make sure zero values do not break the logic.",
    "extra_whitespace": ('Read numbers with scanf("%d", ...) rather than parsing characters, so extra spaces, tabs '
                         "and newlines are handled."),
    "empty": "Handle n = 0: the program must still print the expected (possibly empty) output without crashing.",
    "single": "Handle a single element without reading or writing out of bounds.",
    "duplicates": "Make sure equal values are handled (stable comparisons, no early exits on equality).",
    "sorted": "Already-sorted input should work and should not trigger worst-case behaviour.",
    "reverse": "Reverse-sorted input should work and should not trigger worst-case behaviour.",
}


def trim_end(s: str) -> str:
    return _TRAIL_WS.sub("", s)


def _opt(params: dict, key: str, default):
    v = params.get(key)
    return default if v is None else v


def _ok(mine, ref) -> bool:
    return mine.status == "ok" and outputs_match(ref.stdout, mine.stdout)


def _failure(case: str, input: str, mine, ref, ub: str | None, why: str | None = None) -> dict:
    return {
        "case": case,
        "input": trim_end(input),
        "expected": trim_end(ref.stdout),
        "got": trim_end(mine.stdout) if mine.status == "ok" else f"({mine.label})",
        "status": mine.status,
        "note": ub or (mine.label if mine.status != "ok" else "wrong answer"),
        "why": explain_failure(status=mine.status, signal_label=mine.label, expected=ref.stdout, got=mine.stdout,
                               ub=ub, why=why),
    }


async def shrink(sb, rsb, gen, input: str, limits: dict) -> str:
    """Greedy shrinking: keep the smaller input while it still fails.

    sb holds only the student program; rsb holds only the reference solution.
    """
    current = input
    for _ in range(6):
        cands = [text for text in gen.shrink_candidates(current) if gen.validate(text)]
        if not cands:
            break
        r = await run_batch(rsb, "ref", cands, limits)
        m = await run_batch(sb, "prog", cands, limits)
        idx = next((i for i in range(len(cands)) if not _ok(m[i], r[i])), -1)
        if idx < 0:
            break
        current = cands[idx]
    return current


class EdgeCaseRunner:
    name = "edge_case_runner"
    kind = "exec"
    description = "Runs named corner cases and seeded differential testing against the reference solution."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        if not ctx.reference:
            raise RuntimeError("edge_case_runner needs reference_solution in the rules")
        gen = get_generator(ctx.rules.get("input_spec"))
        sb = ctx.sandbox
        limits = ctx.limits

        c = await compile(sb, ctx.source, "prog", BASE_FLAGS)
        if not c.ok:
            return {"score": 0, "evidence": {"compiled": False}, "feedback": "Did not compile."}
        async with reference_sandbox(ctx) as rsb:
            await ref_build(rsb, ctx)
            return await self._run(ctx, params, log, gen, sb, rsb, limits)

    async def _run(self, ctx, params, log, gen, sb, rsb, limits) -> AnalyzerResult:
        diagnose = await diagnoser(sb, ctx.source, limits)

        names = or_default(params.get("cases"), gen.edge_names)
        cases = []
        for name in names:
            lst = gen.edge(name)
            if not lst:
                log({"kind": "warn", "msg": f'edge_case_runner: generator "{gen.name}" has no edge case "{name}" (skipped)'})
            cases += [{"name": name, **x} for x in lst if gen.validate(x["input"])]
        log({"kind": "tool", "msg": f"edge_case_runner: {len(cases)} named edge inputs across {len(names)} categories"})

        inputs = [x["input"] for x in cases]
        trials = _opt(params, "random_trials", 100)
        seed = _opt(params, "seed", 7)
        rng = mulberry32(seed)
        random_inputs = [gen.random(rng, i) for i in range(int(trials))]
        if not all(gen.validate(text) for text in random_inputs):
            raise ValueError("Random generator produced an input outside the configured domain")
        # the reference runs in its own sandbox, so the submission can neither run nor read it
        ref = await run_batch(rsb, "ref", inputs, limits)
        r2 = await run_batch(rsb, "ref", random_inputs, limits) if trials > 0 else []
        mine = await run_batch(sb, "prog", inputs, limits)

        per_category: dict[str, dict] = {}
        failing = []
        for i, case in enumerate(cases):
            cat = per_category.setdefault(case["name"], {"passed": 0, "total": 0})
            cat["total"] += 1
            if _ok(mine[i], ref[i]):
                cat["passed"] += 1
                continue
            ub = await diagnose(case["input"])
            failing.append(_failure(case["name"], case["input"], mine[i], ref[i], ub, case.get("why")))
        cat_names = list(per_category)
        cat_passed = sum(1 for n in cat_names if per_category[n]["passed"] == per_category[n]["total"])

        random_failures = []
        if trials > 0:
            log({"kind": "tool",
                 "msg": f"edge_case_runner: {number_text(trials)} seeded random trials (seed {number_text(seed)}) vs reference"})
            m2 = await run_batch(sb, "prog", random_inputs, limits)
            random_failures = [i for i in range(len(random_inputs)) if not _ok(m2[i], r2[i])]

        counterexamples = []
        for i in random_failures[:3]:
            input = random_inputs[i]
            if gen.shrink_candidates:
                input = await shrink(sb, rsb, gen, input, limits)
            [r3] = await run_batch(rsb, "ref", [input], limits)
            [m3] = await run_batch(sb, "prog", [input], limits)
            ub = await diagnose(input)
            label = f"random trial #{i}{' (shrunk)' if input != random_inputs[i] else ''}"
            counterexamples.append(_failure(label, input, m3, r3, ub))

        score = cat_passed / len(cat_names) if cat_names else 1
        if random_failures:
            score *= _opt(params, "random_failure_factor", 0.8)
        score = round3(score)

        failed_cats = [n for n in cat_names if per_category[n]["passed"] < per_category[n]["total"]]
        feedback = (f"{cat_passed}/{len(cat_names)} edge-case categories pass"
                    + (f" (failed: {', '.join(failed_cats)})" if failed_cats else "")
                    + f"; random testing: {len(random_failures)}/{number_text(trials)} trials disagree with the reference.")
        return {
            "score": score,
            "evidence": {
                "categories": per_category,
                "failing": failing,
                "random": {"trials": trials, "seed": seed, "failures": len(random_failures),
                           "counterexamples": counterexamples},
            },
            "feedback": feedback,
            "suggestions": [SUGGEST.get(n) or f'Handle the "{n}" case correctly.' for n in failed_cats],
            "counterexamples": ([{"source": "edge case", **f} for f in failing]
                                + [{"source": "generated counter-example", **f} for f in counterexamples]),
        }


ANALYZER = EdgeCaseRunner()
