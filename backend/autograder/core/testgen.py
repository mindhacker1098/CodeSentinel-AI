"""Input generators for the edge case runner and complexity estimator."""
from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any

from .textfmt import WS_RE, number_text, trim_ws
from .prng import mulberry32

INT_MAX = 2147483647
INT_MIN = -2147483648
MAX_VALID_N = 100000
MAX_VALID_LEN = 2_000_000

Rng = Callable[[], float]

_INT_RE = re.compile(r"[+-]?[0-9]+", re.ASCII)
_DEC_RE = re.compile(r"[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?", re.ASCII)
_RADIX = {"x": (16, "0-9a-fA-F"), "o": (8, "0-7"), "b": (2, "01")}


def rand_int(rng: Rng, lo: int, hi: int) -> int:
    return lo + math.floor(rng() * (hi - lo + 1))


def biased(rng: Rng, lo: int, hi: int) -> int:
    """Half the time pick a boundary value."""
    specials = [v for v in (lo, hi, 0, 1, -1, lo + 1, hi - 1) if lo <= v <= hi]
    if rng() < 0.5:
        return specials[math.floor(rng() * len(specials))]
    return rand_int(rng, lo, hi)


def is_number(s: str) -> float | int:
    """Number(s) for a string that is already trimmed."""
    if s == "":
        return 0
    if s in ("Infinity", "+Infinity"):
        return math.inf
    if s == "-Infinity":
        return -math.inf
    if len(s) > 2 and s[0] == "0" and s[1].lower() in _RADIX:
        base, digits = _RADIX[s[1].lower()]
        if re.fullmatch(f"[{digits}]+", s[2:]):
            return int(s[2:], base)
        return math.nan
    if _DEC_RE.fullmatch(s):
        if _INT_RE.fullmatch(s):
            v = int(s)
            return v if abs(v) < 2**53 else float(s)
        return float(s)
    return math.nan


def _split_ws(s: str) -> list[str]:
    return WS_RE.split(trim_ws(s))


def _ints_in(tokens: list[str], lo: int, hi: int) -> bool:
    return all(_INT_RE.fullmatch(t) and lo <= int(t) <= hi for t in tokens)


def _get(spec: dict, key: str, default: Any) -> Any:
    v = spec.get(key)
    return default if v is None else v


class Generator:
    name = ""
    edges: dict[str, list[tuple[Any, str]]] = {}
    shrink_candidates: Callable[[str], list[str]] | None = None
    profile_shapes = ("normal",)

    def profile_input(self, n, shape="normal"):
        if shape != "normal":
            raise ValueError(f"Unknown profile shape {shape} for {self.name}")
        return self.of_size(n)

    @property
    def edge_names(self) -> list[str]:
        return list(self.edges)

    def edge(self, name: str) -> list[dict]:
        raise NotImplementedError

    def random(self, rng: Rng, i: int = 0) -> str:
        raise NotImplementedError

    def of_size(self, n: int) -> str:
        raise NotImplementedError

    def validate(self, input: str) -> bool:
        raise NotImplementedError


class TwoInts(Generator):
    name = "two_ints"
    edges = {
        "negatives": [("-5 -7", "both negative"), ("-100 30", "negative plus positive")],
        "zero": [("0 0", "both zero"), ("0 42", "zero plus positive")],
        "int_overflow": [(f"{INT_MAX} 1", "INT_MAX + 1 exceeds 32-bit int"),
                         (f"{INT_MIN} -1", "INT_MIN - 1 below 32-bit int")],
        "int_extremes": [(f"{INT_MAX} {INT_MIN}", "INT_MAX + INT_MIN"), (f"{INT_MIN} 0", "INT_MIN + 0")],
        "large_values": [("1000000000 1000000000", "two billion: exceeds int range")],
        "extra_whitespace": [("   4\t\t  6   \n\n", "tabs, leading/trailing spaces, blank lines"),
                             ("4\n6\n", "numbers on separate lines")],
    }

    def __init__(self, spec: dict | None = None):
        spec = spec or {}
        self.lo = _get(spec, "min", INT_MIN)
        self.hi = _get(spec, "max", INT_MAX)
        if (type(self.lo) is not int or type(self.hi) is not int
                or not INT_MIN <= self.lo <= self.hi <= INT_MAX):
            raise ValueError("two_ints needs ordered 32-bit integer min/max bounds")

    def edge(self, name):
        return [{"input": s if s.endswith("\n") else s + "\n", "why": why} for s, why in self.edges.get(name, [])]

    def random(self, rng, i=0):
        a = biased(rng, self.lo, self.hi)
        b = biased(rng, self.lo, self.hi)
        return f"{number_text(a)} {number_text(b)}\n"

    def of_size(self, n):
        # same digit count for every n, otherwise longer numbers alone would look like O(log n)
        a = max(self.lo, min(self.hi, 1000000 + n))
        b = max(self.lo, min(self.hi, 2000000 + n))
        return f"{number_text(a)} {number_text(b)}\n"

    def validate(self, input):
        """Two integers within [min, max], any whitespace layout."""
        if not isinstance(input, str) or len(input) > MAX_VALID_LEN:
            return False
        toks = _split_ws(input)
        return len(toks) == 2 and _ints_in(toks, self.lo, self.hi)


