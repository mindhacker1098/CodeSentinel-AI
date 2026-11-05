"""Layout and habit features that separate chat-model C code from student code.

Each feature is a number (None when the program gives no evidence for it).
Scores are z-scores against the class when there are enough peers, or
against fixed priors from typical student code otherwise. The direction of
each feature (which way looks machine-written) always comes from the priors.
"""
from __future__ import annotations

import math
import re
from statistics import mean, pstdev

from ..cparse import LIBRARY, analyze_source, tokenize

MIN_CLASS = 15

# feature -> (prior mean, prior sd, weight); a positive weight means higher looks more machine-written
PRIORS: dict[str, tuple[float, float, float]] = {
    "indent_4_spaces": (0.5, 0.35, 1.0),
    "comma_space": (0.6, 0.3, 1.0),
    "operator_space": (0.55, 0.3, 1.0),
    "braces_always": (0.6, 0.3, 1.0),
    "scanf_unchecked": (0.6, 0.4, 0.5),
    "main_empty_parens": (0.5, 0.5, 0.75),
    "line_comment_ratio": (0.5, 0.4, 0.5),
    "ident_length": (4.0, 2.0, 0.5),
    "malloc_cast": (0.3, 0.45, 0.5),
    "main_returns_0": (0.7, 0.45, 0.25),
    "comment_density": (0.08, 0.08, 0.0),
    "blank_line_ratio": (0.1, 0.08, 0.0),
}
FEATURES = list(PRIORS)

_MASK = re.compile(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'|//[^\n]*|/\*.*?\*/', re.DOTALL)
_COMMA = re.compile(r",(.?)")
_BIN_OP = re.compile(r"(?<![+\-*/%<>=!&|^])(==|!=|<=|>=|&&|\|\||[+\-*/%]=|=|<|>|\+|-|/|%)(?![+\-=&|>])")
_MAIN_EMPTY = re.compile(r"\bmain\s*\(\s*\)", re.ASCII)
_MALLOC = re.compile(r"\b[mc]alloc\s*\(", re.ASCII)
_MALLOC_CAST = re.compile(r"\)\s*[mc]alloc\s*\(", re.ASCII)


def _masked(source: str) -> str:
    return _MASK.sub(lambda m: "S" + "\n" * m.group(0).count("\n"), source)


def _ratio(hit: int, total: int) -> float | None:
    return hit / total if total else None


def _indent(lines: list[str]) -> float | None:
    ind = [ln[: len(ln) - len(ln.lstrip(" \t"))] for ln in lines if ln.strip() and ln[:1] in " \t"]
    ok = sum(1 for w in ind if "\t" not in w and len(w) % 4 == 0)
    return _ratio(ok, len(ind))


def _operator_space(code: str) -> float | None:
    hit = total = 0
    for line in code.split("\n"):
        s = line.strip()
        if s.startswith("#"):
            continue
        for m in _BIN_OP.finditer(line):
            a, b = m.start(), m.end()
            if m.group(1) in ("<", ">") and "include" in line:
                continue
            if m.group(1) in ("-", "+") and not line[:a].rstrip()[-1:].isalnum() and line[:a].rstrip()[-1:] not in ")]":
                continue  # unary sign
            if m.group(1) in ("*",):
                continue
            total += 1
            if line[a - 1:a] == " " and line[b:b + 1] == " ":
                hit += 1
    return _ratio(hit, total)


def _braces(tokens: list[dict]) -> float | None:
    hit = total = 0
    n = len(tokens)
    for i, t in enumerate(tokens):
        if t["type"] != "kw" or t["value"] not in ("if", "for", "while", "else"):
            continue
        j = i + 1
        if t["value"] == "else":
            if j < n and tokens[j]["value"] == "if":
                continue
        else:
            if j >= n or tokens[j]["value"] != "(":
                continue
            depth = 0
            while j < n:
                v = tokens[j]["value"]
                depth += v == "("
                depth -= v == ")"
                j += 1
                if depth == 0:
                    break
            # do { } while (...);
            if t["value"] == "while" and j < n and tokens[j]["value"] == ";":
                continue
        if j < n:
            total += 1
            hit += tokens[j]["value"] == "{"
    return _ratio(hit, total)


