"""Dangerous-call scan over the token stream (DESIGN section 10).

Working on tokens means names inside comments and string literals never
match. Bodies of #define lines are tokenized again, so `#define RUN system`
is still caught. Functions the student defines themselves are not reported.
"""
from __future__ import annotations

import re

from ..cparse import analyze_source, tokenize

CRITICAL_CALLS = {
    "system", "popen", "fork", "vfork", "kill", "ptrace", "syscall", "socket", "connect",
    "execl", "execlp", "execle", "execv", "execvp", "execvpe", "execve", "fexecve",
    "posix_spawn", "posix_spawnp", "clone", "clone3", "dlopen", "dlsym", "dlvsym",
    "creat", "truncate", "ftruncate",
}
WARN_CALLS = {"remove", "unlink", "rename", "rmdir", "chmod", "setrlimit", "signal", "sleep", "usleep"}
ASM_WORDS = {"asm", "__asm", "__asm__"}
OPEN_CALLS = {"fopen", "freopen"}
FD_OPEN_CALLS = {"open", "openat", "open64", "openat64"}
WRITE_FLAGS = {"O_WRONLY", "O_RDWR", "O_CREAT", "O_TRUNC", "O_APPEND"}
TYPE_WORDS = {
    "int", "char", "short", "long", "unsigned", "signed", "float", "double", "void", "_Bool", "bool",
    "size_t", "ssize_t", "FILE", "const", "volatile", "static", "register", "extern",
    "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
}

_INCLUDE = re.compile(r"#\s*include\s*([<\"])([^>\"]*)[>\"]", re.ASCII)
_DEFINE = re.compile(r"#\s*define\s+[A-Za-z_]\w*(?:\([^)]*\))?(.*)", re.ASCII | re.DOTALL)
_ABS_PATH = re.compile(r"^(/|[A-Za-z]:[\\/]|\\\\)", re.ASCII)
_WRITE_MODE = re.compile(r"[wa+]")
_VALUE_CONTEXT = {"=", "(", ",", "return", "?", ":", "&", "{", ""}


def _finding(line: int, call: str, severity: str, reason: str) -> dict:
    return {"line": line, "call": call, "severity": severity, "reason": reason}


def _include_findings(tok: dict) -> list[dict]:
    m = _INCLUDE.match(tok["value"])
    if not m:
        return []
    path = m.group(2).strip()
    line = tok["line"]
    if _ABS_PATH.match(path) or path.startswith("/dev") or "/dev/" in path:
        return [_finding(line, f"#include {path}", "critical", "includes an absolute path or a device file")]
    if path == "unistd.h":
        return [_finding(line, "#include unistd.h", "warn", "POSIX process and file API")]
    if path.startswith("sys/"):
        return [_finding(line, f"#include {path}", "warn", "system interface header")]
    if ".." in path:
        return [_finding(line, f"#include {path}", "warn", "includes a file outside the submission")]
    return []


def _call_args(tokens: list[dict], i: int) -> list[dict]:
    """Tokens between the parentheses of the call whose name is tokens[i]."""
    depth = 0
    out = []
    for t in tokens[i + 1:]:
        if t["type"] == "op" and t["value"] == "(":
            depth += 1
            if depth == 1:
                continue
        elif t["type"] == "op" and t["value"] == ")":
            depth -= 1
            if depth == 0:
                break
        out.append(t)
    return out


def _split_args(args: list[dict]) -> list[list[dict]]:
    depth, parts, cur = 0, [], []
    for t in args:
        if t["type"] == "op" and t["value"] in "([{":
            depth += 1
        elif t["type"] == "op" and t["value"] in ")]}":
            depth -= 1
        if depth == 0 and t["type"] == "op" and t["value"] == ",":
            parts.append(cur)
            cur = []
            continue
        cur.append(t)
    parts.append(cur)
    return parts


def _fopen_mode(args: list[dict]) -> str | None:
    """The mode literal (second argument) or None if it is not a plain string."""
    parts = _split_args(args)
    mode = parts[1] if len(parts) > 1 else []
    if len(mode) == 1 and mode[0]["type"] == "str":
        return mode[0]["value"][1:-1]
    return None


def _abs_path_arg(args: list[dict]) -> bool:
    first = _split_args(args)[0]
    return len(first) == 1 and first[0]["type"] == "str" and bool(_ABS_PATH.match(first[0]["value"][1:-1]))


