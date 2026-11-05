"""Helpers shared by the analyzers: compile, run, batch runs, output comparison."""
from __future__ import annotations

import math
import re
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass

from ..textfmt import trim_ws, round3  # noqa: F401  (round3 is re-exported for the analyzers)
from ..sandbox.base import safe_flags, signal_name

BASE_FLAGS = "-O2 -std=c11"
DEFAULT_KILL_ALL = ":"


@dataclass
class CompileResult:
    ok: bool
    stderr: str
    warnings: int
    errors: int


@dataclass
class CaseResult:
    """One program run as the analyzers see it; stdout/stderr are already decoded."""
    status: str
    code: int
    stdout: str
    stderr: str
    ms: int
    signal: int | None = None
    label: str = ""
    truncated: bool = False

    @property
    def timed_out(self) -> bool:
        return self.status == "timeout"

    def to_dict(self) -> dict:
        return asdict(self)


def _limit(limits: dict | None, key: str, default=None):
    if not limits:
        return default
    v = limits.get(key)
    return default if v is None else v


async def compile(sb, source: str, bin: str, flags: str = BASE_FLAGS, *, libs: str = "-lm") -> CompileResult:
    await sb.write_file(f"{bin}.c", source)
    r = await sb.sh(f"gcc {safe_flags(flags)} -o {bin} {bin}.c {libs} 2>&1", timeout_s=60)
    out = r.out
    return CompileResult(ok=r.code == 0, stderr=out, warnings=out.count("warning:"), errors=out.count("error:"))


def describe_status(r) -> str:
    if r.status == "timeout":
        return "time limit exceeded (killed)"
    if r.status == "crash":
        return f"crashed with {signal_name(r.signal)}"
    if r.status == "nonzero_exit":
        return f"exited with code {r.code}"
    return "ok"


async def run_one(sb, bin: str, input: str | bytes | None, limits: dict, *, env: dict | None = None) -> CaseResult:
    t = _limit(limits, "time_limit_s", 1)
    data = input.encode("utf-8") if isinstance(input, str) else input
    r = await sb.sh(f"./{bin}", input=data, timeout_s=t, mem_mb=_limit(limits, "memory_limit_mb", 0),
                    cpu_s=t, env=env if env is not None else _limit(limits, "env"))
    res = CaseResult(status=r.status, code=r.code, stdout=r.out, stderr=r.err, ms=r.ms, signal=r.signal,
                     truncated=r.truncated)
    res.label = describe_status(res)
    return res


def batch_script(bin: str, count: int, time_limit_s: float, memory_limit_mb: float = 0,
                 fsize_mb: float = 16, kill_all: str = "kill -9 -1 2>/dev/null") -> str:
    """Shell loop over cases/<i>.in. Each case is reported as a header line with byte counts
    followed by exactly that many bytes of stdout and stderr, so nothing the program prints
    can be mistaken for a header."""
    t = max(1, math.ceil(time_limit_s))
    as_limit = f"--as={math.floor(memory_limit_mb * 1024 * 1024)} " if memory_limit_mb > 0 else ""
    return "\n".join([
        "rm -rf cases && mkdir cases",
        "awk '/^@@CASE [0-9]+$/{ if (f) close(f); f=\"cases/\" $2 \".in\"; printf \"\" > f; next } { print >> f }' bundle.txt",
        "i=0",
        f"while [ $i -lt {count} ]; do",
        "  s=$(date +%s%N)",
        (f"  timeout -s KILL {t} prlimit {as_limit}--cpu={t} --fsize={math.floor(fsize_mb * 1024 * 1024)} "
         f"-- ./{bin} < cases/$i.in > cases/$i.out 2> cases/$i.err"),
        "  rc=$?",
        "  e=$(date +%s%N)",
        f"  {kill_all}",
        "  head -c 4194304 cases/$i.out > cases/o; head -c 2048 cases/$i.err > cases/e",
        '  echo "@@CASE $i $rc $(( (e - s) / 1000000 )) $(( $(wc -c < cases/o) )) $(( $(wc -c < cases/e) ))"',
        "  cat cases/o cases/e",
        "  i=$((i+1))",
        "done",
        f'echo "@@DONE {count}"',
    ])


