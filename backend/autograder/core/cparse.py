"""Small hand-written C lexer and source metrics.

The lexer walks UTF-16 code units, so lengths and positions stay the same
for characters outside the BMP (emoji etc.) on every run. Tokens are dicts
{"type", "value", "line"} and analyze_source returns camelCase keys used in the reports.
"""
from __future__ import annotations

import re

from .textfmt import WS_CHARS, trim_ws

KEYWORDS = {
    "auto", "break", "case", "char", "const", "continue", "default", "do", "double", "else", "enum",
    "extern", "float", "for", "goto", "if", "inline", "int", "long", "register", "restrict", "return",
    "short", "signed", "sizeof", "static", "struct", "switch", "typedef", "union", "unsigned", "void",
    "volatile", "while", "_Bool", "_Complex", "_Imaginary", "_Alignas", "_Alignof", "_Atomic",
    "_Generic", "_Noreturn", "_Static_assert", "_Thread_local", "bool",
}

TYPE_WORDS = {
    "char", "double", "float", "int", "long", "short", "signed", "unsigned", "void", "bool", "_Bool",
    "size_t", "FILE", "int64_t", "int32_t", "uint64_t", "uint32_t", "uint8_t", "int8_t",
}

LIBRARY = {
    "printf", "scanf", "puts", "putchar", "getchar", "fgets", "gets", "fprintf", "fscanf", "sprintf",
    "sscanf", "malloc", "calloc", "realloc", "free", "memset", "memcpy", "strlen", "strcmp", "strcpy",
    "qsort", "bsearch", "abs", "labs", "exit", "main", "NULL", "stdin", "stdout", "stderr", "EOF",
    "INT_MAX", "INT_MIN", "LLONG_MAX", "LLONG_MIN",
}

CONTROL = {"if", "for", "while", "switch", "return", "sizeof", "else", "do"}

_ALPHA = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_")
_DIGIT = set("0123456789")
_ALNUM = _ALPHA | _DIGIT
_NUM_BODY = _ALNUM | {"."}
_OPS3 = {"<<=", ">>=", "..."}
_OPS2 = {"->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="}
_INCLUDE_RE = re.compile(f'^#[{WS_CHARS}]*include[{WS_CHARS}]*[<"]([^>"]+)[>"]')
_FMT_RE = re.compile(r"%[-+ #0-9.]*l*[dfsuxc]")


def _to_units(s: str) -> str:
    """Split astral characters into surrogate pairs (UTF-16 indexing)."""
    if all(ord(c) <= 0xFFFF for c in s):
        return s
    raw = s.encode("utf-16-le", "surrogatepass")
    return "".join(chr(raw[i] | (raw[i + 1] << 8)) for i in range(0, len(raw), 2))


def _from_units(s: str) -> str:
    if not any(0xD800 <= ord(c) <= 0xDFFF for c in s):
        return s
    return s.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "surrogatepass")


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le", "surrogatepass")) // 2


