"""function_split: is the work split into helpers that main() actually uses."""
from __future__ import annotations

from ..cparse import analyze_source
from ..textfmt import number_text, round3
from .base import AnalyzerResult, GradeContext, LogFn


def _opt(params: dict, key: str, default):
    v = params.get(key)
    return default if v is None else v


class FunctionSplit:
    name = "function_split"
    kind = "source"
    description = "Checks that the work is split into helper functions that main() uses."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        min_fns = _opt(params, "min_functions", 2)
        expect_helpers = _opt(params, "expect_helpers", True)
        a = analyze_source(ctx.source)
        fns = a["functions"]
        by_name = {f["name"]: f for f in fns}
        main = by_name.get("main")
        simple = (len(fns) == 1 and main and main["length"] <= 20
                  and main["cyclomatic"] <= 2 and len(a["tokens"]) <= 100)
        if simple and not params.get("require_helpers", False):
            return {"score": 1, "evidence": {"functions_defined": 1, "simple_program": True},
                    "feedback": "Short, simple program: helper functions are optional.", "suggestions": []}

        reachable: set[str] = set()
        stack = ["main"]
        while stack:
            f = by_name.get(stack.pop())
            for c in (f or {}).get("callsUserFunctions") or []:
                if c not in reachable:
                    reachable.add(c)
                    stack.append(c)
        helpers = [f["name"] for f in fns if f["name"] != "main"]
        used = [h for h in helpers if h in reachable]
        unused = [h for h in helpers if h not in reachable]

        n = len(fns)
        if n >= min_fns and (not expect_helpers or used):
            score = 1
        elif n >= min_fns:
            score = 0.6
        else:
            score = min(0.6, 0.3 + 0.7 * ((n - 1) / max(1, min_fns)))

        main = by_name.get("main")
        main_len = main["length"] if main else 0
        oversized = [f["name"] for f in fns if (f["name"] == "main" or f["name"] in reachable)
                     and (f["length"] > 40 or f["cyclomatic"] > 10)]
        if score == 1 and oversized:
            return {"score": 0.6,
                    "evidence": {"functions_defined": n, "helpers_used_by_main": used,
                                 "oversized_functions": oversized},
                    "feedback": "Called helpers exist, but functions remain long or complex: " + ", ".join(oversized),
                    "suggestions": ["Split the long or complex functions into meaningful steps."]}

        if score == 1:
            feedback = f"{n} functions; main() delegates to {', '.join(used)}."
        elif n <= 1:
            feedback = "Only main() is defined: all logic is in one block."
        elif n < min_fns:
            names = ", ".join(f["name"] for f in fns)
            feedback = f"{n} functions defined ({names}); the rules expect at least {number_text(min_fns)}."
        else:
            feedback = (f"Helpers {', '.join(unused)} are defined but main() never uses them "
                        "(neither calls them nor passes them as a function pointer).")

        if score == 1:
            suggestions = []
        elif n <= 1:
            suggestions = [("Move the core computation into its own function (e.g. a helper that takes the inputs "
                           "and returns the result) and call it from main().")]
        elif n < min_fns:
            suggestions = [("Split main() into named steps (e.g. reading the input, the computation, printing the "
                           "result) as separate functions.")]
        else:
            suggestions = ["Call your helper functions from main() instead of duplicating their logic."]

        return {
            "score": round3(score),
            "evidence": {
                "functions_defined": n,
                "expected_min": min_fns,
                "helpers_used_by_main": used,
                "helpers_never_used": unused,
                "main_lines": main_len,
            },
            "feedback": feedback,
            "suggestions": suggestions,
        }


ANALYZER = FunctionSplit()