def make_bundle(inputs: list[str]) -> str:
    return "".join(f"@@CASE {i}\n{inp if inp.endswith(chr(10)) else inp + chr(10)}" for i, inp in enumerate(inputs))


async def run_batch(sb, bin: str, inputs: list[str], limits: dict, *, env: dict | None = None,
                    fsize_mb: float | None = None) -> list[CaseResult]:
    """Run every input in one sandbox call; each case gets its own timeout/prlimit."""
    if not inputs:
        return []
    time_limit_s = _limit(limits, "time_limit_s", 1)
    await sb.write_file("bundle.txt", make_bundle(inputs))
    script = batch_script(
        bin, len(inputs), time_limit_s,
        memory_limit_mb=_limit(limits, "memory_limit_mb", 0) or 0,
        fsize_mb=fsize_mb if fsize_mb is not None else _limit(limits, "fsize_mb", 16),
        kill_all=getattr(sb, "kill_all", DEFAULT_KILL_ALL),
    )
    t = max(1, math.ceil(time_limit_s))
    total_budget = len(inputs) * (t + 1) + 30
    r = await sb.sh(script, timeout_s=total_budget, env=env if env is not None else _limit(limits, "env"))
    cut = bool(r.timed_out or getattr(r, "truncated", False) or getattr(r, "host_killed", False))
    return parse_batch(r.stdout, len(inputs), time_limit_s, exit_code=None if cut else r.code)


_HEADER = re.compile(rb"@@CASE (\d+) (-?\d+) (-?\d+) (\d+) (\d+)\n", re.ASCII)


def _missing(why: str = "sandbox did not return this case") -> CaseResult:
    return CaseResult(status="error", code=-1, stdout="", stderr=why, ms=0, label="harness error")


def _case(code_f: float, ms_f: float, out: bytes, err: bytes, time_limit_s: float) -> CaseResult:
    if code_f == 137 and ms_f >= time_limit_s * 1000 * 0.8:
        status = "timeout"
    elif code_f >= 128:
        status = "crash"
    elif code_f != 0:
        status = "nonzero_exit"
    else:
        status = "ok"
    code = -1 if math.isnan(code_f) else int(code_f)
    stdout = out.decode("utf-8", errors="replace").removesuffix("\n")
    res = CaseResult(status=status, code=code, stdout=stdout, stderr=err.decode("utf-8", errors="replace"),
                     ms=0 if math.isnan(ms_f) else int(ms_f), signal=code - 128 if status == "crash" else None)
    res.label = describe_status(res)
    return res


def parse_batch(data: bytes | str, count: int, time_limit_s: float, *, exit_code: int | None = 0) -> list[CaseResult]:
    """Read the frames written by batch_script, strictly in order.

    exit_code is the shell's exit status, or None when the run was cut short
    (timeout or output cap); then the frames read so far are kept and the rest
    are reported missing. Otherwise anything unexpected (frames out of order,
    extra bytes, no trailer, a non-zero exit) means the program wrote into the
    harness stream, and every case is reported as a harness error.
    """
    raw = data.encode("utf-8") if isinstance(data, str) else data
    results: list[CaseResult] = []
    pos = 0
    clean = True
    while len(results) < count:
        m = _HEADER.match(raw, pos)
        if not m or int(m.group(1)) != len(results):
            clean = False
            break
        n_out, n_err = int(m.group(4)), int(m.group(5))
        body = m.end()
        if body + n_out + n_err > len(raw):
            clean = False
            break
        out, err = raw[body:body + n_out], raw[body + n_out:body + n_out + n_err]
        results.append(_case(float(m.group(2)), float(m.group(3)), out, err, time_limit_s))
        pos = body + n_out + n_err
    if exit_code is None:
        return results + [_missing() for _ in range(count - len(results))]
    if not (clean and exit_code == 0 and raw[pos:] == f"@@DONE {count}\n".encode()):
        return [_missing("the batch output was not in the expected form (tampered with or interrupted)")
                for _ in range(count)]
    return results