def tokenize(src: str) -> dict:
    src = _to_units(src)
    tokens: list[dict] = []
    comments: list[dict] = []
    includes: list[str] = []
    i, line = 0, 1
    n = len(src)

    def at(j: int) -> str:
        return src[j] if 0 <= j < n else ""

    def push(type_: str, value: str, start_line: int) -> None:
        tokens.append({"type": type_, "value": _from_units(value), "line": start_line})

    while i < n:
        c = src[i]
        if c == "\n":
            line += 1
            i += 1
            continue
        if c in " \t\r\f\v":
            i += 1
            continue

        if c == "/" and at(i + 1) == "/":
            start, start_line = i, line
            while i < n and src[i] != "\n":
                i += 1
            comments.append({"text": _from_units(src[start:i]), "line": start_line})
            continue
        if c == "/" and at(i + 1) == "*":
            start, start_line = i, line
            i += 2
            while i < n and not (src[i] == "*" and at(i + 1) == "/"):
                if src[i] == "\n":
                    line += 1
                i += 1
            i = min(n, i + 2)
            comments.append({"text": _from_units(src[start:i]), "line": start_line})
            continue
        if c == "#" and _is_line_start(src, i):
            start, start_line = i, line
            while i < n and not (src[i] == "\n" and at(i - 1) != "\\"):
                if src[i] == "\n":
                    line += 1
                i += 1
            text = src[start:i]
            m = _INCLUDE_RE.match(text)
            if m:
                includes.append(_from_units(m.group(1)))
            push("pp", trim_ws(text), start_line)
            continue
        if c in "\"'":
            q, start, start_line = c, i, line
            i += 1
            while i < n and src[i] != q:
                if src[i] == "\\":
                    i += 1
                elif src[i] == "\n":
                    line += 1
                i += 1
            i += 1
            push("str" if q == '"' else "chr", src[start:i], start_line)
            continue
        if c in _ALPHA:
            start = i
            while i < n and src[i] in _ALNUM:
                i += 1
            word = src[start:i]
            push("kw" if word in KEYWORDS else "id", word, line)
            continue
        if c in _DIGIT or (c == "." and at(i + 1) in _DIGIT):
            start = i
            while i < n and src[i] in _NUM_BODY:
                if src[i] in "eEpP" and at(i + 1) in ("+", "-"):
                    i += 1
                i += 1
            push("num", src[start:i], line)
            continue
        three, two = src[i:i + 3], src[i:i + 2]
        if three in _OPS3:
            push("op", three, line)
            i += 3
            continue
        if two in _OPS2:
            push("op", two, line)
            i += 2
            continue
        push("op", c, line)
        i += 1
    return {"tokens": tokens, "comments": comments, "includes": includes, "lineCount": line}


def _is_line_start(src: str, i: int) -> bool:
    j = i - 1
    while j >= 0 and src[j] in " \t":
        j -= 1
    return j < 0 or src[j] == "\n"


def analyze_source(src: str) -> dict:
    lex = tokenize(src)
    tokens, comments = lex["tokens"], lex["comments"]
    functions: list[dict] = []
    depth = 0

    k = 0
    while k < len(tokens):
        t = tokens[k]
        if t["type"] == "op" and t["value"] == "{":
            if depth == 0:
                fn = _detect_function_header(tokens, k)
                if fn:
                    end = _match_brace(tokens, k)
                    body = tokens[k + 1:end]
                    end_line = tokens[end]["line"]
                    functions.append({
                        "name": fn["name"],
                        "startLine": fn["line"],
                        "endLine": end_line,
                        "length": end_line - fn["line"] + 1,
                        "params": fn["params"],
                        "cyclomatic": _cyclomatic(body),
                        "calls": list(dict.fromkeys(_calls_in(body))),
                        # every identifier counts, so qsort(..., cmp) marks cmp as used
                        "refs": list(dict.fromkeys(b["value"] for b in body if b["type"] == "id")),
                        "maxNesting": _max_nesting(body),
                    })
                    k = end + 1
                    continue
            depth += 1
        elif t["type"] == "op" and t["value"] == "}":
            depth = max(0, depth - 1)
        k += 1

    names = {f["name"] for f in functions}
    for f in functions:
        f["callsUserFunctions"] = [c for c in f["refs"] if c in names and c != f["name"]]

    declared = _declared_identifiers(tokens)
    declared["names"] = [x for x in declared["names"] if x not in names]
    code_lines = len({t["line"] for t in tokens if t["type"] != "pp"})
    comment_chars = sum(utf16_len(c["text"]) for c in comments)

    return {
        "lineCount": lex["lineCount"],
        "codeLines": code_lines,
        "functions": functions,
        "includes": lex["includes"],
        "comments": {
            "count": len(comments),
            "chars": comment_chars,
            "perCodeLine": len(comments) / code_lines if code_lines else 0,
        },
        "identifiers": declared,
        "hasMain": "main" in names,
        "tokens": tokens,
    }


