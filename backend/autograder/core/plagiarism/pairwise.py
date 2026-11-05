"""Class-wide plagiarism scan: every latest submission against every other and the web/llm corpus."""
from __future__ import annotations

from dataclasses import dataclass, field
from itertools import combinations
from pathlib import Path

from sqlmodel import Session, select

from ...db import repo
from ...db.models import (
    CorpusItemRow,
    PlagiarismScan,
    Problem,
    SimilarityPair,
    Submission,
    User,
)
from ...db.models import (
    Fingerprint as FingerprintRow,
)
from ..corpus import read_c_sources, read_text
from ..textfmt import to_fixed
from ..similarity import Fingerprint, fingerprints, fingerprints_with_pos
from . import ast_sim
from .clusters import build_clusters, ref_key
from .regions import regions

COMMON_FRACTION = 0.5
MIN_PEERS_FOR_COMMON = 4


@dataclass
class Item:
    ref: str
    kind: str  # sub | web | llm
    source: str
    fps: list[Fingerprint] = field(default_factory=list)
    hashes: set[int] = field(default_factory=set)


def _sub_fingerprints(session: Session, sub: Submission, k: int, w: int) -> list[Fingerprint]:
    rows = session.exec(select(FingerprintRow).where(FingerprintRow.submission_id == sub.id)
                        .order_by(FingerprintRow.id)).all()
    if rows and (k, w) == (5, 4):
        return [Fingerprint(r.hash, r.tok_start, r.line_start, r.line_end) for r in rows]
    fps = fingerprints_with_pos(sub.source, k, w)
    if (k, w) == (5, 4):
        repo.store_fingerprints(session, sub.problem_id, sub.id, fps)
    return fps


def _corpus_items(session: Session, problem_id: int, root: Path) -> list[Item]:
    items = [Item(c.ref, c.kind, c.source) for kind in ("web", "llm")
             for c in read_c_sources(root / "corpus" / kind, kind)]
    seen = {i.ref for i in items}
    rows = session.exec(select(CorpusItemRow).where(CorpusItemRow.problem_id == problem_id)
                        .order_by(CorpusItemRow.id)).all()
    for r in rows:
        p = Path(r.path)
        ref = f"{r.kind}:{p.name}"
        if ref not in seen and p.is_file():
            items.append(Item(ref, r.kind, read_text(p)))
            seen.add(ref)
    return items


def _base_hashes(root: Path, rules: dict, k: int, w: int) -> set[int]:
    """Fingerprints of the starter code handed to students. The reference solution is not
    boilerplate: it is compared like a corpus item, so a leaked solution shows up as a pair."""
    out: set[int] = set()
    for key in ("starter_code",):
        name = rules.get(key)
        if name and (root / name).is_file():
            out |= fingerprints(read_text(root / name), k, w)
    return out


def _sim(a: set[int], b: set[int]) -> tuple[float, set[int]]:
    if not a or not b:
        return 0.0, set()
    shared = a & b
    return float(to_fixed(len(shared) / min(len(a), len(b)), 3)), shared


