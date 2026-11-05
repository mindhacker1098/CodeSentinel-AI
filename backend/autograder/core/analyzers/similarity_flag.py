"""Winnowing similarity against peers, web and LLM solutions."""
from __future__ import annotations

from ..corpus import FolderCorpus
from ..textfmt import number_text
from ..manifest import check_permission
from ..similarity import compare_to_corpus, containment, fingerprints
from .base import AnalyzerResult, GradeContext, LogFn

# a copy padded with junk statements drops just below the token threshold; when the
# syntax-tree comparison agrees, it is flagged for review (never penalised automatically)
REVIEW_TOKEN_MIN = 0.75
REVIEW_AST_MIN = 0.70

WHERE = {"peer": "another student's submission", "web": "a known online solution", "llm": "an LLM-generated solution"}


class SimilarityFlag:
    name = "similarity_flag"
    kind = "source"
    description = "Winnowing fingerprint similarity against peers, known web solutions and LLM-generated solutions."

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        check_permission("fs:read", log)
        threshold = params.get("flag_threshold")
        threshold = 0.85 if threshold is None else threshold
        min_fp = params.get("min_fingerprints")
        min_fp = 6 if min_fp is None else min_fp
        confident_fp = params.get("confident_fingerprints")
        confident_fp = 15 if confident_fp is None else confident_fp

        provider = ctx.corpus or FolderCorpus(ctx.problem_dir, ctx.filename, params.get("corpus_dir") or None)
        # Providers exclude the submitting student; DB mode retains identical peer copies.
        corpus = provider.peers(ctx.rules.get("problem"), ctx.source)
        counts = {kind: sum(c.kind == kind for c in corpus) for kind in ("peer", "web", "llm")}
        if not corpus:
            log({"kind": "tool", "msg": "similarity_flag: not assessed; no comparison sources"})
            return {
                "score": 1,  # Neutral grading value, never an originality percentage.
                "informational": True,
                "evidence": {"assessment": "not_assessed", "comparison_count": 0, "source_counts": counts,
                             "threshold": threshold, "confidence": "none", "top_matches": []},
                "feedback": "Not assessed: no comparison sources are available. Add peer submissions or a known-source "
                            "corpus. This does not establish originality.",
            }
        n_peers = sum(1 for c in corpus if c.kind == "peer")
        # only starter code handed to students is boilerplate; the reference solution is not, since a
        # copy of it (a leaked solution) would otherwise lose all its fingerprints and pass unnoticed
        base = [s for s in (ctx.starter,) if s]
        res = compare_to_corpus(ctx.source, corpus, base_sources=base)
        if ctx.reference:
            mine = fingerprints(ctx.source)
            ref_fp = fingerprints(ctx.reference)
            ref_sim = containment(mine, ref_fp) if mine and ref_fp else 0.0
            if ref_sim >= threshold and len(mine) >= confident_fp:
                rs = number_text(round(ref_sim, 3))
                log({"kind": "tool", "msg": f"similarity_flag: matches the reference solution ({rs})"})
                return {
                    "score": 0,
                    "evidence": {"comparison_count": len(corpus) + 1, "source_counts": counts,
                                 "threshold": threshold, "confidence": "high", "assessment": "review_required",
                                 "distinctive_fingerprints": len(mine), "reference_similarity": ref_sim,
                                 "top_matches": [{"id": "reference", "kind": "reference", "similarity": ref_sim}]},
                    "feedback": f"Similarity {rs} with the instructor's reference solution exceeds the "
                                f"{number_text(threshold)} threshold. Originality marks are withheld until an "
                                "admin reviews the flag.",
                    "flags": [{"type": "suspected_copy_reference",
                               "detail": f"{rs} similarity with the reference solution"}],
                }
        matches = res["matches"]
        top = matches[0] if matches else None
        sim = number_text(top["similarity"]) if top else "0"
        th = number_text(threshold)
        fp = res["fingerprints"]
        shown = f"{top['id']} = {sim}" if top else "none"
        log({"kind": "tool", "msg": f"similarity_flag: {len(corpus)} corpus files ({n_peers} peers); top match {shown}"})

        evidence = {
            "comparison_count": len(corpus),
            "source_counts": counts,
            "threshold": threshold,
            "distinctive_fingerprints": fp,
            "ignored_boilerplate_fingerprints": res["ignored"],
            "top_matches": matches[:5],
        }
        if fp < min_fp:
            return {
                "score": 1,
                "informational": True,
                "evidence": {**evidence, "confidence": "low", "assessment": "insufficient_code"},
                "feedback": f"Too little distinctive code to judge originality ({fp} fingerprints after removing "
                            "boilerplate); not flagged.",
            }
        # short programs: flag for a human but do not cut the score
        if top and top["similarity"] >= threshold and fp < confident_fp:
            return {
                "score": 1,
                "evidence": {**evidence, "confidence": "low", "assessment": "limited_evidence"},
                "feedback": f"Similarity {sim} with {top['id']}, but only {fp} distinctive fingerprints: too little "
                            "code to treat as evidence. Flagged for review, not penalised.",
                "flags": [{"type": "possible_copy_low_confidence",
                           "detail": f"{sim} similarity with {top['id']} on a short program ({fp} fingerprints)"}],
            }
        if top and top["similarity"] >= threshold:
            return {
                "score": 0,
                "evidence": {**evidence, "confidence": "high", "assessment": "review_required"},
                "feedback": f"Similarity {sim} with {WHERE.get(top['kind'], 'undefined')} ({top['id']}) exceeds the "
                            f"{th} threshold. Originality marks are withheld until an admin reviews the flag.",
                "flags": [{"type": f"suspected_copy_{top['kind']}", "detail": f"{sim} similarity with {top['id']}"}],
                "suggestions": ["Discuss the matched code with your admin; similarity alone does not establish copying."],
            }
        if top and top["similarity"] >= params.get("review_token_min", REVIEW_TOKEN_MIN):
            from ..plagiarism.ast_sim import ast_similarity
            by_id = {getattr(c, "ref", None): c for c in corpus}
            for m in matches[:5]:
                if m["similarity"] < params.get("review_token_min", REVIEW_TOKEN_MIN):
                    break
                item = by_id.get(m["id"])
                ast = ast_similarity(ctx.source, item.source) if item is not None else None
                if ast is not None and ast >= params.get("review_ast_min", REVIEW_AST_MIN):
                    msim = number_text(m["similarity"])
                    return {
                        "score": 1,
                        "evidence": {**evidence, "confidence": "medium", "assessment": "review_suggested",
                                     "ast_similarity": ast},
                        "feedback": f"Token similarity {msim} and syntax-tree similarity {number_text(ast)} with "
                                    f"{m['id']}: below the copy threshold but structurally close. Flagged for "
                                    "review; no automatic deduction.",
                        "flags": [{"type": "possible_copy_low_confidence",
                                   "detail": f"{msim} token / {number_text(ast)} AST similarity with {m['id']}"}],
                    }
        return {
            "score": 1,
            "evidence": {**evidence, "confidence": "normal", "assessment": "compared"},
            "feedback": f"Compared with {len(corpus)} source(s). Max similarity {sim} "
                        f"({top['id'] if top else 'no match'}), below the {th} threshold. "
                        "This comparison does not prove originality.",
        }


ANALYZER = SimilarityFlag()
