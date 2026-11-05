"""complexity_estimator: callgrind instruction counts at growing sizes, fitted to classes."""
from __future__ import annotations

import math
import re

from ..cparse import analyze_source
from ..textfmt import WS_CHARS, WS_RE, number_text, round_half_up, trim_ws, round3
from ..testgen import get_generator, is_number
from .base import AnalyzerResult, GradeContext, LogFn
from .common import compile

CLASSES = [
    ("O(1)", lambda n: 1),
    ("O(log n)", lambda n: math.log2(max(2, n))),
    ("O(n)", lambda n: n),
    ("O(n log n)", lambda n: n * math.log2(max(2, n))),
    ("O(n^2)", lambda n: n * n),
    ("O(n^3)", lambda n: n * n * n),
]

_FN_RE = re.compile(f"fn=\\((\\d+)\\)(?:[{WS_CHARS}]+([^\\n\\r\\u2028\\u2029]*))?", re.ASCII)
_COST_RE = re.compile(f"[+\\-*]?\\d+[{WS_CHARS}]+\\d+", re.ASCII)
_STAR_RE = re.compile(f"\\*[{WS_CHARS}]+\\d+", re.ASCII)
_COLLECTED_RE = re.compile(f"Collected[{WS_CHARS}]*:[{WS_CHARS}]*(\\d+)", re.ASCII)
_INDEX_KEY = re.compile(r"0|[1-9]\d*", re.ASCII)


def norm(s) -> str:
    """So O(n log n), O(nlogn) and O(N LOG N) all match."""
    t = s if isinstance(s, str) else number_text(s) if isinstance(s, (int, float)) else str(s)
    return WS_RE.sub("", t.lower()).replace("²", "^2").replace("³", "^3")


def rank_of(name) -> int:
    return next((i for i, (cls, _) in enumerate(CLASSES) if norm(cls) == norm(name)), -1)


def _div(a: float, b: float) -> float:
    if b:
        return a / b
    if a == 0 or math.isnan(a):
        return math.nan
    return math.copysign(math.inf, a) * (math.copysign(1, b))


def classify(sizes: list, costs: list) -> dict:
    if not costs:
        return {"best": "O(1)", "fits": []}
    lo, hi = min(costs), max(costs)
    if _div(hi - lo, max(1, lo)) < 0.02:
        return {"best": "O(1)", "fits": []}
    mean = sum(costs) / len(costs)
    fits = []
    for name, f in CLASSES[1:]:
        x = [f(n) for n in sizes]
        mx = sum(x) / len(x)
        sxx = sxy = 0.0
        for i in range(len(x)):
            sxx += (x[i] - mx) ** 2
            sxy += (x[i] - mx) * (costs[i] - mean)
        b = sxy / sxx if sxx else 0
        a = mean - b * mx
        rss = 0.0
        for i, c in enumerate(costs):
            rss += (c - (a + b * x[i])) ** 2
        fits.append({"name": name, "slope": b, "rel_error": _div(math.sqrt(rss / len(costs)), mean)})
    fits = [f for f in fits if f["slope"] > 0]
    if not fits:
        return {"best": "O(1)", "fits": []}
    # within 5% error we prefer the slower-growing class
    best = fits[0]
    for f in fits:
        if f["rel_error"] < best["rel_error"] * 0.95:
            best = f
    return {"best": best["name"], "fits": [{"class": f["name"], "relative_error": round3(f["rel_error"])} for f in fits]}


def _js_key_order(d: dict) -> list:
    """Object.entries order: array-index keys ascending, then the rest in insertion order."""
    idx = [k for k in d if _INDEX_KEY.fullmatch(k) and int(k) < 2**32 - 1]
    rest = [k for k in d if k not in set(idx)]
    return sorted(idx, key=int) + rest