def run_scan(session: Session, problem_id: int, threshold: float = 0.85, min_sim: float = 0.5, *,
             use_ast: bool = True, k: int = 5, w: int = 4) -> int:
    """Scan the current version of a problem; stores pairs and clusters and returns the scan id."""
    problem = session.get(Problem, problem_id)
    if problem is None:
        raise ValueError(f"no problem with id {problem_id}")
    pv = repo.current_version(session, problem)
    if pv is None:
        raise ValueError(f"problem {problem.slug} has no version")
    root = Path(pv.dir_path)
    rules = pv.rules_json or {}

    subs = repo.latest_submissions_per_user(session, problem_id)
    items = [Item(f"sub:{s.id}", "sub", s.source, _sub_fingerprints(session, s, k, w)) for s in subs]
    for it in items:
        it.hashes = {f.hash for f in it.fps}
    corpus = _corpus_items(session, problem_id, root)
    ref_name = rules.get("reference_solution")
    if ref_name and (root / ref_name).is_file():
        corpus.append(Item(f"reference:{Path(ref_name).name}", "reference", read_text(root / ref_name)))
    for it in corpus:
        it.fps = fingerprints_with_pos(it.source, k, w)
        it.hashes = {f.hash for f in it.fps}

    ignore = _base_hashes(root, rules, k, w)
    n_common = 0
    if len(items) >= MIN_PEERS_FOR_COMMON:
        counts: dict[int, int] = {}
        for it in items:
            for h in it.hashes:
                counts[h] = counts.get(h, 0) + 1
        common = {h for h, n in counts.items() if n / len(items) >= COMMON_FRACTION}
        n_common = len(common - ignore)
        ignore |= common
    for it in (*items, *corpus):
        it.hashes -= ignore

    pairs = [*combinations(items, 2), *((a, b) for a in items for b in corpus)]
    trees: dict[str, object] = {}
    do_ast = use_ast and ast_sim.available()

    scan = PlagiarismScan(problem_id=problem_id, threshold=threshold, n_submissions=len(items),
                          params={"min_sim": min_sim, "k": k, "w": w, "common_fraction": COMMON_FRACTION,
                                  "ignored": len(ignore), "common": n_common, "version_id": pv.id,
                                  "corpus_root": str(root), "n_corpus": len(corpus), "ast": do_ast})
    session.add(scan)
    session.flush()

    kept = []
    for a, b in pairs:
        sim, shared = _sim(a.hashes, b.hashes)
        if sim < min_sim:
            continue
        if ref_key(b.ref) < ref_key(a.ref):
            a, b = b, a
        ast = None
        if do_ast:
            for it in (a, b):
                if it.ref not in trees:
                    trees[it.ref] = ast_sim.subtree_hashes(it.source)
            c = ast_sim.containment(trees[a.ref], trees[b.ref])
            ast = None if c is None else float(to_fixed(c, 3))
        regs = regions(a.fps, b.fps, shared)
        kept.append((a.ref, b.ref, sim))
        session.add(SimilarityPair(scan_id=scan.id, a_ref=a.ref, b_ref=b.ref, sim=sim, ast_sim=ast,
                                   shared=len(shared), regions_json=regs))

    scan.clusters_json = build_clusters(kept, threshold)
    session.add(scan)
    session.commit()
    return scan.id


def latest_scan(session: Session, problem_id: int) -> PlagiarismScan | None:
    return session.exec(select(PlagiarismScan).where(PlagiarismScan.problem_id == problem_id)
                        .order_by(PlagiarismScan.id.desc())).first()


def scan_pairs(session: Session, scan_id: int, min_sim: float = 0.5) -> list[SimilarityPair]:
    """Pairs of a scan, most similar first."""
    rows = session.exec(select(SimilarityPair).where(SimilarityPair.scan_id == scan_id,
                                                     SimilarityPair.sim >= min_sim)).all()
    return sorted(rows, key=lambda p: (-p.sim, ref_key(p.a_ref), ref_key(p.b_ref)))


def load_ref(session: Session, scan: PlagiarismScan, ref: str) -> tuple[str, str]:
    """(label, source) for a pair side."""
    kind, _, rest = ref.partition(":")
    if kind == "sub":
        sub = session.get(Submission, int(rest))
        if sub is None:
            return ref, ""
        user = session.get(User, sub.user_id)
        who = user.roll_no if user else f"user {sub.user_id}"
        return f"{who} ({sub.filename})", sub.source
    root = (scan.params or {}).get("corpus_root")
    if kind == "reference":
        path = Path(root) / rest if root else None
        source = read_text(path) if path is not None and path.is_file() else ""
        return "instructor's reference solution", source
    path = Path(root) / "corpus" / kind / rest if root else None
    if path is None or not path.is_file():
        rows = session.exec(select(CorpusItemRow).where(CorpusItemRow.problem_id == scan.problem_id,
                                                        CorpusItemRow.kind == kind)).all()
        path = next((Path(r.path) for r in rows if Path(r.path).name == rest), None)
    source = read_text(path) if path is not None and path.is_file() else ""
    return f"{kind} corpus: {rest}", source
