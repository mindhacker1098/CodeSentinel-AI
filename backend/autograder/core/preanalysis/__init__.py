"""Pre-analysis: denylist scan, optional LLM pre-read and the checks built on it.

The coordinator calls run() before the first pass, verify() after it and
compare_complexity() once the metrics are in. None of it changes a score
unless the rules ask for it (edge_case_runner.params.include_llm_cases).
"""
from __future__ import annotations

from ..analyzers.base import GradeContext, LogFn
from ..analyzers.complexity_estimator import rank_of
from ..corpus import read_text
from . import denylist
from .llm_pre import explain_failures, pre_read
from .verify import verify_llm_inputs

__all__ = ["compare_complexity", "explain_failures", "llm_enabled", "pre_read", "read", "run", "sandbox_kind",
           "verify", "verify_llm_inputs"]


async def sandbox_kind(settings) -> str:
    """Kind of sandbox create_sandbox will pick, without starting one.

    grade_submission pins SANDBOX first, so this matches every sandbox the job creates.
    """
    from ..sandbox import select

    want = (settings.SANDBOX or "auto").lower()
    if want != "auto":
        return want
    try:
        return await select.resolve_kind(settings)
    except RuntimeError:
        return "none"


def llm_enabled(rules: dict, settings) -> bool:
    return bool((rules.get("pre_analysis") or {}).get("llm", False) or getattr(settings, "PRE_ANALYSIS_LLM", False))


async def run(ctx: GradeContext, log: LogFn, *, defer_llm: bool = False) -> dict:
    """Denylist (always) and LLM pre-read (if enabled); decides flag vs block.

    defer_llm leaves the pre-read to read(), which the coordinator calls once the
    static findings are in.
    """
    findings = denylist.scan(ctx.source)
    crit = denylist.critical(findings)
    kind = await sandbox_kind(ctx.settings)
    # rules may only make the policy stricter
    strict = (ctx.rules.get("pre_analysis") or {}).get("policy") == "block"
    policy = "flag" if kind == "docker" and not strict else "block"
    pre: dict = {
        "denylist": findings,
        "sandbox": kind,
        "policy": policy,
        "blocked": bool(crit) and policy == "block",
        "llm": None,
        "verified": None,
        "complexity": None,
    }
    if findings:
        names = ", ".join(dict.fromkeys(f["call"] for f in findings))
        log({"kind": "security" if crit else "warn",
             "msg": f"pre-analysis: {len(findings)} denylist finding(s) ({names}); policy {policy}"
                    + ("; exec analyzers blocked" if pre["blocked"] else "")})
    if pre["blocked"] or not llm_enabled(ctx.rules, ctx.settings) or defer_llm:
        return pre
    return await read(ctx, pre, log)


async def read(ctx: GradeContext, pre: dict, log: LogFn, findings: list[str] | None = None) -> dict:
    """The LLM pre-read, optionally grounded in static-analysis findings."""
    if pre["blocked"] or not llm_enabled(ctx.rules, ctx.settings):
        return pre
    statement = ctx.problem_dir / "problem.md"
    params = (ctx.rules.get("pre_analysis") or {}).get("params")
    pre["llm"] = await pre_read(ctx.source, read_text(statement) if statement.exists() else "", ctx.settings,
                                params=params, log=log, findings=findings)
    return pre


def flags(pre: dict | None) -> list[dict]:
    if not pre:
        return []
    crit = denylist.critical(pre["denylist"])
    if not crit:
        return []
    detail = "; ".join(f"line {f['line']}: {f['call']}" for f in crit[:5])
    return [{"type": "dangerous_call", "detail": detail, "severity": "high", "policy": pre["policy"]}]


def block_reason(pre: dict | None) -> str | None:
    if not pre or not pre["blocked"]:
        return None
    names = ", ".join(dict.fromkeys(f["call"] for f in denylist.critical(pre["denylist"])))
    return f"pre-analysis found dangerous calls ({names}) and the sandbox is {pre['sandbox']}, not docker"


async def verify(ctx: GradeContext, pre: dict | None, log: LogFn) -> dict | None:
    llm = (pre or {}).get("llm") or {}
    if not llm.get("extra_inputs"):
        return None
    pre["verified"] = await verify_llm_inputs(ctx, llm["extra_inputs"], log)
    return pre["verified"]


def compare_complexity(pre: dict | None, metrics: list[dict]) -> dict | None:
    """Estimated vs measured complexity; the measured class is the one that counts."""
    est = ((pre or {}).get("llm") or {}).get("estimated_complexity")
    if not est or est == "unknown":
        return None
    measured = next((m["evidence"].get("measured") for m in metrics
                     if m["analyzer"] == "complexity_estimator" and m["status"] == "ok" and m.get("evidence")), None)
    out = {"estimated": est, "measured": measured, "agree": None, "used": "measured" if measured else None}
    if measured and rank_of(measured) >= 0:
        out["agree"] = rank_of(measured) == rank_of(est)
    pre["complexity"] = out
    return out
