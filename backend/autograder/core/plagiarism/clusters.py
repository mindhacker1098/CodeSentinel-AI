"""Union-find clustering of similar pairs."""
from __future__ import annotations

import re
from collections.abc import Iterable

_KIND_ORDER = {"sub": 0, "web": 1, "llm": 2}
_NUM = re.compile(r"\d+")


def ref_key(ref: str) -> tuple:
    """Order refs as sub:<id> numerically, then web:, then llm: by name."""
    kind, _, rest = ref.partition(":")
    if _NUM.fullmatch(rest):
        return _KIND_ORDER.get(kind, 3), kind, int(rest), ""
    return _KIND_ORDER.get(kind, 3), kind, -1, rest


class UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        self.parent.setdefault(x, x)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        # smaller ref becomes the root so the result does not depend on pair order
        if ref_key(rb) < ref_key(ra):
            ra, rb = rb, ra
        self.parent[rb] = ra


def build_clusters(pairs: Iterable[tuple[str, str, float]], threshold: float) -> list[dict]:
    """Connected components of the pairs with sim >= threshold.

    Returns [{id, members, size, max_sim, n_submissions}] largest first.
    """
    uf = UnionFind()
    best: dict[str, float] = {}
    for a, b, sim in pairs:
        if sim < threshold:
            continue
        uf.union(a, b)
        root = uf.find(a)
        best[root] = max(best.get(root, 0), sim)
    groups: dict[str, list[str]] = {}
    for x in list(uf.parent):
        groups.setdefault(uf.find(x), []).append(x)
    # max_sim was recorded under roots that may have been merged since
    top: dict[str, float] = {}
    for root, sim in best.items():
        r = uf.find(root)
        top[r] = max(top.get(r, 0), sim)
    out = []
    for root, members in groups.items():
        members.sort(key=ref_key)
        out.append({"members": members, "size": len(members), "max_sim": top.get(root, 0),
                    "n_submissions": sum(1 for m in members if m.startswith("sub:"))})
    out.sort(key=lambda c: (-c["size"], ref_key(c["members"][0])))
    for i, c in enumerate(out, 1):
        c["id"] = i
    return [{"id": c["id"], **{k: v for k, v in c.items() if k != "id"}} for c in out]
