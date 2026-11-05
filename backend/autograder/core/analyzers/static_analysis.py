"""static_analysis: complexity, length and nesting from cparse plus cppcheck."""
from __future__ import annotations

import re

from ..cparse import analyze_source
from ..textfmt import number_text
from .base import AnalyzerResult, GradeContext, LogFn
from .common import clamp01, round3

CPPCHECK_CMD = (
    "cppcheck --enable=warning,style,performance,portability --std=c11 --quiet --inline-suppr "
    "--template='{line}|{severity}|{id}|{message}' cc.c 2>&1"
)
SPLIT_HINT = ("Break long or deeply branched functions into smaller helpers, and fix the cppcheck "
              "findings listed in the report.")
_FINDING = re.compile(r"^\d+\|", re.ASCII)


def _param(params: dict, key: str, default):
    v = params.get(key)
    return default if v is None else v


def _s(v) -> str:
    """Format a value for a message: numbers without a trailing .0, None as 'undefined'."""
    if v is None:
        return "undefined"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return number_text(v)
    return str(v)


def parse_cppcheck(text: str) -> list[dict]:
    out = []
    for ln in text.split("\n"):
        if not _FINDING.search(ln):
            continue
        parts = ln.split("|")
        f = {"line": int(parts[0])}
        # fields with no value are left out of the message
        if len(parts) > 1:
            f["severity"] = parts[1]
        if len(parts) > 2:
            f["id"] = parts[2]
        f["message"] = "|".join(parts[3:])
        out.append(f)
    return out


async def run_cppcheck(sb, source: str) -> str:
    await sb.write_file("cc.c", source)
    r = await sb.sh(CPPCHECK_CMD, timeout_s=60)
    return r.out


class StaticAnalysis:
    name = "static_analysis"
    kind = "build"
    description = "Cyclomatic complexity, function length and nesting (own lexer) plus cppcheck findings."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        max_cc = _param(params, "max_cyclomatic", 10)
        max_len = _param(params, "max_function_length", 50)
        max_nest = _param(params, "max_nesting", 4)
        a = analyze_source(ctx.source)

        issues = []
        score = 1
        for f in a["functions"]:
            if f["cyclomatic"] > max_cc:
                score -= 0.25
                issues.append(f"{f['name']}(): cyclomatic complexity {_s(f['cyclomatic'])} > {_s(max_cc)}")
            if f["length"] > max_len:
                score -= 0.25
                issues.append(f"{f['name']}(): {_s(f['length'])} lines > {_s(max_len)}")
            if f["maxNesting"] > max_nest:
                score -= 0.15
                issues.append(f"{f['name']}(): nesting depth {_s(f['maxNesting'])} > {_s(max_nest)}")

        cppcheck: list[dict] = []
        shared = ctx.extra.get("cppcheck_out")
        if shared is not None or ctx.sandbox:
            # the coordinator runs cppcheck once in the first pass when the LLM wants the findings
            cppcheck = parse_cppcheck(shared if shared is not None else await run_cppcheck(ctx.sandbox, ctx.source))
            log({"kind": "tool", "msg": f"static_analysis: cppcheck reported {len(cppcheck)} finding(s)"})
        serious = [f for f in cppcheck if f.get("severity") in ("error", "warning")]
        score -= min(0.3, 0.1 * len(serious))
        for f in serious:
            issues.append(f"line {_s(f['line'])}: cppcheck {f['severity']} ({_s(f.get('id'))}) {f['message']}")

        if issues:
            feedback = f"{len(issues)} structural issue(s): {'; '.join(issues[:2])}."
            suggestions = [SPLIT_HINT]
        else:
            feedback = "Functions are within the complexity, length and nesting limits; cppcheck found no defects."
            suggestions = []
        return {
            "score": round3(clamp01(score)),
            "evidence": {
                "thresholds": {"max_cyclomatic": max_cc, "max_function_length": max_len, "max_nesting": max_nest},
                "functions": [{"name": f["name"], "lines": f["length"], "cyclomatic": f["cyclomatic"],
                               "nesting": f["maxNesting"]} for f in a["functions"]],
                "cppcheck": cppcheck,
                "issues": issues,
            },
            "feedback": feedback,
            "suggestions": suggestions,
        }


ANALYZER = StaticAnalysis()
