"""LLM calls (Ollama or Groq) with a disk cache, so the same prompt always gives the same answer."""
from __future__ import annotations

import asyncio
import json as _json
import os
import re
import weakref
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from ..config import Settings, get_settings
from .hashing import sha256
from .textfmt import dump_json, number_text, trim_ws
from .manifest import check_permission

LogFn = Callable[[dict], None]

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile"

_locks: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()


class LLMError(RuntimeError):
    pass


class LLMDisabled(LLMError):
    pass


def _groq_key(settings: Settings) -> str:
    return settings.GROQ_API_KEY or os.environ.get("GROQ_API_KEY", "")


def default_model(settings: Settings) -> str:
    return os.environ.get("OLLAMA_MODEL") or settings.MODEL_REVIEW


def resolve_model(params: dict | None = None, settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    params = params or {}
    provider = str(params.get("provider") or "ollama").lower()
    if provider == "groq":
        if _groq_key(settings):
            return {"provider": "groq", "model": params.get("model") or GROQ_DEFAULT_MODEL}
        return {
            "provider": "ollama",
            "model": default_model(settings),
            "note": "groq requested but GROQ_API_KEY not set; used local model",
        }
    return {"provider": "ollama", "model": params.get("model") or default_model(settings)}


def cache_key(provider: str, model: str, temperature: Any, seed: Any, system: str, user: str,
              json_mode: bool, max_tokens: int) -> str:
    """sha256 of JSON.stringify({provider,model,temperature,seed,system,user,json,maxTokens})."""
    payload = {
        "provider": provider, "model": model, "temperature": temperature, "seed": seed,
        "system": system, "user": user, "json": json_mode, "maxTokens": max_tokens,
    }
    return sha256(dump_json(payload))


def _semaphore(settings: Settings) -> asyncio.Semaphore | None:
    if settings.LLM_PROFILE != "laptop":
        return None
    loop = asyncio.get_running_loop()
    sem = _locks.get(loop)
    if sem is None:
        sem = _locks[loop] = asyncio.Semaphore(1)
    return sem


async def _post_ollama(settings: Settings, model: str, system: str, user: str, temperature: Any, seed: Any,
                       json_mode: bool, max_tokens: int) -> str:
    body: dict[str, Any] = {"model": model, "stream": False}
    if json_mode:
        body["format"] = "json"
    body["options"] = {"temperature": temperature, "seed": seed, "num_predict": max_tokens,
                       "num_ctx": settings.OLLAMA_NUM_CTX}
    body["messages"] = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(f"{settings.OLLAMA_HOST.rstrip('/')}/api/chat", json=body)
    if r.status_code >= 400:
        raise LLMError(f'Ollama {r.status_code}: {r.text[:200]} (is "ollama serve" running and the model pulled?)')
    return ((r.json().get("message") or {}).get("content")) or ""


async def _post_groq(settings: Settings, model: str, system: str, user: str, temperature: Any, seed: Any,
                     json_mode: bool, max_tokens: int) -> str:
    body: dict[str, Any] = {
        "model": model, "temperature": temperature, "seed": seed, "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    headers = {"Authorization": f"Bearer {_groq_key(settings)}"}
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(GROQ_URL, json=body, headers=headers)
    if r.status_code >= 400:
        raise LLMError(f"Groq {r.status_code}: {r.text[:200]}")
    choices = r.json().get("choices") or [{}]
    return ((choices[0].get("message") or {}).get("content")) or ""


async def model_identity(settings: Settings, provider: str, model: str) -> str | None:
    """A mutable model name is not a cache identity. Unknown identities disable reuse."""
    if provider != "ollama":
        return None
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(settings.OLLAMA_HOST.rstrip("/") + "/api/tags")
            response.raise_for_status()
        name = model if ":" in model else model + ":latest"
        return next((m.get("digest") for m in response.json().get("models", [])
                     if m.get("name") in (model, name)), None)
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        return None


async def call_model(system: str, user: str, params: dict | None = None, json: bool = True,
                     max_tokens: int = 600, log: LogFn | None = None, *,
                     settings: Settings | None = None, cache_dir: str | Path | None = None) -> dict:
    """Ask the model once; identical requests are answered from the disk cache.

    Returns {provider, model, temperature, seed, text, note?, cached}.
    """
    settings = settings or get_settings()
    params = params or {}
    resolved = resolve_model(params, settings)
    provider, model, note = resolved["provider"], resolved["model"], resolved.get("note")
    temperature = params.get("temperature")
    temperature = 0 if temperature is None else temperature
    seed = params.get("seed")
    seed = 42 if seed is None else seed
    if settings.LLM_DISABLED:
        raise LLMDisabled("LLM calls are disabled (LLM_DISABLED); unverified historical cache entries are not used")
    check_permission("llm:remote" if provider == "groq" else "llm:local", log)
    identity = await model_identity(settings, provider, model)
    key = cache_key(provider, model, temperature, seed, system, user, json, max_tokens)
    key = sha256(dump_json({"version": 2, "request": key, "model_digest": identity,
                               "endpoint": settings.OLLAMA_HOST, "num_ctx": settings.OLLAMA_NUM_CTX}))
    folder = Path(cache_dir) if cache_dir else settings.LLM_CACHE_DIR
    file = folder / f"{key}.json"

    check_permission("fs:read", log)
    if identity and file.is_file():
        hit = _json.loads(file.read_text("utf-8"))
        if log:
            log({"kind": "llm", "msg": f"LLM cache hit ({provider}/{model}, key {key[:10]}): identical response reused"})
        return {**hit, "cached": True}

    if log:
        log({"kind": "llm", "msg": f"calling {provider}/{model} (temperature {_num(temperature)}, seed {_num(seed)})"})

    post = _post_groq if provider == "groq" else _post_ollama
    sem = _semaphore(settings)
    try:
        if sem is None:
            text = await post(settings, model, system, user, temperature, seed, json, max_tokens)
        else:
            async with sem:
                text = await post(settings, model, system, user, temperature, seed, json, max_tokens)
    except httpx.HTTPError as e:
        raise LLMError(f"{provider} request failed: {e!r}") from e

    record: dict[str, Any] = {"provider": provider, "model": model, "model_digest": identity, "temperature": temperature,
                              "seed": seed, "text": text}
    if note:
        record["note"] = note
    if not identity or identity != await model_identity(settings, provider, model):
        return {**record, "cached": False}
    check_permission("fs:write", log)
    folder.mkdir(parents=True, exist_ok=True)
    tmp = file.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(dump_json(record, indent=2), "utf-8", newline="")
    os.replace(tmp, file)
    return {**record, "cached": False}


def _num(x: Any) -> str:
    return x if isinstance(x, str) else number_text(x)


def extract_json(text: Any) -> Any:
    """Parse the JSON object in a model reply; local models sometimes wrap it in ``` or prose."""
    cleaned = trim_ws(re.sub(r"```json|```", "", str(text)))
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return _json.loads(cleaned[start:end + 1])


async def ollama_status(settings: Settings | None = None) -> dict:
    settings = settings or get_settings()
    model = default_model(settings)
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            r = await client.get(f"{settings.OLLAMA_HOST.rstrip('/')}/api/tags")
        if r.status_code >= 400:
            return {"running": False, "models": []}
        models = [m.get("name") for m in (r.json().get("models") or [])]
        return {"running": True, "models": models, "defaultModel": model, "defaultAvailable": model in models}
    except (httpx.HTTPError, ValueError):
        return {"running": False, "models": [], "defaultModel": model, "defaultAvailable": False}
