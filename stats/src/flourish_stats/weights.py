"""The wave → weight → eligibility table.

This module is the **only** place in the codebase where the mapping from a
wave combination to a weight column and a row-eligibility rule lives
(CLAUDE.md). The engine, the Phase 3 API and ``docs/METHODS.md`` all read
from here; ``weight_table_json()`` is what ``/v1/meta`` will serve.

Two facts of the release make this table load-bearing:

- **``w_r2`` is populated for all 207,919 rows**, including the 79,051
  respondents who were not retained at Wave 2, and differs from both
  ``w_c1`` and ``w_l2`` on every row. "Weight is non-null" is therefore
  *never* a valid eligibility test; eligibility is always the explicit
  predicate on the flags encoded in the spec.
- **``midyear_type = 2`` midyear answers were given on the same day as the
  Wave 2 interview**, so a MY → Y2 comparison is only meaningful for the
  standalone midyear interviews (``midyear_type = 1``). The ``my_y2`` rows
  enforce that here, so no caller can get it wrong.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
from dataclasses import asdict, dataclass

import polars as pl
import pyarrow as pa

Waves = tuple[str, ...]

US_COUNTRY_CODE = 22

#: respondents weight-column prefix per scope, in one place so the table
#: below cannot drift from the Phase 1 schema.
_SCOPE_PREFIX = {"global": "w_", "us_state": "w_state_", "us_state_adj": "w_state_adj_"}


@dataclass(frozen=True)
class WeightSpec:
    """One row of the wave → weight → eligibility table."""

    key: str
    scope: str  # "global" | "us_state" | "us_state_adj"
    waves: Waves  # chronological, e.g. ("Y1", "Y2")
    weight: str  # column of `respondents`
    kind: str  # "cross_section" | "paired_change" | "three_point_panel"
    requires_retained_y2: bool
    requires_has_midyear: bool
    requires_midyear_type_1: bool
    is_default: bool  # the spec `resolve()` returns for these waves
    rationale: str  # one sentence, quoted verbatim by docs/METHODS.md

    @property
    def flag_columns(self) -> tuple[str, ...]:
        """Respondent columns the eligibility predicate reads."""
        columns: list[str] = []
        if self.requires_retained_y2:
            columns.append("retained_y2")
        if self.requires_has_midyear or self.requires_midyear_type_1:
            columns.append("has_midyear")
        if self.requires_midyear_type_1:
            columns.append("midyear_type")
        if self.scope != "global":
            columns.extend(["country_code", "state"])
        return tuple(columns)


def _spec(
    key: str,
    scope: str,
    waves: Waves,
    base_weight: str,
    kind: str,
    rationale: str,
    *,
    retained: bool = False,
    midyear: bool = False,
    midyear_type_1: bool = False,
    default: bool = True,
) -> WeightSpec:
    return WeightSpec(
        key=key if scope == "global" else f"{scope}:{key}",
        scope=scope,
        waves=waves,
        weight=_SCOPE_PREFIX[scope] + base_weight,
        kind=kind,
        requires_retained_y2=retained,
        requires_has_midyear=midyear,
        requires_midyear_type_1=midyear_type_1,
        is_default=default,
        rationale=rationale,
    )


def _global_rows() -> tuple[WeightSpec, ...]:
    return (
        _spec(
            "y1",
            "global",
            ("Y1",),
            "c1",
            "cross_section",
            "Wave 1 cross-section: every respondent was interviewed at Wave 1, "
            "and w_c1 calibrates them to their country's adult population.",
        ),
        _spec(
            "y2",
            "global",
            ("Y2",),
            "c2",
            "cross_section",
            "Wave 2 cross-section: only retained respondents were interviewed, "
            "and w_c2 re-calibrates them to the population, absorbing attrition.",
            retained=True,
        ),
        _spec(
            "my",
            "global",
            ("MY",),
            "l1m",
            "cross_section",
            "Midyear cross-section: w_l1m adjusts the 63% with a midyear "
            "interview back to the Wave 1 population.",
            midyear=True,
        ),
        _spec(
            "y1_y2",
            "global",
            ("Y1", "Y2"),
            "l2",
            "paired_change",
            "Wave 1 → Wave 2 change for the same people: w_l2 is the "
            "attrition-adjusted longitudinal weight, the default for change.",
            retained=True,
        ),
        _spec(
            "y1_y2_rect",
            "global",
            ("Y1", "Y2"),
            "r2",
            "paired_change",
            'Alternative "rectangular" panel weight for complete-both-waves '
            "analyses. Quirk: the release populates w_r2 for all 207,919 rows, "
            "including the 79,051 not retained at Wave 2, so eligibility must "
            "come from the retained_y2 flag, never from the weight being "
            "non-null.",
            retained=True,
            default=False,
        ),
        _spec(
            "y1_my",
            "global",
            ("Y1", "MY"),
            "l1m",
            "paired_change",
            "Wave 1 → midyear change: w_l1m adjusts midyear respondents back "
            "to the Wave 1 population.",
            midyear=True,
        ),
        _spec(
            "y1_my_y2",
            "global",
            ("Y1", "MY", "Y2"),
            "l1m2",
            "three_point_panel",
            "Three-point panel: w_l1m2 covers the 116,038 respondents with "
            "all of Wave 1, the midyear survey and Wave 2.",
            retained=True,
            midyear=True,
        ),
        _spec(
            "my_y2",
            "global",
            ("MY", "Y2"),
            "l1m2",
            "paired_change",
            "Midyear → Wave 2 change is restricted to standalone midyear "
            "interviews (midyear_type = 1): for type 2 the midyear items were "
            "asked in the Wave 2 interview itself, so the two answers are the "
            "same day and their difference is not change over time.",
            retained=True,
            midyear=True,
            midyear_type_1=True,
        ),
    )


# The US-state scopes repeat the global rows on the state-calibrated weight
# columns. The plain scope has all eight rows; the _ADJ_ weight variants
# exist only for the post-Wave-1 weights, so us_state_adj has no y1 row.
_STATE_KEYS = ("y1", "y2", "my", "y1_y2", "y1_y2_rect", "y1_my", "y1_my_y2", "my_y2")
_ADJ_KEYS = tuple(k for k in _STATE_KEYS if k != "y1")
_STATE_RATIONALE = (
    " Scoped to US respondents with a state (157 US rows have none), using "
    "the state-population-calibrated weight."
)


def _build_table() -> tuple[WeightSpec, ...]:
    rows = list(_global_rows())
    by_key = {spec.key: spec for spec in rows}
    for scope, keys in (("us_state", _STATE_KEYS), ("us_state_adj", _ADJ_KEYS)):
        for key in keys:
            g = by_key[key]
            rows.append(
                _spec(
                    key,
                    scope,
                    g.waves,
                    g.weight.removeprefix("w_"),
                    g.kind,
                    g.rationale + _STATE_RATIONALE,
                    retained=g.requires_retained_y2,
                    midyear=g.requires_has_midyear,
                    midyear_type_1=g.requires_midyear_type_1,
                    default=g.is_default,
                )
            )
    return tuple(rows)


WEIGHT_TABLE: tuple[WeightSpec, ...] = _build_table()

_BY_KEY: dict[str, WeightSpec] = {spec.key: spec for spec in WEIGHT_TABLE}


def get(key: str) -> WeightSpec:
    """Look up a spec by key, e.g. ``"y1_y2_rect"`` or ``"us_state:my"``."""
    try:
        return _BY_KEY[key]
    except KeyError:
        raise KeyError(f"no weight spec {key!r}; known keys: {sorted(_BY_KEY)}") from None


def resolve(waves: Waves, scope: str = "global") -> WeightSpec:
    """The default spec for a chronological wave combination.

    ``resolve(("Y1", "Y2"))`` is ``y1_y2`` (the attrition-adjusted ``w_l2``);
    the alternative rectangular weight is only reachable explicitly via
    ``get("y1_y2_rect")``.
    """
    for spec in WEIGHT_TABLE:
        if spec.scope == scope and spec.waves == tuple(waves) and spec.is_default:
            return spec
    raise KeyError(f"no weight spec for waves={tuple(waves)!r} in scope {scope!r}")


def weight_table_json() -> str:
    """The full table as JSON, for the Phase 3 API to serve from /v1/meta."""
    rows = [asdict(spec) | {"waves": list(spec.waves)} for spec in WEIGHT_TABLE]
    return json.dumps(rows, indent=2, ensure_ascii=False) + "\n"


def pooled_population_weights(
    frame: pl.DataFrame | pa.Table, populations: dict[int, float]
) -> pl.DataFrame:
    """Rescale within-country weights by adult population for pooling.

    Phase 5 (proposal §3.3, §7): every GFS weight has mean 1 within its
    country, so pooling countries without rescaling counts Türkiye and the
    US equally. This will multiply each row's weight by its country's adult
    population share (``populations``: country_code → adult population) to
    produce the explicitly-labelled "all countries" estimates.
    """
    raise NotImplementedError("Not implemented: Phase 5")


def eligibility_expr(spec: WeightSpec) -> pl.Expr:
    """The polars predicate selecting exactly the rows ``spec`` applies to."""
    expr = pl.lit(True)
    if spec.requires_retained_y2:
        expr = expr & pl.col("retained_y2")
    if spec.requires_has_midyear or spec.requires_midyear_type_1:
        expr = expr & pl.col("has_midyear")
    if spec.requires_midyear_type_1:
        expr = expr & (pl.col("midyear_type") == 1)
    if spec.scope != "global":
        expr = expr & (pl.col("country_code") == US_COUNTRY_CODE) & pl.col("state").is_not_null()
    return expr


def validate_frame(frame: pl.DataFrame | pa.Table, spec: WeightSpec) -> None:
    """Raise unless ``frame`` is exactly an eligible frame for ``spec``.

    Checks that every row satisfies the eligibility predicate and that the
    weight column is non-null (and positive) on every row. The frame must
    carry the flag columns the predicate reads — estimating from a frame
    that cannot prove its own eligibility is the failure mode this guards.
    """
    df = pl.from_arrow(frame) if isinstance(frame, pa.Table) else frame
    if not isinstance(df, pl.DataFrame):  # pl.from_arrow can return a Series
        raise TypeError("frame must convert to a polars DataFrame")
    missing = [c for c in (*spec.flag_columns, spec.weight) if c not in df.columns]
    if missing:
        raise ValueError(f"frame is missing columns {missing} needed to validate {spec.key!r}")
    ineligible = df.filter(~eligibility_expr(spec)).height
    if ineligible:
        raise ValueError(
            f"{ineligible} rows are not eligible for {spec.key!r} "
            f"(eligibility is defined by flags, not by the weight column; "
            f"w_r2 in particular is populated even for non-retained rows)"
        )
    bad_weight = df.filter(pl.col(spec.weight).is_null() | (pl.col(spec.weight) <= 0)).height
    if bad_weight:
        raise ValueError(f"{bad_weight} eligible rows have a null or non-positive {spec.weight!r}")
