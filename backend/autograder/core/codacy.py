"""Codacy static analysis of one submission (lizard + opengrep through codacy-cli v2).

Local mode (default) copies the template in sandbox/codacy/.codacy and the
source into a fresh /tmp/agc-<uuid> directory (inside WSL on Windows, native
on Linux), runs `codacy-cli analyze --format sarif`, parses the SARIF and
deletes the directory. The code is only parsed, never compiled or run.

Cloud mode only reads issues Codacy already computed for a file in a
repository connected to Codacy (see README, "Codacy"). It is never required.

Results are cached on disk by source, template, tool versions and mode, so a
submission always gets the same findings.
"""
from __future__ import annotations

import io
import json
import os
import re
import shlex
import sys
import tarfile
import uuid
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
import yaml

from ..config import PROJECT_ROOT, Settings, get_settings
from .hashing import sha256
from .textfmt import dump_json
from .sandbox.proc import run_process

LogFn = Callable[[dict], None]

API_URL = "https://app.codacy.com/api/v3"
CLOUD_FILE_PATH = "submissions/{sha256}.c"
MAX_PAGES = 20
SARIF_CAP = 4 * 1024 * 1024

_LEVELS = {"error": "Error", "high": "Error", "critical": "Error", "warning": "Warning", "medium": "Warning",
           "note": "Info", "info": "Info", "low": "Info", "none": "Info", "minor": "Info"}
_LIZARD_NAME = re.compile(r"^(?:Method|Function) \S+ ")
_RULE_PREFIX = re.compile(r"^.*?tools-configs\.")
_versions: dict[tuple, dict] = {}


def _noop(_e: dict) -> None:
    pass


def norm_level(v: Any) -> str:
    return _LEVELS.get(str(v or "").strip().lower(), "Info")


def first_sentence(text: Any, limit: int = 200) -> str:
    s = " ".join(str(text or "").split())
    m = re.search(r"(?<=[.!?])\s", s[20:])
    if m:
        s = s[:20 + m.start()]
    return s[:limit]


def template_dir(settings: Settings) -> Path:
    p = Path(settings.CODACY_TEMPLATE_DIR)
    p = p if p.is_absolute() else PROJECT_ROOT / p
    return p / ".codacy" if (p / ".codacy").is_dir() else p


def template_files(settings: Settings) -> dict[str, bytes]:
    root = template_dir(settings)
    out = {}
    for f in sorted(root.rglob("*")):
        rel = f.relative_to(root).as_posix()
        if f.is_file() and not rel.startswith("logs/"):
            out[rel] = f.read_bytes()
    return out


def template_hash(files: dict[str, bytes]) -> str:
    return sha256(dump_json([[k, sha256(v)] for k, v in sorted(files.items())]))


def pinned_tools(files: dict[str, bytes]) -> dict[str, str]:
    """Tool versions pinned in codacy.yaml, e.g. {"lizard": "1.17.31", "opengrep": "1.16.4"}."""
    conf = yaml.safe_load(files.get("codacy.yaml", b"") or b"{}") or {}
    out = {}
    for t in conf.get("tools") or []:
        name, _, ver = str(t).partition("@")
        out[name] = ver
    return out


@lru_cache(maxsize=8)
def _rule_meta_cached(semgrep: bytes, lizard: bytes) -> dict[str, dict]:
    meta: dict[str, dict] = {}
    for r in (yaml.safe_load(semgrep or b"{}") or {}).get("rules") or []:
        md = r.get("metadata") or {}
        meta[r["id"]] = {"level": norm_level(r.get("severity")),
                         "category": str(md.get("category") or "security").capitalize(),
                         "message": first_sentence(r.get("message"))}
    for pid, p in ((yaml.safe_load(lizard or b"{}") or {}).get("patterns") or {}).items():
        meta[pid] = {"level": norm_level(p.get("level")), "category": p.get("category") or "Complexity",
                     "message": None}
    return meta


def rule_meta(files: dict[str, bytes]) -> dict[str, dict]:
    return _rule_meta_cached(files.get("tools-configs/semgrep.yaml", b""), files.get("tools-configs/lizard.yaml", b""))


def _tool_name(driver_name: str) -> str:
    n = driver_name.lower()
    if "opengrep" in n or "semgrep" in n:
        return "opengrep"
    return n.split()[0] if n else "unknown"


def parse_sarif(text: str, meta: dict[str, dict]) -> tuple[list[dict], dict[str, str]]:
    """Issues and tool versions from codacy-cli SARIF.

    Messages come from the rule template where possible; SARIF snippets (student
    code) are dropped and lizard's function names are removed.
    """
    data = json.loads(text)
    issues, versions = [], {}
    for run in data.get("runs") or []:
        driver = (run.get("tool") or {}).get("driver") or {}
        tool = _tool_name(driver.get("name") or "")
        ver = driver.get("version") or driver.get("semanticVersion")
        if ver:
            versions[tool] = ver
        for r in run.get("results") or []:
            rule = _RULE_PREFIX.sub("", r.get("ruleId") or "")
            m = meta.get(rule, {})
            locs = r.get("locations") or [{}]
            region = (locs[0].get("physicalLocation") or {}).get("region") or {}
            msg = m.get("message") or first_sentence((r.get("message") or {}).get("text"))
            if tool == "lizard":
                msg = _LIZARD_NAME.sub("Function ", msg)
            issues.append({
                "tool": tool,
                "rule": rule,
                "level": norm_level(r.get("level")) if r.get("level") else m.get("level", "Info"),
                "category": m.get("category") or ("Complexity" if tool == "lizard" else "Security"),
                "line": int(region.get("startLine") or 0),
                "message": msg,
            })
    return sort_issues(issues), versions