def _open_writes(args: list[dict]) -> bool:
    """open()/openat() unless its flags are plainly read-only."""
    names = {t["value"] for t in args if t["type"] == "id"}
    return bool(names & WRITE_FLAGS) or "O_RDONLY" not in names


def declared_names(tokens: list[dict]) -> set[str]:
    """Variables and parameters declared with a basic type (int kill, n; void f(char *connect))."""
    names: set[str] = set()
    in_decl, decl_depth, depth = False, 0, 0
    for i, t in enumerate(tokens):
        v = t["value"]
        if t["type"] == "op":
            if v in ("(", "[", "{"):
                depth += 1
            elif v in (")", "]", "}"):
                depth -= 1
            if v in (";", "{", "}") or depth < decl_depth:
                in_decl = False
            continue
        if t["type"] not in ("id", "kw"):
            continue
        if v in TYPE_WORDS:
            if not in_decl or depth != decl_depth:
                in_decl, decl_depth = True, depth
            continue
        if in_decl and t["type"] == "id" and depth == decl_depth:
            prev = tokens[i - 1]["value"] if i > 0 else ""
            nxt = tokens[i + 1]["value"] if i + 1 < len(tokens) else ""
            if (prev in TYPE_WORDS or prev in ("*", ",")) and nxt != "(":
                names.add(v)
    return names


def _scan_tokens(tokens: list[dict], own: set[str], line_of=None,
                 variables: frozenset = frozenset()) -> list[dict]:
    out = []
    n = len(tokens)
    for i, t in enumerate(tokens):
        line = line_of if line_of is not None else t["line"]
        if t["type"] == "pp":
            if line_of is None:
                out.extend(_include_findings(t))
                m = _DEFINE.match(t["value"])
                if m and m.group(1).strip():
                    out.extend(_scan_tokens(tokenize(m.group(1))["tokens"], own, t["line"], variables))
            continue
        if t["type"] not in ("id", "kw"):
            continue
        name = t["value"]
        prev = tokens[i - 1]["value"] if i > 0 else ""
        nxt = tokens[i + 1]["value"] if i + 1 < n else ""
        if prev in (".", "->"):
            continue
        if name in ASM_WORDS:
            out.append(_finding(line, name, "critical", "inline assembly"))
            continue
        if name == "__attribute__":
            words = [x["value"] for x in tokens[i + 1:i + 12] if x["type"] == "id"]
            if "constructor" in words or "__constructor__" in words:
                out.append(_finding(line, "__attribute__((constructor))", "critical",
                                    "code that runs before main"))
            continue
        # a bare name only counts when used as a value (function pointer), not in a declaration
        # and not when the student declared a variable of that name; calls always count
        if name in own or (nxt != "(" and (prev not in _VALUE_CONTEXT or name in variables)):
            continue
        if name in CRITICAL_CALLS:
            what = "call" if nxt == "(" else "reference"
            out.append(_finding(line, name, "critical", f"{what} to {name}(): process, signal or network access"))
        elif name in WARN_CALLS:
            out.append(_finding(line, name, "warn", f"{name}() touches files, signals or timing"))
        elif name in OPEN_CALLS and nxt == "(":
            args = _call_args(tokens, i)
            mode = _fopen_mode(args)
            if mode is None:
                out.append(_finding(line, name, "warn", f"{name}() with a mode that is not a string literal"))
            elif _WRITE_MODE.search(mode) and _abs_path_arg(args):
                out.append(_finding(line, name, "critical", f'{name}() writes to an absolute path (mode "{mode}")'))
            elif _WRITE_MODE.search(mode):
                out.append(_finding(line, name, "warn", f'{name}() opens a file for writing (mode "{mode}")'))
        elif name in FD_OPEN_CALLS and nxt == "(":
            if _open_writes(_call_args(tokens, i)):
                out.append(_finding(line, name, "critical", f"{name}() may create or overwrite a file"))
            else:
                out.append(_finding(line, name, "warn", f"{name}() opens a file descriptor"))
    return out


def scan(source: str) -> list[dict]:
    """Findings [{line, call, severity: critical|warn, reason}] in source order."""
    own = {f["name"] for f in analyze_source(source)["functions"]}
    tokens = tokenize(source)["tokens"]
    found = _scan_tokens(tokens, own, variables=frozenset(declared_names(tokens)))
    seen = set()
    out = []
    for f in sorted(found, key=lambda f: f["line"]):
        key = (f["line"], f["call"])
        if key not in seen:
            seen.add(key)
            out.append(f)
    return out


def critical(findings: list[dict]) -> list[dict]:
    return [f for f in findings if f["severity"] == "critical"]
