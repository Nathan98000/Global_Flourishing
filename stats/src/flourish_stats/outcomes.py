"""Which outcomes are servable, and the derived-score registry.

Shared data semantics for the two consumers of the engine — the API and
the pipeline's static-aggregate exporter — exactly as the weight table is
(ADR-0005/0008): one home, no drift. Plain dataclasses only; this module
adds no dependencies to the package.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

#: Catalog `scale_type` values an outcome may have to be aggregated.
SERVABLE_SCALE_TYPES = frozenset({"scale_0_10", "ordinal", "binary", "nominal", "count"})

#: Catalog `scale_type` values that are bookkeeping, not survey content —
#: excluded from the variables listing by the API and the static exporter.
NON_SUBSTANTIVE_SCALE_TYPES = frozenset({"design", "date", "id", "string", "weight"})

#: Numeric scales whose default statistic is the weighted mean; every
#: other servable scale defaults to per-level proportions.
MEAN_SCALE_TYPES = frozenset({"scale_0_10", "count"})

#: Scales the static exporter precomputes a full distribution for.
DISTRIBUTION_SCALE_TYPES = frozenset({"scale_0_10"})

#: Continuous derived scores (a mean of 0–10 items) are distributed over
#: one-point bins — [0,1) … [8,9), and [9,10] closed so a perfect 10 is
#: counted — served as ``level`` = the bin's lower edge and labelled
#: "0–1" … "9–10" (ADR-0015). One rule, two consumers: the API's
#: ``stat=distribution`` and the static exporter both bin with it, and
#: both serve the labels as the score's value labels. Nothing else bins.
SCORE_BIN_WIDTH = 1


def default_stat(scale_type: str) -> str:
    """The statistic a view shows when the user hasn't chosen one.

    One rule, three consumers: the exporter names its files with it, the
    API serves it as ``default_stat`` on every variable summary, and the
    front end computes static paths from that field — never from a copy
    of this rule.
    """
    return "mean" if scale_type in MEAN_SCALE_TYPES else "proportion"


#: Waves the derived outcomes exist at (derive.py builds Y1 + Y2; the MY
#: rows carry only the midyear priorities, which ship in Phase 5).
DERIVED_WAVES: tuple[str, ...] = ("Y1", "Y2")

# --- What each score is built from -----------------------------------------
# These facts live HERE (the registry is the one home of derived-score
# semantics, like the weight table in .weights); the pipeline's derive
# stage imports them to compute the columns, and the API/exporter serve
# them as each score's `components` and scoring rule.

#: The six SFI domains and their item pairs, in index order.
SFI_DOMAINS: dict[str, tuple[str, str]] = {
    "happiness": ("HAPPY", "LIFE_SAT"),
    "health": ("PHYSICAL_HLTH", "MENTAL_HEALTH"),
    "meaning": ("WORTHWHILE", "LIFE_PURPOSE"),
    "character": ("PROMOTE_GOOD", "GIVE_UP"),
    "relationships": ("CONTENT", "SAT_RELATNSHP"),
    "financial": ("EXPENSES", "WORRY_SAFETY"),
}
SFI_ITEMS: tuple[str, ...] = tuple(item for pair in SFI_DOMAINS.values() for item in pair)
#: The SFI is computed only when at least this many of the 12 items answered.
SFI_MIN_ITEMS = 10

PHQ2_ITEMS: tuple[str, str] = ("DEPRESSED", "INTEREST")
GAD2_ITEMS: tuple[str, str] = ("FEEL_ANXIOUS", "CONTROL_WORRY")
#: A screener is positive at a summed score of this or more (0–6 scale).
SCREEN_POSITIVE_AT = 3


@dataclass(frozen=True)
class DerivedOutcome:
    """A score computed by the pipeline, served like any catalog item."""

    column: str  # column of the `derived` table
    scale_type: str  # kind used by query validation
    min: int
    max: int
    direction: str
    display_name: str
    #: one line in plain words (F11); ``{0}``, ``{1}`` stand for the
    #: components' catalog names — ``derived_description`` fills them in
    description: str
    #: the catalog items the score is computed from, in scoring order
    components: tuple[str, ...]
    #: the scoring rule in words (numbers from the constants above)
    scoring: str


_DOMAIN_NAMES: dict[str, str] = {
    "happiness": "SFI: happiness & life satisfaction",
    "health": "SFI: mental & physical health",
    "meaning": "SFI: meaning & purpose",
    "character": "SFI: character & virtue",
    "relationships": "SFI: close social relationships",
    "financial": "SFI: financial & material stability",
}

_SCREENER_SCORING = (
    f"Each answer rescored 0–3 (4 − code), the two summed to 0–6; "
    f"positive at {SCREEN_POSITIVE_AT} or more."
)

#: The screeners' lines in plain words (owner decision, 22 Oct 2026):
#: the two questions by name, how they are scored, and what the chart shows.
_SCREENER_SCORE_LINE = (
    "Answers to “{0}” and “{1}”, scored 0–3 each and added up: 0–6. Higher means more symptoms."
)
_SCREENER_POSITIVE_LINE = (
    f"Screens positive when the answers to “{{0}}” and “{{1}}” add up to "
    f"{SCREEN_POSITIVE_AT} or more out of 6. The chart shows the share who do."
)


def _sfi_domain(domain: str, items: tuple[str, str]) -> DerivedOutcome:
    return DerivedOutcome(
        f"sfi_{domain}",
        "scale_0_10",
        0,
        10,
        "higher_better",
        _DOMAIN_NAMES[domain],
        "Mean of “{0}” and “{1}”, 0–10.",
        components=items,
        scoring="The mean of the two questions below; 0–10.",
    )


def derived_description(outcome: DerivedOutcome, display_name_of: Callable[[str], str]) -> str:
    """A derived score's one line for a lay reader (F11): its questions by
    their catalog names (``display_name_of``, the catalog's lookup), never
    a variable code — "Mean of “Doing worthwhile things” and
    “Understanding life's purpose”, 0–10." — and "Mean", never "Average".
    """
    return outcome.description.format(*(display_name_of(name) for name in outcome.components))


def score_bins(outcome: DerivedOutcome) -> list[tuple[int, str]]:
    """``(level, label)`` per bin of a continuous derived score: the bin's
    lower edge and its "lo–hi" label. Empty for a score that is not a
    0–10 scale (the counts and screeners have their own integer levels).
    """
    if outcome.scale_type != "scale_0_10":
        return []
    return [
        (lo, f"{lo}–{lo + SCORE_BIN_WIDTH}")
        for lo in range(outcome.min, outcome.max, SCORE_BIN_WIDTH)
    ]


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
        f"Mean of 12 questions, for people who answered at least {SFI_MIN_ITEMS}; 0–10.",
        components=SFI_ITEMS,
        scoring=(
            f"The mean of the 12 questions below, computed when at least "
            f"{SFI_MIN_ITEMS} are answered; 0–10."
        ),
    ),
    **{f"sfi_{domain}": _sfi_domain(domain, items) for domain, items in SFI_DOMAINS.items()},
    "phq2_score": DerivedOutcome(
        "phq2_score",
        "count",
        0,
        6,
        "lower_better",
        "Depression screening score (PHQ-2)",
        _SCREENER_SCORE_LINE,
        components=PHQ2_ITEMS,
        scoring="Each answer rescored 0–3 (4 − code), the two summed; 0–6.",
    ),
    "phq2_positive": DerivedOutcome(
        "phq2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "Depression screening positive (PHQ-2)",
        _SCREENER_POSITIVE_LINE,
        components=PHQ2_ITEMS,
        scoring=_SCREENER_SCORING,
    ),
    "gad2_score": DerivedOutcome(
        "gad2_score",
        "count",
        0,
        6,
        "lower_better",
        "Anxiety screening score (GAD-2)",
        _SCREENER_SCORE_LINE,
        components=GAD2_ITEMS,
        scoring="Each answer rescored 0–3 (4 − code), the two summed; 0–6.",
    ),
    "gad2_positive": DerivedOutcome(
        "gad2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "Anxiety screening positive (GAD-2)",
        _SCREENER_POSITIVE_LINE,
        components=GAD2_ITEMS,
        scoring=_SCREENER_SCORING,
    ),
}