def sort_issues(issues: list[dict]) -> list[dict]:
    seen, out = set(), []
    for i in sorted(issues, key=lambda i: (i["line"], i["tool"], i["rule"], i["message"])):
        key = (i["line"], i["tool"], i["rule"], i["message"])
        if key not in seen:
            seen.add(key)
            out.append(i)
    return out


def _cli_shell(settings: Settings) -> str:
    cli = settings.CODACY_CLI.strip()
    if cli.startswith("~/"):
        return '"$HOME"/' + shlex.quote(cli[2:])
    return shlex.quote(cli)


async def _shell(settings: Settings, script: str, *, input: bytes | None = None, timeout_s: float):
    if sys.platform == "win32":
        argv = ["wsl.exe", "-d", settings.WSL_DISTRO, "-e", "bash", "-c", script]
    else:
        argv = ["bash", "-c", script]
    return await run_process(argv, input=input, kill_after_s=timeout_s, cap=SARIF_CAP)


async def cli_version(settings: Settings) -> dict:
    """{"available": True, "version": ...} or {"available": False, "reason": ...}; successes are memoised."""
    key = (sys.platform, settings.WSL_DISTRO, settings.CODACY_CLI)
    if key in _versions:
        return _versions[key]
    r = await _shell(settings, f"{_cli_shell(settings)} version 2>&1", timeout_s=30)
    m = re.search(r"Version:\s*(\S+)", r.out)
    if r.code != 0 or not m:
        where = f"WSL distro {settings.WSL_DISTRO}" if sys.platform == "win32" else "this host"
        detail = (r.out or r.err).strip().splitlines()[-1:] or ["no output"]
        return {"available": False,
                "reason": f"codacy-cli not found at {settings.CODACY_CLI} in {where} ({detail[0][:160]}); "
                          "run sandbox/codacy_setup.sh"}
    _versions[key] = {"available": True, "version": m.group(1)}
    return _versions[key]


def _bundle(files: dict[str, bytes], source: str) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
        for name, data in [*((f".codacy/{k}", v) for k, v in sorted(files.items())),
                           ("submission.c", source.encode("utf-8"))]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            info.mtime = 0
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


async def run_local(source: str, settings: Settings, files: dict[str, bytes], log: LogFn) -> dict:
    timeout = max(5, int(settings.CODACY_TIMEOUT_S))
    work = f"/tmp/agc-{uuid.uuid4().hex}"
    script = "\n".join([
        f"D={work}",
        'mkdir -p "$D" && cd "$D" || exit 90',
        "trap 'cd /; rm -rf \"$D\"' EXIT",
        "tar xzf - || exit 91",
        (f"timeout -s KILL {timeout} {_cli_shell(settings)} analyze --format sarif -o out.sarif submission.c "
        "> analyze.log 2>&1"),
        "rc=$?",
        'if [ -s out.sarif ]; then cat out.sarif; else tail -c 2000 analyze.log >&2; fi',
        "exit $rc",
    ])
    r = await _shell(settings, script, input=_bundle(files, source), timeout_s=timeout + 20)
    if r.host_killed or r.code == 137:
        raise TimeoutError(f"codacy-cli analyze exceeded {timeout}s")
    if not r.out.strip():
        raise RuntimeError(f"codacy-cli analyze failed (exit {r.code}): {r.err.strip()[-300:]}")
    issues, versions = parse_sarif(r.out, rule_meta(files))
    return {"issues": issues, "sarif_versions": versions}


def cloud_configured(settings: Settings) -> bool:
    return all([settings.CODACY_API_TOKEN, settings.CODACY_PROVIDER, settings.CODACY_ORG, settings.CODACY_REPO])


def cloud_issue(item: dict) -> dict:
    pi = item.get("patternInfo") or {}
    ti = item.get("toolInfo") or {}
    return {
        "tool": str(ti.get("name") or "codacy").lower(),
        "rule": str(pi.get("id") or ""),
        "level": norm_level(pi.get("level") or pi.get("severityLevel")),
        "category": str(pi.get("category") or ""),
        "line": int(item.get("lineNumber") or 0),
        "message": first_sentence(item.get("message")),
    }


