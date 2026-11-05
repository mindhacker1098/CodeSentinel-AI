"""Execution check for inputs the LLM pre-read suggested.

An input is used only if the problem's generator accepts it and the
reference runs cleanly on it. A submission that then disagrees with the
reference gets a counterexample; nothing the model claims is trusted.
"""
from __future__ import annotations

from ..analyzers.base import GradeContext
from ..analyzers.common import (
    BASE_FLAGS,
    compile,
    explain_failure,
    outputs_match,
    run_batch,
)
from ..analyzers.edge_case_runner import trim_end
from ..sandbox.select import sandbox_ctx
from ..testgen import get_generator

SOURCE_LABEL = "LLM-suggested, execution-confirmed"


def _input_text(s: str) -> str:
    return s if s.endswith("\n") else s + "\n"


async def _check(sb, ctx: GradeContext, inputs: list[str]) -> tuple[list, list] | str:
    from ..analyzers.common import reference_sandbox
    # the reference runs in its own sandbox, never next to the submission
    async with reference_sandbox(ctx) as rsb:
        ref = await compile(rsb, ctx.reference, "ref", BASE_FLAGS)
        if not ref.ok:
            return "the reference does not compile"
        ref_runs = await run_batch(rsb, "ref", inputs, ctx.limits)
    mine = await compile(sb, ctx.source, "prog", BASE_FLAGS)
    if not mine.ok:
        return "the submission does not compile"
    return ref_runs, await run_batch(sb, "prog", inputs, ctx.limits)


async def verify_llm_inputs(ctx: GradeContext, suggestions: list[dict], log=None) -> dict:
    """Returns {checked, rejected[{input, reason}], confirmed, counterexamples[], error?}."""
    out: dict = {"checked": 0, "rejected": [], "confirmed": 0, "counterexamples": []}
    if not suggestions:
        return out
    if not ctx.reference:
        return {**out, "error": "no reference solution"}
    try:
        gen = get_generator(ctx.rules.get("input_spec"))
    except ValueError as e:
        return {**out, "error": str(e)}

    valid = []
    for s in suggestions:
        text = _input_text(s.get("input") or "")
        if text in (v["input"] for v in valid):
            continue
        if not gen.validate(text):
            out["rejected"].append({"input": trim_end(text), "reason": f"not a valid {gen.name} input"})
            continue
        valid.append({"input": text, "rationale": s.get("rationale") or ""})
    if not valid:
        return out

    inputs = [v["input"] for v in valid]
    if ctx.sandbox is not None:
        runs = await _check(ctx.sandbox, ctx, inputs)
    else:
        async with sandbox_ctx(ctx.settings, ctx.limits, log) as sb:
            runs = await _check(sb, ctx, inputs)
    if isinstance(runs, str):
        return {**out, "error": runs}

    refs, mine = runs
    for v, r, m in zip(valid, refs, mine):
        if r.status != "ok":
            out["rejected"].append({"input": trim_end(v["input"]), "reason": f"reference: {r.label or r.status}"})
            continue
        out["checked"] += 1
        if m.status == "ok" and outputs_match(r.stdout, m.stdout):
            continue
        out["confirmed"] += 1
        out["counterexamples"].append({
            "case": "llm_suggested",
            "input": trim_end(v["input"]),
            "expected": trim_end(r.stdout),
            "got": trim_end(m.stdout) if m.status == "ok" else f"({m.label})",
            "status": m.status,
            "note": m.label if m.status != "ok" else "wrong answer",
            "why": explain_failure(status=m.status, signal_label=m.label, expected=r.stdout, got=m.stdout,
                                   why=v["rationale"] or None),
            "source": SOURCE_LABEL,
        })
    if log:
        log({"kind": "plan", "msg": f"pre-analysis: {out['checked']} LLM-suggested input(s) checked, "
                                    f"{out['confirmed']} confirmed failure(s), {len(out['rejected'])} rejected"})
    return out