def _fmt(arr: list) -> str:
    return f"{len(arr)}\n{' '.join(number_text(v) for v in arr)}\n"


class IntArray(Generator):
    name = "int_array"
    profile_shapes = ("normal", "sorted", "reverse", "equal")
    edges = {
        "empty": [([], "n = 0 (no elements)")],
        "single": [([7], "a single element")],
        "sorted": [([1, 2, 3, 4, 5, 6], "already sorted input")],
        "reverse": [([9, 7, 5, 3, 1, -1], "reverse-sorted input")],
        "duplicates": [([4, 1, 4, 1, 4, 1, 4], "many repeated values")],
        "negatives": [([-3, -1, -7, -2], "all negative values")],
        "large_values": [([INT_MAX, INT_MIN, 0, INT_MAX - 1, INT_MIN + 1], "INT_MAX / INT_MIN (comparator overflow)")],
    }

    def __init__(self, spec: dict | None = None):
        spec = spec or {}
        self.min_n = _get(spec, "min_n", 0)
        self.max_n = _get(spec, "max_n", 50)
        self.lo = _get(spec, "min_val", -1000)
        self.hi = _get(spec, "max_val", 1000)
        # random values stay small by default, but any 32-bit value is a legal input
        self.valid_lo = _get(spec, "min_val", INT_MIN)
        self.valid_hi = _get(spec, "max_val", INT_MAX)
        self.valid_max_n = _get(spec, "max_valid_n", MAX_VALID_N)
        if (any(type(v) is not int for v in (self.min_n, self.max_n, self.lo, self.hi, self.valid_max_n))
                or not 0 <= self.min_n <= self.max_n <= MAX_VALID_N
                or not self.min_n <= self.valid_max_n <= MAX_VALID_N
                or not INT_MIN <= self.lo <= self.hi <= INT_MAX):
            raise ValueError("Invalid array length or 32-bit value bounds")
        self.max_n = min(self.max_n, self.valid_max_n)

    def edge(self, name):
        return [{"input": _fmt(arr), "why": why, "arr": list(arr)} for arr, why in self.edges.get(name, [])]

    def random(self, rng, i=0):
        n = rand_int(rng, self.min_n, self.max_n)
        return _fmt([biased(rng, self.lo, self.hi) for _ in range(n)])

    def of_size(self, n):
        if type(n) is not int or not self.min_n <= n <= self.valid_max_n:
            raise ValueError(f"Profiling size {n} is outside the configured array length limits")
        r = mulberry32(1000003 + n)
        lo, hi = max(self.valid_lo, -1000000), min(self.valid_hi, 1000000)
        if lo > hi:
            lo, hi = self.valid_lo, self.valid_hi
        return _fmt([rand_int(r, lo, hi) for _ in range(n)])

    def shrink_candidates(self, input: str) -> list[str]:
        arr = [is_number(t) for t in _split_ws(input)][1:]
        out: list[str] = []
        if len(arr) > 1:
            half = math.ceil(len(arr) / 2)
            out += [_fmt(arr[:half]), _fmt(arr[half:])]
            i = 0
            while i < len(arr) and len(out) < 40:
                out.append(_fmt(arr[:i] + arr[i + 1:]))
                i += 1
        return out

    def profile_input(self, n, shape="normal"):
        text = self.of_size(n)
        values = [int(v) for v in text.split()[1:]]
        if shape == "normal":
            return text
        if shape in ("sorted", "reverse"):
            values.sort(reverse=shape == "reverse")
        elif shape == "equal":
            values = [max(self.valid_lo, min(self.valid_hi, 0))] * n
        else:
            raise ValueError(f"Unknown array profile shape {shape}")
        return _fmt(values)

    def validate(self, input):
        """n on the first token, then exactly n integers within [min_val, max_val]."""
        if not isinstance(input, str) or len(input) > MAX_VALID_LEN:
            return False
        toks = _split_ws(input)
        if not _INT_RE.fullmatch(toks[0]):
            return False
        n = int(toks[0])
        if not self.min_n <= n <= self.valid_max_n or len(toks) - 1 != n:
            return False
        return _ints_in(toks[1:], self.valid_lo, self.valid_hi)