async def run_cloud(settings: Settings, file_path: str, *, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Issues Codacy already reported for file_path in CODACY_ORG/CODACY_REPO."""
    base = (f"{API_URL}/analysis/organizations/{settings.CODACY_PROVIDER}/{settings.CODACY_ORG}"
            f"/repositories/{settings.CODACY_REPO}")
    headers = {"api-token": settings.CODACY_API_TOKEN, "Accept": "application/json"}
    issues: list[dict] = []
    async with httpx.AsyncClient(timeout=30, headers=headers, transport=transport) as client:
        r = await client.get(f"{base}/files", params={"search": file_path, "limit": 100})
        r.raise_for_status()
        if not any(f.get("path") == file_path for f in r.json().get("data") or []):
            raise FileNotFoundError(f"{file_path} is not in the analyzed repository {settings.CODACY_REPO}")
        cursor = None
        for _ in range(MAX_PAGES):
            params: dict[str, Any] = {"limit": 100}
            if cursor:
                params["cursor"] = cursor
            r = await client.post(f"{base}/issues/search", params=params, json={})
            r.raise_for_status()
            body = r.json()
            issues += [cloud_issue(i) for i in body.get("data") or [] if i.get("filePath") == file_path]
            cursor = (body.get("pagination") or {}).get("cursor")
            if not cursor:
                break
    return {"issues": sort_issues(issues), "sarif_versions": {}}


def _cache_file(settings: Settings, key: str) -> Path:
    return settings.DATA_DIR / "cache" / "codacy" / f"{key}.json"


async def run_codacy(source: str, settings: Settings | None = None, log: LogFn | None = None, *,
                     mode: str = "local", cloud_file_path: str | None = None,
                     transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Codacy findings for one submission. Never raises; available=False carries the reason."""
    settings = settings or get_settings()
    log = log or _noop
    want_cloud = mode == "cloud"
    note = None
    if want_cloud and not cloud_configured(settings):
        want_cloud = False
        note = "cloud mode requested but CODACY_API_TOKEN/PROVIDER/ORG/REPO are not set; used local mode"
        log({"kind": "warn", "msg": f"codacy: {note}"})
    mode = "cloud" if want_cloud else "local"
    out: dict[str, Any] = {"available": False, "mode": mode, "tool_versions": {}, "issues": []}
    if note:
        out["note"] = note

    try:
        if want_cloud:
            target = (cloud_file_path or CLOUD_FILE_PATH).format(sha256=sha256(source))
            versions = {"codacy_api": "v3"}
            files: dict[str, bytes] = {}
            key_parts = {"mode": mode, "target": f"{settings.CODACY_PROVIDER}/{settings.CODACY_ORG}/"
                                                 f"{settings.CODACY_REPO}/{target}"}
        else:
            files = template_files(settings)
            if "codacy.yaml" not in files:
                out["error"] = f"Codacy template not found in {template_dir(settings)}"
                return out
            cli = await cli_version(settings)
            if not cli["available"]:
                out["error"] = cli["reason"]
                log({"kind": "warn", "msg": f"codacy: unavailable ({cli['reason']})"})
                return out
            versions = {"codacy_cli": cli["version"], **pinned_tools(files)}
            key_parts = {"mode": mode, "template": template_hash(files)}
        key = sha256(dump_json({"source": sha256(source), "tools": versions, **key_parts}))
        out["tool_versions"] = versions
        cached = _cache_file(settings, key)
        if cached.is_file():
            hit = json.loads(cached.read_text("utf-8"))
            log({"kind": "tool", "msg": f"codacy: cache hit ({len(hit['issues'])} issue(s), key {key[:10]})"})
            return {**hit, "cached": True}

        log({"kind": "tool", "msg": f"codacy: {mode} analysis ({', '.join(f'{k} {v}' for k, v in versions.items())})"})
        res = await (run_cloud(settings, target, transport=transport) if want_cloud
                     else run_local(source, settings, files, log))
    except Exception as e:  # noqa: BLE001  (Codacy must never break grading)
        out["error"] = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        log({"kind": "warn", "msg": f"codacy: {out['error']}"})
        return out

    out.update(available=True, issues=res["issues"])
    if res["sarif_versions"]:
        out["tool_versions"] = {**versions, "reported": res["sarif_versions"]}
    if want_cloud:
        out["file_path"] = target
    log({"kind": "tool", "msg": f"codacy: {len(out['issues'])} issue(s)"})
    cached.parent.mkdir(parents=True, exist_ok=True)
    tmp = cached.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(dump_json(out, indent=2), "utf-8", newline="")
    os.replace(tmp, cached)
    return {**out, "cached": False}


async def codacy_status(settings: Settings | None = None) -> dict:
    """For /api/health: is the local CLI usable, which tools are pinned, is cloud mode configured."""
    settings = settings or get_settings()
    files = template_files(settings) if template_dir(settings).is_dir() else {}
    cli = await cli_version(settings)
    out = {"available": cli["available"], "cli": settings.CODACY_CLI, "tools": pinned_tools(files),
           "template_hash": template_hash(files)[:12] if files else None,
           "cloud_configured": cloud_configured(settings)}
    out["version" if cli["available"] else "reason"] = cli.get("version") or cli.get("reason")
    return out
