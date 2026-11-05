"""Structural similarity from tree-sitter-c subtree hashes (corroborating signal only).

Identifiers and literals are erased, so renaming variables does not hide a copy.
Every function returns None when tree-sitter is not installed.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from functools import lru_cache

from ..textfmt import round3

ERASE_ID = {"identifier", "field_identifier", "type_identifier", "statement_identifier"}
ERASE_LIT = {"number_literal", "string_literal", "char_literal", "concatenated_string",
             "system_lib_string", "true", "false", "null"}
SKIP = {"comment"}
MIN_NODES = 5


@lru_cache(maxsize=1)
def _parser():
    try:
        import tree_sitter_c
        from tree_sitter import Language, Parser
        return Parser(Language(tree_sitter_c.language()))
    except Exception:  # noqa: BLE001
        return None


def available() -> bool:
    return _parser() is not None


def _h(s: str) -> str:
    return hashlib.blake2b(s.encode("utf-8"), digest_size=8).hexdigest()


def subtree_hashes(source: str, min_nodes: int = MIN_NODES) -> Counter | None:
    """Multiset of hashes of all subtrees with at least min_nodes nodes."""
    parser = _parser()
    if parser is None:
        return None
    root = parser.parse(source.encode("utf-8", errors="replace")).root_node
    out: Counter = Counter()
    memo: dict[int, tuple[str, int]] = {}
    stack = [(root, False)]
    while stack:
        node, done = stack.pop()
        if node.type in ERASE_ID:
            memo[node.id] = (_h("ID"), 1)
            continue
        if node.type in ERASE_LIT:
            memo[node.id] = (_h("LIT"), 1)
            continue
        kids = [c for c in node.children if c.type not in SKIP]
        if not done:
            stack.append((node, True))
            stack.extend((c, False) for c in kids)
            continue
        parts = [memo.pop(c.id) for c in kids]
        size = 1 + sum(n for _, n in parts)
        h = _h(node.type + "(" + ",".join(p for p, _ in parts) + ")")
        memo[node.id] = (h, size)
        if size >= min_nodes:
            out[h] += 1
    return out


def containment(a: Counter | None, b: Counter | None) -> float | None:
    if a is None or b is None:
        return None
    na, nb = sum(a.values()), sum(b.values())
    if not na or not nb:
        return 0.0
    shared = sum((a & b).values())
    return shared / min(na, nb)


def ast_similarity(src_a: str, src_b: str) -> float | None:
    """Multiset containment of erased subtree hashes, rounded to 3 places."""
    c = containment(subtree_hashes(src_a), subtree_hashes(src_b))
    return None if c is None else round3(c)
