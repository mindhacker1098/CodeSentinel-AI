"""Generate the LLM-copy corpus for a problem (corpus/llm/*.c).

4 prompts x temperatures x seeds per model through Ollama. A program is kept
only if it compiles, passes the published tests, and is not a near-duplicate (containment
above 0.95) of one already in the corpus. Responses go through the normal
LLM cache, so rerunning with the same parameters costs nothing.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..analyzers.common import BASE_FLAGS, compile, outputs_match, run_batch
from ..corpus import read_text
from ..llm import call_model
from ..sandbox.select import sandbox_ctx
from ..similarity import containment, fingerprints

SYSTEM = "You are a C programmer. Reply with one complete C11 program in a single ```c code block and nothing else."

PROMPTS = [
    "Solve this programming problem in C. Read from stdin and write to stdout.\n\n{statement}",
    "Write a C program for the following assignment. Keep it simple, like a first-year student would.\n\n{statement}",
    "Write a clean, well-commented C solution with helper functions for this task.\n\n{statement}",
    "I need a C program that passes all test cases for this problem. Handle edge cases.\n\n{statement}",
]
TEMPERATURES = [0.2, 0.7, 1.0]
SEEDS = [1001, 1002]
DEDUPE = 0.95

_FENCE = re.compile(r"```(?:c|C|cpp)?[ \t]*\n(.*?)```", re.DOTALL)


def model_slug(model: str) -> str:
    return re.sub(r"[^A-Za-z0-9.]+", "_", model).strip("_")


def temp_slug(t: float) -> str:
    return f"{t:g}".replace(".", "")


def extract_code(text: str) -> str | None:
    m = _FENCE.search(text or "")
    code = m.group(1) if m else text
    if not code or "main" not in code:
        return None
    return code.strip() + "\n"


async def generate(problem_dir: str | Path, params: dict | None = None, settings=None, log=None) -> list[dict]:
    """Returns one entry per request: {file, model, prompt_id, temperature, seed, compiles, kept, reason}."""
    from ...config import get_settings

    settings = settings or get_settings()
    params = params or {}
    log = log or (lambda e: None)
    problem_dir = Path(problem_dir)
    statement_path = problem_dir / "problem.md"
    statement = read_text(statement_path) if statement_path.exists() else problem_dir.name
    out_dir = problem_dir / "corpus" / "llm"
    out_dir.mkdir(parents=True, exist_ok=True)

    models = params.get("models") or [settings.MODEL_PRE]
    prompt_ids = params.get("prompts") or list(range(1, len(PROMPTS) + 1))
    temps = params.get("temps") or TEMPERATURES
    seeds = params.get("seeds") or SEEDS

    kept = [fingerprints(read_text(p)) for p in sorted(out_dir.glob("*.c"))]
    entries = []
    async with sandbox_ctx(settings, 256, log) as sb:
        from ..problemcheck import tests_dir
        rules = json.loads((problem_dir / "rules.json").read_text(encoding="utf-8"))
        test_files = sorted(tests_dir(problem_dir, rules).glob("*.in"))
        if not test_files:
            raise ValueError("Comparison generation requires published test inputs")
        reference = read_text(problem_dir / rules["reference_solution"])
        if not (await compile(sb, reference, "reference", BASE_FLAGS)).ok:
            raise ValueError("Reference does not compile; comparison generation stopped")
        limits = {"time_limit_s": rules.get("time_limit_s", 1), "memory_limit_mb": rules.get("memory_limit_mb", 64)}
        inputs = [read_text(path) for path in test_files]
        expected = await run_batch(sb, "reference", inputs, limits)
        if any(run.status != "ok" for run in expected):
            raise ValueError("Reference failed its test suite; comparison generation stopped")
        for model in models:
            for k in prompt_ids:
                prompt = PROMPTS[k - 1].format(statement=statement.strip())
                for t in temps:
                    for seed in seeds:
                        name = f"{model_slug(model)}_p{k}_t{temp_slug(t)}_s{seed}.c"
                        entry = {"file": name, "model": model, "prompt_id": k, "temperature": t, "seed": seed,
                                 "compiles": False, "kept": False, "reason": ""}
                        entries.append(entry)
                        # Existing samples are compiled and tested again against this problem version.
                        existing = (out_dir / name).exists()
                        try:
                            res = {"text": read_text(out_dir / name)} if existing else await call_model(SYSTEM, prompt, {"provider": "ollama", "model": model,
                                                                    "temperature": t, "seed": seed},
                                                   json=False, max_tokens=1200, log=log, settings=settings)
                        except Exception as e:  # noqa: BLE001
                            entry["reason"] = f"model error: {e}"
                            continue
                        code = extract_code(res["text"])
                        if code is None:
                            entry["reason"] = "no C program in the reply"
                            continue
                        c = await compile(sb, code, "gen", BASE_FLAGS)
                        entry["compiles"] = c.ok
                        if not c.ok:
                            entry["reason"] = "does not compile"
                            if existing:
                                rejected = problem_dir / "rejected_comparisons"
                                rejected.mkdir(exist_ok=True)
                                (out_dir / name).replace(rejected / name)
                            continue
                        runs = await run_batch(sb, "gen", inputs, limits)
                        if any(run.status != "ok" or not outputs_match(ref.stdout, run.stdout)
                               for ref, run in zip(expected, runs)):
                            entry["reason"] = "does not pass the published test suite"
                            if existing:
                                rejected = problem_dir / "rejected_comparisons"
                                rejected.mkdir(exist_ok=True)
                                (out_dir / name).replace(rejected / name)
                            continue
                        entry["tests_passed"] = len(inputs)
                        if existing:
                            entry.update(kept=True, reason="existing sample passed current tests")
                            continue
                        fp = fingerprints(code)
                        if not existing and any(containment(fp, other) > DEDUPE for other in kept):
                            entry["reason"] = "near-duplicate"
                            continue
                        kept.append(fp)
                        header = (f"// Generated by ollama/{model} (prompt {k}, temperature {t:g}, seed {seed}) "
                                  "for the LLM-copy corpus.\n")
                        (out_dir / name).write_text(header + code, "utf-8", newline="")
                        entry.update(kept=True, reason="kept")
                        log({"kind": "ok", "msg": f"corpus-gen: wrote {name}"})
    return entries
