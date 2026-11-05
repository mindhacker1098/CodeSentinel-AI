"""AddressSanitizer/UBSan and valgrind memcheck."""
from __future__ import annotations

import re

from ..corpus import read_text
from ..textfmt import WS_CHARS, text_sort_key, trim_ws, round3
from ..testgen import get_generator
from .base import AnalyzerResult, GradeContext, LogFn
from .common import compile, run_batch

_TRAIL_WS = re.compile(f"[{WS_CHARS}]+\\Z")
_DEADLY = re.compile(r"DEADLYSIGNAL")
_ASAN_ERR = re.compile(r"ERROR: AddressSanitizer")
_ASAN_KIND = re.compile(r"ERROR: AddressSanitizer: ([\w-]+)", re.ASCII)
_ASAN_LOC = re.compile(r"#0 [^\n]* in (\S+) [^\n]*asan\.c:(\d+)", re.ASCII)
_UB = re.compile(r"asan\.c:(\d+):\d+: runtime error: ([^\n]+)", re.ASCII)
_LOST = re.compile(r"(\d[\d,]*) bytes in \d[\d,]* blocks are definitely lost", re.ASCII)
_LOST_AT = re.compile(r"definitely lost[\s\S]*?by 0x[0-9A-F]+: (\w+) \(plain\.c:(\d+)\)", re.ASCII)
_INVALID = re.compile(r"Invalid (read|write|free)")
_UNINIT = re.compile(r"uninitialised value")
_OOB = re.compile(r"^invalid-(read|write)$")

VG_SCRIPT = ("#!/bin/sh\nexec valgrind -q --leak-check=full --show-leak-kinds=definite "
             "--errors-for-leak-kinds=definite ./plain\n")


def _short_input(s: str) -> str:
    return _TRAIL_WS.sub("", s)[:200]


def collect_inputs(ctx: GradeContext, max: int = 20) -> list[str]:
    inputs: list[str] = []
    if ctx.sample_input:
        inputs.append(ctx.sample_input)
    io = next((m for m in ctx.rules.get("metrics", []) if m.get("analyzer") == "io_tests"), None)
    test_dir = ((io or {}).get("params") or {}).get("testset_dir")
    if test_dir:
        folder = ctx.problem_dir / test_dir
        if folder.exists():
            names = sorted((p.name for p in folder.iterdir() if p.name.endswith(".in")), key=text_sort_key)
            inputs.extend(read_text(folder / n) for n in names)
    if ctx.rules.get("input_spec"):
        gen = get_generator(ctx.rules["input_spec"])
        for name in gen.edge_names:
            inputs.extend(c["input"] for c in gen.edge(name) if gen.validate(c["input"]))
    return list(dict.fromkeys(inputs))[:max]


def _with_where(issue: dict, m: re.Match | None) -> dict:
    if m and m.group(1):
        issue["where"] = f"{m.group(1)}() line {m.group(2)}"
    return issue