_TRAIL_WS = re.compile(r"[ \t]+$")
_TRAIL_NL = re.compile(r"\n+$")


def normalize_output(s) -> str:
    t = "" if s is None else str(s)
    t = t.replace("\r\n", "\n")
    t = "\n".join(_TRAIL_WS.sub("", line) for line in t.split("\n"))
    return _TRAIL_NL.sub("", t)


def outputs_match(expected, got) -> bool:
    return normalize_output(expected) == normalize_output(got)


_UB_RE = re.compile(r"runtime error: ([^\n]+)")


async def diagnoser(sb, source: str, limits: dict) -> Callable[[str], Awaitable[str | None]]:
    """Returns diagnose(input): the first UBSan "runtime error" for that input, or None."""
    ready: bool | None = None

    async def diagnose(input: str) -> str | None:
        nonlocal ready
        if ready is None:
            c = await compile(sb, source, "diag", "-O0 -g -std=c11 -fsanitize=undefined -fno-sanitize-recover=undefined")
            ready = c.ok
        if not ready:
            return None
        r = await run_one(sb, "diag", input, {**limits, "memory_limit_mb": 0},
                          env={"UBSAN_OPTIONS": "print_stacktrace=0"})
        m = _UB_RE.search(r.stderr)
        return f"runtime error: {trim_ws(m.group(1))}" if m else None

    return diagnose


def _short(s) -> str:
    t = normalize_output(s)
    return f"{t[:80]}..." if len(t) > 80 else t


def explain_failure(*, status: str | None = None, signal_label: str | None = None, expected=None, got=None,
                    ub: str | None = None, why: str | None = None) -> str:
    parts = []
    if why:
        parts.append(f"This input tests: {why}.")
    if status == "timeout":
        parts.append("The program did not finish within the time limit: likely an infinite loop or an algorithm "
                     "that is too slow for this input.")
    elif status == "crash":
        parts.append(f"The program {signal_label}; check array bounds, NULL pointers and how many items are read.")
    elif status == "nonzero_exit":
        parts.append("The program exited with a non-zero status; main() should return 0 on success.")
    if ub:
        parts.append(f'The sanitizer reports "{ub}".')
    if "signed integer overflow" in (ub or ""):
        parts.append("The result does not fit in a 32-bit int: use long long, or check the operands before computing.")
    if status == "ok" and normalize_output(got) == "":
        parts.append("The program printed nothing for this input.")
    elif status == "ok" and expected is not None:
        parts.append(f'Expected "{_short(expected)}" but the program printed "{_short(got)}".')
    return " ".join(parts)


def clip(s, max: int = 400, where: str = "") -> str:
    t = "" if s is None else str(s)
    if len(t) <= max:
        return t
    more = f"; full text in {where}" if where else ""
    return f"{t[:max]}\n... ({len(t) - max} more characters{more})"


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def reference_sandbox(ctx):
    """A separate sandbox for the instructor's reference solution.

    The student's program must never share a sandbox with the reference: a submission could
    otherwise exec ./ref or read ref.c and copy its answers. Use as
    `async with reference_sandbox(ctx) as rsb:` and call ref_build(rsb, ctx) first.
    """
    from ..sandbox.select import sandbox_ctx
    return sandbox_ctx(ctx.settings, ctx.limits)


async def ref_build(rsb, ctx) -> None:
    c = await compile(rsb, ctx.reference, "ref", BASE_FLAGS)
    if not c.ok:
        raise RuntimeError(f"reference solution does not compile:\n{c.stderr}")
