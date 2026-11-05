"""ai_detector: comparison/style signals for human review (flag only).

Signals: containment against corpus/llm, stylometry against the class (or
priors) and an optional Binoculars score. The score always stays 1;
the possible_ai_generated flag is raised only for
the "high" band.
"""
from __future__ import annotations

from ..aidetect import binoculars, stylometry
from ..aidetect.combine import combine
from ..cparse import tokenize
from ..similarity import compare_to_corpus
from .base import AnalyzerResult, GradeContext, LogFn


class AiDetector:
    name = "ai_detector"
    kind = "source"
    description = "Estimates AI origin from generated-corpus overlap, style features and (optionally) Binoculars"

    async def run(self, ctx: GradeContext, params: dict, log: LogFn) -> AnalyzerResult:
        items = ctx.corpus.peers(ctx.rules.get("problem"), ctx.source) if ctx.corpus else []
        llm_items = [c for c in items if c.kind == "llm"]
        peer_sources = [c.source for c in items if c.kind == "peer"]
        base = [s for s in (ctx.reference, ctx.starter) if s]

        containment = None
        top = None
        fps = 0
        if llm_items:
            res = compare_to_corpus(ctx.source, llm_items, base)
            fps = res["fingerprints"]
            if res["matches"]:
                top = res["matches"][0]
                containment = top["similarity"]

        style = stylometry.score(ctx.source, peer_sources)
        bino = await binoculars.score(ctx.source, ctx.settings) if params.get("binoculars", True) else None
        n_tokens = len(tokenize(ctx.source)["tokens"])
        out = combine(containment=containment, containment_fingerprints=fps, stylometry=style, binoculars=bino,
                      n_tokens=n_tokens, min_fingerprints=params.get("min_fingerprints") or 6,
                      confident_fingerprints=params.get("confident_fingerprints") or 15)
        band = out["band"]

        score = 1.0  # Authorship signals are advisory, even with an old penalize setting.
        flags = []
        if band == "high":
            flags.append({"type": "possible_ai_generated",
                          "detail": "High heuristic signal (not an authorship probability): "
                                    + "; ".join(out["evidence"][:2]),
                          "severity": "medium"})
        log({"kind": "warn" if band in ("elevated", "high") else "plan",
             "msg": f"ai_detector: band {band}" + (f", p {out['p_range'][0]}-{out['p_range'][1]}" if out["p_range"]
                                                   else "")})
        evidence = {
            "band": band,
            "p_range": out["p_range"],
            "signals": out["signals"],
            "closest_llm": top["id"] if top else None,
            "stylometry": {"basis": style["basis"], "z": style["z"], "features": style["features"]},
            "evidence": out["evidence"],
            "disclaimer": out["disclaimer"],
        }
        feedback = {
            "insufficient_evidence": "Not enough evidence to estimate AI origin.",
            "low": "Low heuristic signal; this does not establish who wrote the code.",
            "uncertain": "Mixed signals about AI origin; nothing to act on.",
            "elevated": "Some signs of AI-generated code; worth a conversation, not a conclusion.",
            "high": "High heuristic signal; review the underlying evidence without assuming AI authorship.",
        }[band]
        return {"score": score, "informational": True, "evidence": evidence, "feedback": feedback, "flags": flags}


ANALYZER = AiDetector()