class SanitizerRun:
    name = "sanitizer_run"
    kind = "exec"
    description = "AddressSanitizer + valgrind memcheck over sample, hidden and edge-case inputs."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        sb = ctx.sandbox
        inputs = collect_inputs(ctx)
        issues: list[dict] = []
        ub_notes: list[dict] = []

        flags = f"{params.get('flags') or '-fsanitize=address,undefined'} -g -O1 -fno-omit-frame-pointer -std=c11"
        asan = await compile(sb, ctx.source, "asan", flags)
        if not asan.ok:
            return {"score": 0, "evidence": {"compiled": False}, "feedback": "Did not compile with sanitizers."}
        env = {"ASAN_OPTIONS": "detect_leaks=0:halt_on_error=1:abort_on_error=0", "UBSAN_OPTIONS": "print_stacktrace=0"}
        limits = {"time_limit_s": ctx.time_limit_s * 4, "memory_limit_mb": 0, "env": env}
        ar = await run_batch(sb, "asan", inputs, limits, fsize_mb=2)

        # gcc asan can loop on DEADLYSIGNAL before main() under ASLR; a real crash also prints the ERROR summary
        unstable: list[int] = []
        for _ in range(5):
            unstable = [i for i, r in enumerate(ar) if _DEADLY.search(r.stderr) and not _ASAN_ERR.search(r.stderr)]
            if not unstable:
                break
            again = await run_batch(sb, "asan", [inputs[i] for i in unstable], limits, fsize_mb=2)
            for k, i in enumerate(unstable):
                ar[i] = again[k]
        if unstable:
            log({"kind": "warn", "msg": f"sanitizer_run: ASan could not start on {len(unstable)} input(s) after 5 "
                                        "attempts (toolchain issue); those inputs rely on valgrind only"})

        for i, r in enumerate(ar):
            m = _ASAN_KIND.search(r.stderr)
            if m:
                issue = {"tool": "AddressSanitizer", "kind": m.group(1), "input": _short_input(inputs[i])}
                issues.append(_with_where(issue, _ASAN_LOC.search(r.stderr)))
            ub = _UB.search(r.stderr)
            if ub:
                ub_notes.append({"tool": "UBSan", "line": int(ub.group(1)), "message": trim_ws(ub.group(2)),
                                 "input": _short_input(inputs[i])})
        log({"kind": "tool", "msg": f"sanitizer_run: ASan/UBSan over {len(inputs)} inputs -> {len(issues)} memory "
                                    f"error(s), {len(ub_notes)} UB note(s)"})

        leak_bytes, uninit = 0, False
        has_valgrind = (await sb.sh("valgrind --version", timeout_s=10)).code == 0
        if has_valgrind:
            await compile(sb, ctx.source, "plain", "-O0 -g -std=c11")
            await sb.write_file("vg", VG_SCRIPT)
            await sb.sh("chmod +x vg", timeout_s=5)
            vg_inputs = inputs[:8]
            vr = await run_batch(sb, "vg", vg_inputs,
                                 {"time_limit_s": max(10, ctx.time_limit_s * 20), "memory_limit_mb": 0})
            for i, r in enumerate(vr):
                lost = sum(int(m.group(1).replace(",", "")) for m in _LOST.finditer(r.stderr))
                if lost > 0:
                    leak_bytes = max(leak_bytes, lost)
                    issue = {"tool": "valgrind", "kind": "memory-leak", "bytes": lost,
                             "input": _short_input(vg_inputs[i])}
                    issues.append(_with_where(issue, _LOST_AT.search(r.stderr)))
                inv = _INVALID.search(r.stderr)
                if inv:
                    issues.append({"tool": "valgrind", "kind": f"invalid-{inv.group(1)}",
                                   "input": _short_input(vg_inputs[i])})
                if _UNINIT.search(r.stderr):
                    uninit = True
            if uninit:
                issues.append({"tool": "valgrind", "kind": "uninitialised-read"})
            log({"kind": "tool", "msg": f"sanitizer_run: valgrind memcheck over {len(vg_inputs)} inputs -> leak "
                                        f"{leak_bytes} bytes{', uninitialised read' if uninit else ''}"})

        mem_kinds = list(dict.fromkeys(
            _OOB.sub("out-of-bounds", x["kind"]) for x in issues
            if x["kind"] not in ("memory-leak", "uninitialised-read")
        ))
        score = 1 - 0.5 * len(mem_kinds) - (0.3 if leak_bytes > 0 else 0) - (0.2 if uninit else 0)
        score = round3(max(0, score))

        unique: list[dict] = []
        seen: set[str] = set()
        for x in issues:
            k = f"{x['tool']}:{x['kind']}"
            if k not in seen:
                seen.add(k)
                unique.append(x)
        sugg = []
        if leak_bytes:
            sugg.append(f"Free every block you malloc() (valgrind found {leak_bytes} bytes definitely lost).")
        if mem_kinds:
            sugg.append(f"Fix the memory error(s): {', '.join(mem_kinds)}; check array indices against the array size.")
        if uninit:
            sugg.append("Initialise variables before reading them.")

        if unique:
            feedback = "Memory issues: " + "; ".join(
                x["kind"] + (f" at {x['where']}" if x.get("where") else "") for x in unique) + "."
        else:
            feedback = f"ASan{' and valgrind' if has_valgrind else ''} clean on {len(inputs)} inputs."
            if ub_notes:
                feedback += f" (UB noted: {ub_notes[0]['message']})"
        return {
            "score": score,
            "evidence": {"inputs_checked": len(inputs), "valgrind": has_valgrind, "issues": unique,
                         "undefined_behaviour_notes": ub_notes[:5]},
            "feedback": feedback,
            "suggestions": sugg,
        }


ANALYZER = SanitizerRun()
