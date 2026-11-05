"""codacy_review: Codacy findings (lizard complexity, opengrep C security rules) as a score."""
from __future__ import annotations

from ..codacy import run_codacy
from ..textfmt import number_text, round_half_up
from .base import AnalyzerResult, GradeContext, LogFn

DEFAULT_PENALTY = {"Error": 0.15, "Warning": 0.08, "Info": 0.03}
TOP = 5


def codacy_params(params: dict) -> dict:
    penalty = {**DEFAULT_PENALTY, **(params.get("penalty") or {})}
    max_penalty = params.get("max_penalty")
    return {
        "mode": params.get("mode") or "local",
        "penalty": penalty,
        "max_penalty": 0.6 if max_penalty is None else max_penalty,
        "fail_if_unavailable": bool(params.get("fail_if_unavailable", False)),
        "cloud_file_path": params.get("cloud_file_path"),
    }


def score_issues(issues: list[dict], penalty: dict, max_penalty: float) -> float:
    total = sum(penalty.get(i["level"], 0) for i in issues)
    return round_half_up(max(0, 1 - min(max_penalty, total)) * 1000) / 1000


class CodacyReview:
    name = "codacy_review"
    kind = "source"
    description = "Codacy static analysis (lizard complexity, opengrep C rules); local codacy-cli or Codacy cloud API."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        p = codacy_params(params)
        res = ctx.extra.get("codacy") or await run_codacy(ctx.source, ctx.settings, log, mode=p["mode"],
                                                          cloud_file_path=p["cloud_file_path"])
        if not res["available"]:
            reason = res.get("error") or "codacy unavailable"
            if p["fail_if_unavailable"]:
                raise RuntimeError(f"Codacy unavailable: {reason}")
            return {
                "score": 1,
                "evidence": {"available": False, "mode": res["mode"], "reason": reason, "issues": []},
                "feedback": f"Codacy analysis skipped ({reason}); this metric was not applied.",
                "suggestions": [],
            }

        issues = res["issues"]
        score = score_issues(issues, p["penalty"], p["max_penalty"])
        counts = {lvl: sum(1 for i in issues if i["level"] == lvl) for lvl in ("Error", "Warning", "Info")}
        evidence = {"available": True, "mode": res["mode"], "tool_versions": res["tool_versions"],
                    "counts": counts, "penalty": p["penalty"], "max_penalty": p["max_penalty"],
                    "issues": issues, "cached": res.get("cached", False)}
        for k in ("note", "file_path"):
            if res.get(k):
                evidence[k] = res[k]
        if not issues:
            return {"score": score, "evidence": evidence,
                    "feedback": "Codacy (lizard, opengrep) found no issues.", "suggestions": []}

        ranked = sorted(issues, key=lambda i: ({"Error": 0, "Warning": 1}.get(i["level"], 2), i["line"], i["rule"]))
        top = "; ".join(f"line {number_text(i['line'])} {i['level'].lower()}: {i['message']}" for i in ranked[:TOP])
        summary = ", ".join(f"{n} {lvl.lower()}" for lvl, n in counts.items() if n)
        more = f" (+{len(issues) - TOP} more)" if len(issues) > TOP else ""
        suggestions = list(dict.fromkeys(f"Line {number_text(i['line'])}: {i['message']}" for i in ranked[:TOP]))
        return {
            "score": score,
            "evidence": evidence,
            "feedback": f"Codacy found {len(issues)} issue(s) ({summary}): {top}{more}.",
            "suggestions": suggestions,
        }


ANALYZER = CodacyReview()
