"""Winnowed k-gram fingerprints over normalized tokens."""
from __future__ import annotations

from typing import Any, Iterable, NamedTuple

from .cparse import normalized_tokens, normalized_tokens_with_lines
from .hashing import fnv1a32
from .textfmt import locale_key, to_fixed


class Fingerprint(NamedTuple):
    hash: int
    tok_start: int
    line_start: int
    line_end: int


def _gram_hashes(toks: list[str], k: int) -> list[int]:
    return [fnv1a32(" ".join(toks[i:i + k])) for i in range(len(toks) - k + 1)]


def _winnow(hashes: list[int], w: int) -> list[int]:
    """Indices picked by winnowing (leftmost minimum of each window), in order."""
    if len(hashes) <= w:
        return list(range(len(hashes)))
    picked: dict[int, None] = {}
    for i in range(len(hashes) - w + 1):
        best = i
        for j in range(i + 1, i + w):
            if hashes[j] < hashes[best]:
                best = j
        picked[best] = None
    return list(picked)


def fingerprint_list(src: str, k: int = 5, w: int = 4) -> list[int]:
    """Distinct fingerprints in first-seen order."""
    toks = normalized_tokens(src)
    if len(toks) < k:
        return []
    hashes = _gram_hashes(toks, k)
    return list(dict.fromkeys(hashes[i] for i in _winnow(hashes, w)))


def fingerprints(src: str, k: int = 5, w: int = 4) -> set[int]:
    return set(fingerprint_list(src, k, w))


def fingerprints_with_pos(src: str, k: int = 5, w: int = 4) -> list[Fingerprint]:
    """Selected fingerprints with the token index and line range of their k-gram."""
    toks = normalized_tokens_with_lines(src)
    if len(toks) < k:
        return []
    hashes = _gram_hashes([t for t, _ in toks], k)
    return [Fingerprint(hashes[i], i, toks[i][1], toks[i + k - 1][1]) for i in _winnow(hashes, w)]


def containment(a: set[int], b: set[int]) -> float:
    if not a or not b:
        return 0
    small, big = (a, b) if len(a) <= len(b) else (b, a)
    shared = sum(1 for h in small if h in big)
    return shared / len(small)


def _field(item: Any, name: str) -> Any:
    if isinstance(item, dict):
        return item[name]
    if name == "id":
        return getattr(item, "ref", None) or getattr(item, "id")
    return getattr(item, name)


def compare_to_corpus(
    source: str,
    corpus: Iterable[Any],
    base_sources: Iterable[str] = (),
    common_fraction: float = 0.5,
    k: int = 5,
    w: int = 4,
) -> dict:
    """Containment of source against each corpus item (dicts with id/kind/source or CorpusItem)."""
    corpus = list(corpus)
    ignore: set[int] = set()
    for s in base_sources:
        ignore |= fingerprints(s, k, w)

    # fingerprints shared by half the class are boilerplate, not copying
    peers = [c for c in corpus if _field(c, "kind") == "peer"]
    if len(peers) >= 4:
        counts: dict[int, int] = {}
        for p in peers:
            for h in fingerprints(_field(p, "source"), k, w):
                counts[h] = counts.get(h, 0) + 1
        ignore |= {h for h, n in counts.items() if n / len(peers) >= common_fraction}

    mine = fingerprints(source, k, w) - ignore
    matches = []
    for c in corpus:
        theirs = fingerprints(_field(c, "source"), k, w) - ignore
        matches.append({
            "id": _field(c, "id"),
            "kind": _field(c, "kind"),
            "similarity": float(to_fixed(containment(mine, theirs), 3)),
            "fingerprints": len(theirs),
        })
    matches.sort(key=lambda m: (-m["similarity"], locale_key(m["id"])))
    return {"fingerprints": len(mine), "ignored": len(ignore), "matches": matches}