class TextLine(Generator):
    """One ASCII line, with a configurable alphabet; n is character count."""
    name = "text_line"

    def __init__(self, spec=None):
        spec = spec or {}
        self.min_n = spec.get("min_n", 1)
        self.max_n = spec.get("max_n", 200)
        self.alphabet = spec.get("alphabet", "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789.,!?")
        if (type(self.min_n) is not int or type(self.max_n) is not int
                or not 0 <= self.min_n <= self.max_n <= 100000):
            raise ValueError("text_line needs 0 <= min_n <= max_n <= 100000")
        if (not isinstance(self.alphabet, str) or not self.alphabet or not self.alphabet.isascii()
                or any(c in self.alphabet for c in "\r\n\x00")):
            raise ValueError("text_line alphabet must be nonempty ASCII without CR, LF or NUL")

    @property
    def edge_names(self):
        return ["shortest", "longest", "repeated"]

    def edge(self, name):
        cases = {"shortest": self.of_size(self.min_n), "longest": self.of_size(self.max_n),
                 "repeated": self.alphabet[0] * self.max_n + "\n"}
        return [{"input": cases[name], "why": name + " line"}] if name in cases else []

    def _make(self, n, rng):
        if type(n) is not int or not self.min_n <= n <= self.max_n:
            raise ValueError("Line profiling size is outside min_n/max_n")
        return "".join(self.alphabet[rand_int(rng, 0, len(self.alphabet) - 1)] for _ in range(n)) + "\n"

    def random(self, rng, i=0):
        return self._make(rand_int(rng, self.min_n, self.max_n), rng)

    def of_size(self, n):
        return self._make(n, mulberry32(1000003 + n))

    def validate(self, text):
        return (isinstance(text, str) and text.endswith("\n")
                and self.min_n <= len(text) - 1 <= self.max_n
                and all(c in self.alphabet for c in text[:-1]))


class IntMatrix(Generator):
    """Square matrix: n, then n*n integers. n is the side length."""
    name = "int_matrix"

    def __init__(self, spec=None):
        spec = spec or {}
        self.min_n, self.max_n = spec.get("min_n", 1), spec.get("max_n", 20)
        self.lo, self.hi = spec.get("min_val", -1000), spec.get("max_val", 1000)
        if any(type(v) is not int for v in (self.min_n, self.max_n, self.lo, self.hi)):
            raise ValueError("Matrix bounds must be integers")
        if not 1 <= self.min_n <= self.max_n <= 200 or not INT_MIN <= self.lo <= self.hi <= INT_MAX:
            raise ValueError("Matrix needs 1 <= min_n <= max_n <= 200 and ordered 32-bit value bounds")

    @property
    def edge_names(self):
        return ["smallest", "largest", "minimum_values", "maximum_values"]

    def _make(self, n, rng, value=None):
        if type(n) is not int or not self.min_n <= n <= self.max_n:
            raise ValueError("Matrix profiling size is outside min_n/max_n")
        rows = [" ".join(str(rand_int(rng, self.lo, self.hi) if value is None else value)
                         for _ in range(n)) for _ in range(n)]
        return str(n) + "\n" + "\n".join(rows) + "\n"

    def edge(self, name):
        if name not in self.edge_names:
            return []
        n = self.min_n if name == "smallest" else self.max_n
        value = self.lo if name == "minimum_values" else self.hi if name == "maximum_values" else None
        return [{"input": self._make(n, mulberry32(7), value), "why": name}]

    def random(self, rng, i=0):
        return self._make(rand_int(rng, self.min_n, self.max_n), rng)

    def of_size(self, n):
        return self._make(n, mulberry32(1000003 + n))

    def validate(self, text):
        if not isinstance(text, str) or len(text) > MAX_VALID_LEN:
            return False
        tokens = text.split()
        if not tokens or not _INT_RE.fullmatch(tokens[0]):
            return False
        n = int(tokens[0])
        return self.min_n <= n <= self.max_n and len(tokens) == 1 + n*n and _ints_in(tokens[1:], self.lo, self.hi)


REGISTRY: dict[str, type[Generator]] = {"two_ints": TwoInts, "int_array": IntArray,
                                        "text_line": TextLine, "int_matrix": IntMatrix}
GENERATORS = list(REGISTRY)


def get_generator(spec: dict | None) -> Generator:
    name = (spec or {}).get("generator")
    make = REGISTRY.get(name) if isinstance(name, str) else None
    if make is None:
        shown = "undefined" if name is None else name
        raise ValueError(f'unknown input generator "{shown}" (known: {", ".join(GENERATORS)})')
    return make(spec)
