"""Which outcomes are servable, and the derived-score registry.

Shared data semantics for the two consumers of the engine — the API and
the pipeline's static-aggregate exporter — exactly as the weight table is
(ADR-0005/0008): one home, no drift. Plain dataclasses only; this module
adds no dependencies to the package.
"""

from __future__ import annotations

from dataclasses import dataclass

#: Catalog `scale_type` values an outcome may have to be aggregated.
SERVABLE_SCALE_TYPES = frozenset({"scale_0_10", "ordinal", "binary", "nominal", "count"})

#: Waves the derived outcomes exist at (derive.py builds Y1 + Y2; the MY
#: rows carry only the midyear priorities, which ship in Phase 5).
DERIVED_WAVES: tuple[str, ...] = ("Y1", "Y2")


@dataclass(frozen=True)
class DerivedOutcome:
    """A score computed by the pipeline, served like any catalog item."""

    column: str  # column of the `derived` table
    scale_type: str  # kind used by query validation
    min: int
    max: int
    direction: str
    display_name: str
    description: str


#: Derived outcomes served from the `derived` table (proposal §5.2 step 4).
#: The screeners run higher = more symptomatic → lower_better.
DERIVED_OUTCOMES: dict[str, DerivedOutcome] = {
    "sfi": DerivedOutcome(
        "sfi",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "Secure Flourishing Index",
        "Mean of the 12 SFI items (≥ 10 answered), 0–10.",
    ),
    "sfi_happiness": DerivedOutcome(
        "sfi_happiness",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: happiness & life satisfaction",
        "Mean of HAPPY and LIFE_SAT, 0–10.",
    ),
    "sfi_health": DerivedOutcome(
        "sfi_health",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: mental & physical health",
        "Mean of PHYSICAL_HLTH and MENTAL_HEALTH, 0–10.",
    ),
    "sfi_meaning": DerivedOutcome(
        "sfi_meaning",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: meaning & purpose",
        "Mean of WORTHWHILE and LIFE_PURPOSE, 0–10.",
    ),
    "sfi_character": DerivedOutcome(
        "sfi_character",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: character & virtue",
        "Mean of PROMOTE_GOOD and GIVE_UP, 0–10.",
    ),
    "sfi_relationships": DerivedOutcome(
        "sfi_relationships",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: close social relationships",
        "Mean of CONTENT and SAT_RELATNSHP, 0–10.",
    ),
    "sfi_financial": DerivedOutcome(
        "sfi_financial",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: financial & material stability",
        "Mean of EXPENSES and WORRY_SAFETY, 0–10.",
    ),
    "phq2_score": DerivedOutcome(
        "phq2_score",
        "count",
        0,
        6,
        "lower_better",
        "PHQ-2 depression score",
        "Sum of the two PHQ-2 items rescored 0–3 each; 0–6.",
    ),
    "phq2_positive": DerivedOutcome(
        "phq2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "PHQ-2 screen positive",
        "PHQ-2 score ≥ 3; served as the weighted share screening positive.",
    ),
    "gad2_score": DerivedOutcome(
        "gad2_score",
        "count",
        0,
        6,
        "lower_better",
        "GAD-2 anxiety score",
        "Sum of the two GAD-2 items rescored 0–3 each; 0–6.",
    ),
    "gad2_positive": DerivedOutcome(
        "gad2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "GAD-2 screen positive",
        "GAD-2 score ≥ 3; served as the weighted share screening positive.",
    ),
}