def _scanf_unchecked(tokens: list[dict]) -> float | None:
    hit = total = 0
    for i, t in enumerate(tokens):
        if t["type"] != "id" or t["value"] not in ("scanf", "fscanf", "sscanf"):
            continue
        if i + 1 >= len(tokens) or tokens[i + 1]["value"] != "(":
            continue
        total += 1
        prev = tokens[i - 1]["value"] if i else ";"
        if prev in (";", "{", "}", ")") and not (prev == ")" and i >= 2 and tokens[i - 2]["value"] == "void"):
            hit += 1
    return _ratio(hit, total)


def _main_returns_0(tokens: list[dict], funcs: list[dict]) -> float | None:
    main = next((f for f in funcs if f["name"] == "main"), None)
    if not main:
        return None
    body = [t for t in tokens if main["startLine"] <= t["line"] <= main["endLine"]]
    vals = [t["value"] for t in body]
    for k in range(len(vals) - 1, 2, -1):
        if vals[k] == "}":
            return 1.0 if vals[k - 3:k] == ["return", "0", ";"] else 0.0
    return 0.0


def features(source: str) -> dict[str, float | None]:
    lines = source.replace("\r\n", "\n").split("\n")
    code = _masked(source.replace("\r\n", "\n"))
    tk = tokenize(source)
    tokens = tk["tokens"]
    a = analyze_source(source)
    code_lines = [ln for ln in code.split("\n") if ln.strip() and not ln.strip().startswith("#")]
    commas = [m.group(1) for line in code_lines for m in _COMMA.finditer(line)]
    idents = {t["value"] for t in tokens if t["type"] == "id" and t["value"] not in LIBRARY}
    comments = tk["comments"]
    mallocs = len(_MALLOC.findall(code))
    has_main = any(t["type"] == "id" and t["value"] == "main" for t in tokens)
    return {
        "indent_4_spaces": _indent(lines),
        "comma_space": _ratio(sum(1 for c in commas if c in (" ", "\n", "")), len(commas)),
        "operator_space": _operator_space(code),
        "braces_always": _braces(tokens),
        "scanf_unchecked": _scanf_unchecked(tokens),
        "main_empty_parens": 1.0 if _MAIN_EMPTY.search(code) else 0.0 if has_main else None,
        "line_comment_ratio": _ratio(sum(1 for c in comments if c["text"].startswith("//")), len(comments)),
        "ident_length": mean(len(x) for x in idents) if idents else None,
        "malloc_cast": _ratio(len(_MALLOC_CAST.findall(code)), mallocs),
        "main_returns_0": _main_returns_0(tokens, a["functions"]),
        "comment_density": _ratio(len(comments), len(code_lines)),
        "blank_line_ratio": _ratio(sum(1 for ln in lines if not ln.strip()), len(lines)),
    }


def class_stats(peer_features: list[dict]) -> dict[str, tuple[float, float]]:
    """Mean and sd of each feature over the class; the sd never drops below half the prior sd."""
    out = {}
    for name, (pm, psd, _) in PRIORS.items():
        vals = [f[name] for f in peer_features if f.get(name) is not None]
        if len(vals) < MIN_CLASS:
            out[name] = (pm, psd)
        else:
            out[name] = (mean(vals), max(pstdev(vals), psd / 2))
    return out


def score(source: str, peer_sources: list[str] | None = None) -> dict:
    """{features, z, z_mean, score (0..1, higher = more machine-like), basis: class|priors, n_features}."""
    feats = features(source)
    peers = peer_sources or []
    basis = "class" if len(peers) >= MIN_CLASS else "priors"
    stats = class_stats([features(p) for p in peers]) if basis == "class" else {k: v[:2] for k, v in PRIORS.items()}
    z: dict[str, float] = {}
    num = den = 0.0
    for name, (_, _, w) in PRIORS.items():
        x = feats[name]
        if x is None:
            continue
        m, sd = stats[name]
        zi = max(-3.0, min(3.0, (x - m) / sd if sd else 0.0))
        z[name] = math.floor(zi * 1000 + 0.5) / 1000
        if w:
            num += w * zi
            den += abs(w)
    z_mean = num / den if den else 0.0
    return {
        "features": {k: (None if v is None else math.floor(v * 1000 + 0.5) / 1000) for k, v in feats.items()},
        "z": z,
        "z_mean": math.floor(z_mean * 1000 + 0.5) / 1000,
        "score": math.floor(1000 / (1 + math.exp(-1.5 * z_mean)) + 0.5) / 1000,
        "basis": basis,
        "n_features": sum(1 for k in z if PRIORS[k][2]),
    }