def _detect_function_header(tokens: list[dict], brace_idx: int) -> dict | None:
    j = brace_idx - 1
    if not (j >= 0 and tokens[j]["type"] == "op" and tokens[j]["value"] == ")"):
        return None
    d = 0
    while j >= 0:
        v = tokens[j]["value"]
        if v == ")":
            d += 1
        elif v == "(":
            d -= 1
            if d == 0:
                break
        j -= 1
    name_tok = tokens[j - 1] if j - 1 >= 0 else None
    if not name_tok or name_tok["type"] != "id" or name_tok["value"] in CONTROL:
        return None
    # '=' before the parenthesis means an initializer, not a function definition
    before = tokens[j - 2] if j - 2 >= 0 else None
    if before and before["type"] == "op" and before["value"] == "=":
        return None
    params = [t["value"] for t in tokens[j + 1:brace_idx - 1] if t["type"] == "id"]
    return {"name": name_tok["value"], "line": name_tok["line"], "params": params}


def _match_brace(tokens: list[dict], open_idx: int) -> int:
    d = 0
    for k in range(open_idx, len(tokens)):
        v = tokens[k]["value"]
        if v == "{":
            d += 1
        elif v == "}":
            d -= 1
            if d == 0:
                return k
    return len(tokens) - 1


def _cyclomatic(body: list[dict]) -> int:
    c = 1
    for t in body:
        if t["type"] == "kw" and t["value"] in ("if", "for", "while", "case"):
            c += 1
        elif t["type"] == "op" and t["value"] in ("&&", "||", "?"):
            c += 1
    return c


def _max_nesting(body: list[dict]) -> int:
    d = m = 0
    for t in body:
        if t["value"] == "{":
            d += 1
            m = max(m, d)
        elif t["value"] == "}":
            d -= 1
    return m


def _calls_in(body: list[dict]) -> list[str]:
    return [body[k]["value"] for k in range(len(body) - 1)
            if body[k]["type"] == "id" and body[k + 1]["value"] == "("]


def _declared_identifiers(tokens: list[dict]) -> dict:
    names: list[str] = []
    n = len(tokens)

    def val(j: int) -> str | None:
        return tokens[j]["value"] if j < n else None

    for k in range(n - 1):
        t = tokens[k]
        if t["type"] in ("kw", "id") and t["value"] in TYPE_WORDS:
            j = k + 1
            while j < n and ((tokens[j]["type"] == "kw" and tokens[j]["value"] in TYPE_WORDS) or tokens[j]["value"] == "*"):
                j += 1
            while j < n and tokens[j]["type"] == "id":
                names.append(tokens[j]["value"])
                m = j + 1
                while m < n and tokens[m]["value"] not in (",", ";", ")", "("):
                    m += 1
                if val(m) != ",":
                    break
                j = m + 1
                while j < n and tokens[j]["value"] == "*":
                    j += 1
    unique = [x for x in dict.fromkeys(names) if x != "main"]
    short = [x for x in unique if len(x) == 1 and x not in ("i", "j", "k", "n")]
    return {"names": unique, "singleLetter": short}


def _normalize(t: dict) -> str:
    if t["type"] == "id":
        return t["value"] if t["value"] in LIBRARY else "ID"
    if t["type"] == "num":
        return "NUM"
    if t["type"] == "str":
        return "FMT" if _FMT_RE.search(t["value"]) else "STR"
    if t["type"] == "chr":
        return "CHR"
    return t["value"]


def normalized_tokens(src: str) -> list[str]:
    return [_normalize(t) for t in tokenize(src)["tokens"] if t["type"] != "pp"]


def normalized_tokens_with_lines(src: str) -> list[tuple[str, int]]:
    """Same as normalized_tokens, paired with the line each token starts on."""
    return [(_normalize(t), t["line"]) for t in tokenize(src)["tokens"] if t["type"] != "pp"]


def static_sanity(src: str) -> dict:
    a = analyze_source(src)
    ids = {t["value"] for t in a["tokens"] if t["type"] == "id"}
    main = next((f for f in a["functions"] if f["name"] == "main"), None)
    main_body = [t for t in a["tokens"] if main and main["startLine"] <= t["line"] <= main["endLine"]]
    return {
        "hasMain": main is not None,
        "hasReader": any(f in ids for f in ("scanf", "fgets", "getchar", "fscanf", "gets", "read", "getline")),
        "hasWriter": any(f in ids for f in ("printf", "puts", "putchar", "fprintf", "write", "fputs")),
        "mainHasReturn": any(t["type"] == "kw" and t["value"] == "return" for t in main_body),
    }
