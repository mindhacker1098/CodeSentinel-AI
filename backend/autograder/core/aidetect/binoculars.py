"""Optional Binoculars score (Hans et al., 2024) with llama-cpp-python.

score = log-perplexity of the text under the performer model divided by the
cross-perplexity between observer and performer. Low values (below about
0.9) suggest machine-generated text. Both models must share a tokenizer.
Returns None unless llama_cpp is installed and both GGUF paths are set.
"""
from __future__ import annotations

import asyncio
import math
from functools import lru_cache
from pathlib import Path

MAX_TOKENS = 1024


def available(settings) -> bool:
    try:
        import llama_cpp  # noqa: F401
    except ImportError:
        return False
    obs, perf = settings.BINOCULARS_OBSERVER, settings.BINOCULARS_PERFORMER
    return bool(obs and perf and Path(obs).is_file() and Path(perf).is_file())


@lru_cache(maxsize=2)
def _model(path: str):
    from llama_cpp import Llama

    return Llama(model_path=path, n_ctx=MAX_TOKENS + 8, logits_all=True, verbose=False)


def _log_softmax(row: list[float]) -> list[float]:
    m = max(row)
    s = math.log(sum(math.exp(x - m) for x in row)) + m
    return [x - s for x in row]


def _logits(llm, tokens: list[int]) -> list[list[float]]:
    llm.reset()
    llm.eval(tokens)
    return [list(map(float, llm.scores[i])) for i in range(len(tokens))]


def score_sync(source: str, observer_path: str, performer_path: str) -> float | None:
    observer, performer = _model(observer_path), _model(performer_path)
    tokens = observer.tokenize(source.encode("utf-8"))[:MAX_TOKENS]
    if len(tokens) < 8:
        return None
    obs = _logits(observer, tokens)
    perf = _logits(performer, tokens)
    ppl = xppl = 0.0
    n = len(tokens) - 1
    for i in range(n):
        lp_perf = _log_softmax(perf[i])
        lp_obs = _log_softmax(obs[i])
        ppl -= lp_perf[tokens[i + 1]]
        xppl -= sum(math.exp(o) * p for o, p in zip(lp_obs, lp_perf))
    if xppl <= 0:
        return None
    return (ppl / n) / (xppl / n)


async def score(source: str, settings) -> float | None:
    if not available(settings):
        return None
    try:
        s = await asyncio.to_thread(score_sync, source, settings.BINOCULARS_OBSERVER, settings.BINOCULARS_PERFORMER)
    except Exception:  # noqa: BLE001
        return None
    return None if s is None else math.floor(s * 1000 + 0.5) / 1000
