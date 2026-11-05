"""Check proposed correctness edits without changing the submitted source or grade."""
from __future__ import annotations

from pathlib import Path

from .analyzers.common import compile, outputs_match, run_batch
from .problemcheck import tests_dir
from .sandbox.select import pin_settings, sandbox_ctx


async def verify_repair(problem_dir: Path, rules: dict, original: str, candidate: str, settings) -> dict:
    settings = await pin_settings(settings)
    if settings.SANDBOX != "docker":
        return {"verified": False, "reason": "Proposed edits require Docker verification."}
    folder = tests_dir(problem_dir, rules)
    files = sorted(folder.glob("*.in"))[:20]
    if not files or any(not path.with_suffix(".out").is_file() for path in files):
        return {"verified": False, "reason": "No complete input/output tests are available for edit verification."}
    if sum(path.stat().st_size + path.with_suffix(".out").stat().st_size for path in files) > 4 * 1024 * 1024:
        return {"verified": False, "reason": "Test data exceeds the edit verification budget."}
    inputs = [path.read_text(encoding="utf-8") for path in files]
    expected = [path.with_suffix(".out").read_text(encoding="utf-8") for path in files]
    limits = {"time_limit_s": min(3, rules.get("time_limit_s", 1)),
              "memory_limit_mb": rules.get("memory_limit_mb", 64)}

    async def passed(source: str) -> list[bool] | None:
        # No reference source, reference executable, or expected answers enter this container.
        async with sandbox_ctx(settings, limits) as sandbox:
            built = await compile(sandbox, source, "candidate")
            if not built.ok:
                return None
            results = await run_batch(sandbox, "candidate", inputs, limits)
        if any(result.status == "error" for result in results):
            return None
        return [result.status == "ok" and outputs_match(answer, result.stdout)
                for result, answer in zip(results, expected)]

    before, after = await passed(original), await passed(candidate)
    if before is None or after is None:
        return {"verified": False, "reason": "A proposed edit or its baseline could not be tested."}
    verified = sum(after) > sum(before) and all(not old or new for old, new in zip(before, after))
    return {"verified": verified, "tests_total": len(files), "passed_before": sum(before),
            "passed_after": sum(after)}
