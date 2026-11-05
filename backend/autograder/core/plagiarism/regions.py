"""Map shared fingerprints of two files to matching line ranges."""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

# two matches belong to the same region if both sides advance by at most this many tokens
MAX_GAP = 12


def _fp(f: Any) -> tuple[int, int, int, int]:
    if isinstance(f, dict):
        return f["hash"], f["tok_start"], f["line_start"], f["line_end"]
    return f[0], f[1], f[2], f[3]


def _anchors(fps_a: Sequence[Any], fps_b: Sequence[Any], shared: set[int]) -> list[tuple]:
    """Pairs (a_fp, b_fp) for every shared hash, occurrences paired in order."""
    pos_b: dict[int, list[tuple]] = {}
    for f in sorted(map(_fp, fps_b), key=lambda t: t[1]):
        if f[0] in shared:
            pos_b.setdefault(f[0], []).append(f)
    used: dict[int, int] = {}
    out = []
    for f in sorted(map(_fp, fps_a), key=lambda t: t[1]):
        cands = pos_b.get(f[0])
        if not cands:
            continue
        i = used.get(f[0], 0)
        # extra occurrences in a reuse the last occurrence in b
        out.append((f, cands[min(i, len(cands) - 1)]))
        used[f[0]] = i + 1
    return out


def regions(fps_a: Sequence[Any], fps_b: Sequence[Any], shared: Iterable[int] | None = None,
            max_gap: int = MAX_GAP) -> list[dict]:
    """Merged line ranges [{a:[l1,l2], b:[l1,l2], shared, color}] ordered by position in a.

    fps_* are similarity.Fingerprint tuples (hash, tok_start, line_start, line_end)
    or fingerprint rows as dicts. shared defaults to the common hashes.
    """
    if shared is None:
        shared = {_fp(f)[0] for f in fps_a} & {_fp(f)[0] for f in fps_b}
    shared = set(shared)
    runs: list[dict] = []
    cur = None
    for fa, fb in _anchors(fps_a, fps_b, shared):
        if cur is not None:
            da = fa[1] - cur["ta"]
            db = fb[1] - cur["tb"]
            if 0 <= da <= max_gap and 0 <= db <= max_gap:
                cur["a"][1] = max(cur["a"][1], fa[3])
                cur["b"][0] = min(cur["b"][0], fb[2])
                cur["b"][1] = max(cur["b"][1], fb[3])
                cur["ta"], cur["tb"] = fa[1], fb[1]
                cur["hashes"].add(fa[0])
                continue
        cur = {"a": [fa[2], fa[3]], "b": [fb[2], fb[3]], "ta": fa[1], "tb": fb[1], "hashes": {fa[0]}}
        runs.append(cur)
    out = _merge_overlaps(runs)
    return [{"a": r["a"], "b": r["b"], "shared": len(r["hashes"]), "color": i} for i, r in enumerate(out)]


def _merge_overlaps(runs: list[dict]) -> list[dict]:
    """Join runs whose line ranges overlap on both sides."""
    out: list[dict] = []
    for r in runs:
        for o in out:
            if (r["a"][0] <= o["a"][1] and o["a"][0] <= r["a"][1]
                    and r["b"][0] <= o["b"][1] and o["b"][0] <= r["b"][1]):
                o["a"] = [min(o["a"][0], r["a"][0]), max(o["a"][1], r["a"][1])]
                o["b"] = [min(o["b"][0], r["b"][0]), max(o["b"][1], r["b"][1])]
                o["hashes"] |= r["hashes"]
                break
        else:
            out.append(r)
    out.sort(key=lambda r: (r["a"][0], r["b"][0]))
    return out


def swap(regs: list[dict]) -> list[dict]:
    """Same regions seen from the other file."""
    return [{**r, "a": r["b"], "b": r["a"]} for r in regs]


def pair_detail(session, scan_id: int, a_ref: str, b_ref: str) -> dict | None:
    """Both sources of a stored pair with their shared regions, for the side-by-side view."""
    from sqlmodel import select

    from ...db.models import PlagiarismScan, SimilarityPair
    from .pairwise import load_ref

    scan = session.get(PlagiarismScan, scan_id)
    if scan is None:
        return None
    pair = session.exec(select(SimilarityPair).where(SimilarityPair.scan_id == scan_id,
                                                     SimilarityPair.a_ref == a_ref,
                                                     SimilarityPair.b_ref == b_ref)).first()
    flipped = False
    if pair is None:
        pair = session.exec(select(SimilarityPair).where(SimilarityPair.scan_id == scan_id,
                                                         SimilarityPair.a_ref == b_ref,
                                                         SimilarityPair.b_ref == a_ref)).first()
        flipped = pair is not None
    if pair is None:
        return None
    regs = pair.regions_json or []
    if flipped:
        regs = swap(regs)
    sides = {}
    for key, ref in (("a", a_ref), ("b", b_ref)):
        label, source = load_ref(session, scan, ref)
        sides[key] = {"ref": ref, "label": label, "source": source}
    return {**sides, "sim": pair.sim, "ast_sim": pair.ast_sim, "shared": pair.shared,
            "regions": [{"a": r["a"], "b": r["b"], "shared": r["shared"], "color": r.get("color", i)}
                        for i, r in enumerate(regs)]}
