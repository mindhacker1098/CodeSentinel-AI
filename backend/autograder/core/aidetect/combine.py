"""Turn comparison/style signals into an explicitly uncalibrated heuristic band.

Stylometry alone is weak evidence, so on its own it can reach "elevated" at
most. "high" needs a close match to the generated corpus or a Binoculars
score below its threshold.
"""
from __future__ import annotations

import math

BANDS = ["insufficient_evidence", "low", "uncertain", "elevated", "high"]
THRESHOLDS = [(0.75, "high"), (0.5, "elevated"), (0.25, "uncertain")]

DISCLAIMER = ("This is an uncalibrated heuristic signal, not an authorship probability or proof. Code written with or without an AI tool can look "
              "either way, and short programs carry little signal. Use it only to decide whether to talk with "
              "the student; never as the sole basis for an academic-integrity decision.")

MIN_TOKENS = 25
CONTAINMENT_STRONG = 0.85
BINOCULARS_THRESHOLD = 0.9


def _r2(x: float) -> float:
    return math.floor(x * 100 + 0.5) / 100


def _clamp(x: float) -> float:
    return max(0.0, min(1.0, x))


def band_of(p: float, strong: bool, cap: str = "high") -> str:
    """Band for p; without a strong signal the band stops at elevated, and never goes above cap."""
    name = next((n for cut, n in THRESHOLDS if p >= cut), "low")
    if name == "high" and not strong:
        name = "elevated"
    return BANDS[min(BANDS.index(name), BANDS.index(cap))]


def combine(*, containment: float | None = None, containment_fingerprints: int = 0, stylometry: dict | None = None,
            binoculars: float | None = None, n_tokens: int = 0, min_fingerprints: int = 6,
            confident_fingerprints: int = 15) -> dict:
    """Compatibility probability fields stay null; the index is not a probability."""
    evidence = []
    terms: list[tuple[float, float]] = []
    strong = False
    cap = "high"

    if containment is not None and containment_fingerprints >= min_fingerprints:
        c = _clamp((containment - 0.5) / (CONTAINMENT_STRONG - 0.5))
        note = " (above the copy threshold)" if containment >= CONTAINMENT_STRONG else ""
        if containment_fingerprints < confident_fingerprints:
            # short programs match any generated solution; like similarity_flag, this is low confidence
            terms.append((c, 0.2))
            cap = "uncertain"
            note = f" but only {containment_fingerprints} fingerprints, so little weight"
        else:
            terms.append((c, 0.5))
            strong |= containment >= CONTAINMENT_STRONG
        evidence.append(f"closest generated program shares {containment * 100:.0f}% of fingerprints{note}")
    elif containment is not None:
        evidence.append("too few fingerprints to compare with the generated corpus")

    if stylometry and stylometry.get("n_features", 0) >= 3:
        terms.append((stylometry["score"], 0.3))
        top = sorted(((v, k) for k, v in stylometry["z"].items() if v > 0.5), reverse=True)[:3]
        basis = "the class" if stylometry.get("basis") == "class" else "typical student code"
        what = ", ".join(k.replace("_", " ") for _, k in top) or "no feature stands out"
        evidence.append(f"style score {stylometry['score']:.2f} against {basis} ({what})")

    if binoculars is not None:
        b = _clamp((BINOCULARS_THRESHOLD + 0.1 - binoculars) / 0.2)
        terms.append((b, 0.4))
        strong |= binoculars < BINOCULARS_THRESHOLD
        evidence.append(f"Binoculars score {binoculars:.3f} (machine-like below {BINOCULARS_THRESHOLD})")

    signals = {"containment": containment, "stylometry": stylometry["score"] if stylometry else None,
               "binoculars": binoculars}
    if not terms or n_tokens < MIN_TOKENS:
        if n_tokens < MIN_TOKENS:
            evidence.append(f"only {n_tokens} tokens: too short to judge")
        return {"band": "insufficient_evidence", "p": None, "p_range": None, "signals": signals,
                "evidence": evidence, "disclaimer": DISCLAIMER}

    p = sum(v * w for v, w in terms) / sum(w for _, w in terms)
    return {
        "band": band_of(p, strong, cap),
        "p": None,
        "p_range": None,
        "heuristic_index": _r2(p),
        "signals": signals,
        "evidence": evidence,
        "disclaimer": DISCLAIMER,
    }