def parse_callgrind(text: str) -> dict[str, float]:
    """Self cost per function from a callgrind.out file."""
    names: dict[str, str] = {}
    self_cost: dict[str, float] = {}
    fn = "null"
    skip = False
    for line in text.split("\n"):
        if line.startswith("fn="):
            m = _FN_RE.fullmatch(line)
            if m:
                if m.group(2):
                    names[m.group(1)] = m.group(2)
                fn = names.get(m.group(1)) or m.group(1)
            else:
                fn = line[3:]
            continue
        if line.startswith("calls="):
            skip = True
            continue
        if _COST_RE.match(line) or _STAR_RE.match(line):
            if skip:
                skip = False
                continue
            parts = WS_RE.split(trim_ws(line))
            prev = self_cost.get(fn)
            if prev is None or prev == 0 or math.isnan(prev):
                prev = 0
            self_cost[fn] = prev + is_number(parts[-1])
    return {k: self_cost[k] for k in _js_key_order(self_cost)}


def or_default(v, default):
    """Return v, or default when v is None, False, 0 or an empty string."""
    falsy = v is None or v is False or v == "" or (isinstance(v, (int, float)) and (v == 0 or math.isnan(v)))
    return default if falsy else v


def _measure(m: dict):
    v = m.get("instructions")
    return m.get("ms") if v is None else v


def _finite(v) -> bool:
    return v is not None and math.isfinite(v)


