"""Build the known-web-solutions corpus (corpus/web/*.c) for a problem.

The instructor gives the page URLs (found with a normal browser search), or configures an
official search API key (Brave Search or Google Programmable Search) so the problem title is
searched automatically. Only the search query and page downloads leave the machine; student
code never does. Each page's <pre>/<code> blocks are extracted, kept if they are a C program
that compiles in the sandbox, de-duplicated, and saved with the source URL in a header line.
The similarity check then compares every submission with these files.
"""
from __future__ import annotations

import html
import re
from pathlib import Path
from urllib.parse import urlparse

import httpx

from .analyzers.common import BASE_FLAGS, compile
from .corpus import read_text
from .similarity import containment, fingerprints

USER_AGENT = "AutoGrader-webcorpus/1.0 (course plagiarism check; instructor-run)"
MAX_PAGE_BYTES = 3_000_000
MAX_RESULTS = 8
DEDUPE = 0.95
# well-known tutorial sites tried first when results are ranked
PREFERRED = ("geeksforgeeks.org", "programiz.com", "w3schools.com", "javatpoint.com", "tutorialspoint.com",
             "sanfoundry.com", "github.com", "stackoverflow.com", "scaler.com", "codeforwin.org")

_BLOCK = re.compile(r"<(pre|code|textarea)[^>]*>(.*?)</\1>", re.S | re.I)
_TAG = re.compile(r"<[^>]+>")
_NOT_C = re.compile(r"#include\s*<(iostream|bits/stdc\+\+\.h)>|\busing namespace\b|\bstd::|System\.out|\bdef \w+\(|"
                    r"\bpublic static void\b|\bconsole\.log\b")


_BLOCK_TAGS = re.compile(r"</?(p|div|br|li|tr|h[1-6]|pre|code|span class=\"line[^\"]*\")[^>]*>", re.I)
_SMART = str.maketrans({"\u201c": '"', "\u201d": '"', "\u2018": "'", "\u2019": "'", "\u00a0": " ", "\u2013": "-"})


def _clean(code: str) -> str:
    return code.translate(_SMART).replace("\r", "").strip()


def _ok(code: str) -> bool:
    return "main" in code and "#include" in code and not _NOT_C.search(code)


def _programs_in_text(text: str) -> list[str]:
    """Programs written as plain lines (one <p> per line on many blogs): #include ... closing } of main."""
    out = []
    pos = 0
    while (start := text.find("#include", pos)) != -1:
        m = re.compile(r"\bmain\s*\(").search(text, start)
        brace = text.find("{", m.end()) if m else -1
        if brace == -1:
            break
        depth, i = 0, brace
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth != 0:
            break
        out.append(text[start:i + 1])
        pos = i + 1
    return out


def extract_c_programs(page: str) -> list[str]:
    """C programs found in a page: code blocks first, then programs written as plain text lines."""
    found, seen = [], set()

    def add(code: str) -> None:
        code = _clean(code)
        if _ok(code) and code not in seen:
            seen.add(code)
            found.append(code)

    for _, body in _BLOCK.findall(page):
        add(html.unescape(_TAG.sub("", body.replace("<br>", "\n").replace("<br/>", "\n"))))
    if not found:
        text = html.unescape(_TAG.sub("", _BLOCK_TAGS.sub("\n", page)))
        text = re.sub(r"\n\s*\n+", "\n", text)
        for code in _programs_in_text(text):
            add(code)
    return found


def _rank(urls: list[str]) -> list[str]:
    def key(u):
        host = urlparse(u).netloc.lower()
        return next((i for i, d in enumerate(PREFERRED) if host.endswith(d)), len(PREFERRED))
    return sorted(dict.fromkeys(urls), key=key)


async def search(query: str, settings, client: httpx.AsyncClient) -> list[str]:
    """Result URLs from an official search API, or [] when no key is configured."""
    if getattr(settings, "BRAVE_API_KEY", ""):
        r = await client.get("https://api.search.brave.com/res/v1/web/search",
                             params={"q": query, "count": 20},
                             headers={"X-Subscription-Token": settings.BRAVE_API_KEY, "Accept": "application/json"})
        r.raise_for_status()
        return [x["url"] for x in r.json().get("web", {}).get("results", []) if x.get("url")]
    if getattr(settings, "GOOGLE_CSE_KEY", "") and getattr(settings, "GOOGLE_CSE_CX", ""):
        r = await client.get("https://www.googleapis.com/customsearch/v1",
                             params={"key": settings.GOOGLE_CSE_KEY, "cx": settings.GOOGLE_CSE_CX, "q": query, "num": 10})
        r.raise_for_status()
        return [x["link"] for x in r.json().get("items", []) if x.get("link")]
    return []


def _slug(url: str) -> str:
    host = urlparse(url).netloc.lower().removeprefix("www.")
    return re.sub(r"[^a-z0-9]+", "_", host.split(".")[0] or "web")[:24]


async def build(problem_dir: str | Path, *, urls: list[str] | None = None, query: str | None = None,
                settings=None, log=None, transport: httpx.AsyncBaseTransport | None = None) -> dict:
    """Returns {query, searched, pages:[{url, status, programs, kept}], kept:[file], reasons}."""
    from ..config import get_settings
    from .sandbox.select import sandbox_ctx

    settings = settings or get_settings()
    log = log or (lambda e: None)
    problem_dir = Path(problem_dir)
    out_dir = problem_dir / "corpus" / "web"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {"query": query, "searched": False, "pages": [], "kept": []}

    async with httpx.AsyncClient(timeout=20, follow_redirects=True, transport=transport,
                                 headers={"User-Agent": USER_AGENT}) as client:
        candidates = list(urls or [])
        if query:
            found = await search(query, settings, client)
            result["searched"] = bool(found)
            if not found and not candidates:
                raise ValueError("No search API key is configured (BRAVE_API_KEY, or GOOGLE_CSE_KEY and "
                                 "GOOGLE_CSE_CX). Search in your browser and pass the page URLs instead.")
            candidates += found
        candidates = _rank(candidates)[: max(MAX_RESULTS, len(urls or []))]

        kept_fp = [fingerprints(read_text(p)) for p in sorted(out_dir.glob("*.c"))]
        counter = len(list(out_dir.glob("*.c")))
        async with sandbox_ctx(settings, 256, log) as sb:
            for url in candidates:
                page = {"url": url, "status": "", "programs": 0, "kept": 0}
                result["pages"].append(page)
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                    text = r.text[:MAX_PAGE_BYTES]
                except Exception as e:  # noqa: BLE001 -- one bad page must not stop the rest
                    page["status"] = f"download failed: {type(e).__name__}"
                    continue
                programs = extract_c_programs(text)
                page["programs"] = len(programs)
                for code in programs:
                    if not (await compile(sb, code, "web", BASE_FLAGS)).ok:
                        continue
                    fp = fingerprints(code)
                    if not fp or any(containment(fp, other) > DEDUPE for other in kept_fp):
                        continue
                    kept_fp.append(fp)
                    counter += 1
                    name = f"{_slug(url)}_{counter}.c"
                    (out_dir / name).write_text(f"// Source: {url}\n" + code + "\n", "utf-8", newline="")
                    page["kept"] += 1
                    result["kept"].append(name)
                    log({"kind": "ok", "msg": f"web-corpus: saved {name} from {url}"})
                page["status"] = "ok" if programs else "no C program found"
    return result
