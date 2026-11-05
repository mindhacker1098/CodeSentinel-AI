"""compiler_warnings: strict-flag build that counts diagnostics."""
from __future__ import annotations

import re

from ..textfmt import WS_CHARS, round_half_up, trim_ws
from .base import AnalyzerResult, GradeContext, LogFn
from .common import compile

_WERROR = re.compile(f"(^|[{WS_CHARS}])-Werror([{WS_CHARS}]|\\Z)")
_WERROR_SUB = re.compile(f"(^|[{WS_CHARS}])-Werror(?=[{WS_CHARS}]|\\Z)")
_DIAG = re.compile(r"(warning|error):")
_KIND = re.compile(r"\[(-W[^\]]+)\]")
_PREFIX = re.compile(r"^warn\.c:")


class CompilerWarnings:
    name = "compiler_warnings"
    kind = "build"
    description = "Compiles with strict warning flags and counts diagnostics."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        flags = params.get("flags") or "-Wall -Wextra -std=c11"
        werror = bool(_WERROR.search(flags))
        count_flags = trim_ws(_WERROR_SUB.sub(" ", flags))
        penalty = params.get("penalty_per_warning")
        if penalty is None:
            penalty = 0.1

        c = await compile(ctx.sandbox, ctx.source, "warn", f"{count_flags} -O2 -c", libs="")
        lines = [_PREFIX.sub("line ", ln) for ln in c.stderr.split("\n") if _DIAG.search(ln)]
        kinds = list(dict.fromkeys(m.group(1) for m in map(_KIND.search, lines) if m))

        if c.errors > 0 or not c.ok:
            first = next((ln for ln in lines if "error:" in ln), None) or "see diagnostics"
            return {
                "score": 0,
                "evidence": {"flags": flags, "errors": c.errors, "warnings": c.warnings, "diagnostics": lines[:15]},
                "feedback": f"Compilation fails with {c.errors} error(s). First: {first}",
                "suggestions": ["Fix the compiler errors first; nothing else can be graded properly until the program builds."],
            }

        score = max(0, round_half_up((1 - penalty * c.warnings) * 1000) / 1000)
        kind_list = ", ".join(kinds) or "see diagnostics"
        if c.warnings:
            tail = " (the build would fail with -Werror)" if werror else ""
            feedback = f"{c.warnings} warning(s) under {count_flags}{tail}: {kind_list}."
            suggestions = [f"Fix the compiler warnings ({kind_list}); they often point at real bugs."]
        else:
            feedback = f"Clean build under {flags}."
            suggestions = []
        return {
            "score": score,
            "evidence": {
                "flags": flags,
                "warnings": c.warnings,
                "warning_kinds": kinds,
                "would_fail_with_Werror": werror and c.warnings > 0,
                "diagnostics": lines[:15],
            },
            "feedback": feedback,
            "suggestions": suggestions,
        }


ANALYZER = CompilerWarnings()