class ComplexityEstimator:
    name = "complexity_estimator"
    kind = "exec"
    description = ("Instruction counts (valgrind callgrind) at growing input sizes, fitted to complexity classes; "
                   "also profiles hot functions.")

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        gen = get_generator(ctx.rules.get("input_spec"))
        shapes = params.get("shapes", list(gen.profile_shapes))
        if not isinstance(shapes, list) or not shapes or any(s not in gen.profile_shapes for s in shapes):
            raise ValueError("Invalid profiling shapes for the selected generator")
        results = [(shape, await self._measure(ctx, {**params, "shape": shape}, log))
                   for shape in dict.fromkeys(shapes)]
        shape, worst = min(results, key=lambda pair: (pair[1]["score"],
                          -rank_of(pair[1].get("evidence", {}).get("measured", ""))))
        worst["evidence"]["worst_shape"] = shape
        worst["evidence"]["shape_results"] = [
            {"shape": s, "score": r["score"], "measured": r["evidence"].get("measured"),
             "measurements": r["evidence"].get("measurements", [])} for s, r in results]
        worst["feedback"] += f" Worst result across {', '.join(shapes)} inputs; this is an empirical estimate."
        return worst

    async def _measure(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        required = or_default(params.get("required"), "O(n)")
        req_rank = rank_of(required)
        if req_rank < 0:
            raise ValueError(f'unknown required complexity "{required}"')
        sizes = sorted(or_default(params.get("sizes"), [100, 200, 400, 800]))
        gen = get_generator(ctx.rules.get("input_spec"))
        profile_inputs = [gen.profile_input(n, params.get("shape", "normal")) for n in sizes]
        if not all(gen.validate(text) for text in profile_inputs):
            raise ValueError("Invalid profiling input: fix the input specification or profiling sizes")
        sb = ctx.sandbox

        c = await compile(sb, ctx.source, "prof", "-O2 -g -std=c11")
        if not c.ok:
            return {"score": 0, "evidence": {"compiled": False}, "feedback": "Did not compile."}

        has_valgrind = (await sb.sh("valgrind --version", timeout_s=10)).code == 0
        per_run_limit = max(30, ctx.time_limit_s * 40)
        measurements: list[dict] = []
        hot: list[dict] = []
        for n, text in zip(sizes, profile_inputs):
            input = text.encode("utf-8")
            if has_valgrind:
                r = await sb.sh("valgrind --tool=callgrind --callgrind-out-file=cg.out ./prof > /dev/null",
                                input=input, timeout_s=per_run_limit)
                m = _COLLECTED_RE.search(r.err)
                # a crashed run stops early and would look cheap, so only clean runs count
                if not m or r.status != "ok":
                    if r.status == "timeout":
                        status = "timeout"
                    elif r.status != "ok":
                        status = f"failed ({r.status}, exit {r.code})"
                    else:
                        status = "no-count"
                    measurements.append({"n": n, "instructions": None, "status": status})
                    break
                measurements.append({"n": n, "instructions": int(m.group(1))})
                if n == sizes[-1] or len(sizes) == 1:
                    cg = await sb.sh("cat cg.out", timeout_s=10)
                    self_cost = parse_callgrind(cg.out)
                    total = sum(self_cost.values())
                    if not total or math.isnan(total):
                        total = 1
                    user_fns = {f["name"] for f in analyze_source(ctx.source)["functions"]}
                    ranked = sorted(self_cost.items(), key=lambda kv: -kv[1])[:5]
                    hot = [{"function": fn, "share": round3(cost / total), "user_code": fn in user_fns}
                           for fn, cost in ranked]
            else:
                times = []
                for _ in range(3):
                    r = await sb.sh("./prof > /dev/null", input=input, timeout_s=ctx.time_limit_s * 5)
                    times.append(r.ms if r.status == "ok" else math.inf)
                times.sort()
                measurements.append({"n": n, "ms": times[1]})
        method = "callgrind instruction counts" if has_valgrind else "wall-clock time (approximate)"
        log({"kind": "tool", "msg": f"complexity_estimator: measured {len(measurements)}/{len(sizes)} sizes with {method}"})

        valid = [m for m in measurements if _finite(_measure(m))]
        failed_at = next((m for m in measurements if not _finite(_measure(m))), None)
        if failed_at:
            best = "too slow to measure" if failed_at.get("status") == "timeout" else "fails at larger sizes"
            verdict = {"best": best, "fits": []}
        else:
            verdict = classify([m["n"] for m in valid], [_measure(m) for m in valid])

        measured_rank = rank_of(verdict["best"])
        if measured_rank < 0:
            score = 0
        elif measured_rank <= req_rank:
            score = 1
        elif measured_rank == req_rank + 1:
            score = 0.5
        else:
            score = 0
        user_hot = next((h for h in hot if h["user_code"]), None)

        if failed_at:
            what = "ran too long" if failed_at.get("status") == "timeout" else "did not finish cleanly"
            feedback = (f"Could not measure: the program {what} at n = {number_text(failed_at['n'])}, "
                        f"so the required {required} is not met at the sizes tested.")
        elif score == 1:
            feedback = f"{verdict['best']} measured; meets the required {required}."
        else:
            hot_note = (f"; {user_hot['function']}() uses {number_text(round_half_up(user_hot['share'] * 100))}% of the instructions"
                        if user_hot else "")
            feedback = f"{verdict['best']} measured, but {required} is required{hot_note}."

        if score == 1:
            suggestions = []
        elif failed_at:
            suggestions = [(f"Make the program handle n = {number_text(failed_at['n'])} and larger (check fixed-size "
                           "arrays and limits); only then can its running time be measured.")]
        else:
            hint = ("Use an O(n log n) method such as qsort() or merge sort instead of nested loops."
                    if required == "O(n log n)"
                    else "Remove the repeated work that makes the running time grow faster than required.")
            suggestions = [f"Your algorithm grows as {verdict['best']}; the problem requires {required}. {hint}"]

        return {
            "score": score,
            "evidence": {
                "required": required,
                "measured": verdict["best"],
                "method": ("callgrind instruction count (deterministic)" if has_valgrind
                           else "median wall-clock ms (approximate)"),
                "measurements": measurements,
                "fits": verdict["fits"],
                "profile_hot_functions": hot,
            },
            "feedback": feedback,
            "suggestions": suggestions,
        }


ANALYZER = ComplexityEstimator()
