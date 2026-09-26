"""Frame assembly: from a validated query to an engine-ready design frame.

**Filters are domains, not subsets.** The engine treats the frame it
receives as the survey design: per-stratum PSU counts come from that
frame. Subsetting rows to a country is safe — GFS strata nest within
countries, so the country's design is intact (a property the stats test
suite proves). Subsetting to anything else (an age band, a gender) would
shrink the design and change every SE relative to R's domain semantics.
So non-country filters are applied by **nulling the outcome outside the
domain**: the rows stay in the frame (and the variance design), they just
stop contributing a score — exactly how the engine treats item
non-response. ``test_frames.py`` proves the two constructions disagree.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import polars as pl
from flourish_stats import Design, WeightSpec, eligibility_expr, resolve, validate_frame
from flourish_stats.correlations import DEFAULT_CONTROLS
from flourish_stats.io import aligned_expr
from flourish_stats.outcomes import MEAN_SCALE_TYPES

from flourish_api.data import DataStore, VariableInfo
from flourish_api.queries import (
    AggregateQuery,
    ChangeQuery,
    CorrelatesQuery,
    DomainFilter,
    PairQuery,
)

VALUE_COLUMN = "value"
#: The group column a state-scope response carries. The spec says which
#: respondents column holds the state its weight is calibrated to (the
#: Wave 1 state for the Wave 1 weight, the Wave 2 state after it —
#: ``flourish_stats.weights``); the frame is grouped by that column,
#: presented under this name.
STATE_COLUMN = "state"
#: Binary items enter associations as 0/1 indicators of this code: the
#: release codes every yes/no item 1 = Yes, 2 = No, and the derived
#: screeners code "positive" as 1 — so "1" is the event in both worlds.
BINARY_EVENT_CODE = 1


def wave_column(wave: str) -> str:
    return f"value_{wave.lower()}"


def align(frame: pl.DataFrame, column: str, variable: VariableInfo) -> pl.DataFrame:
    """Re-code ``column`` so higher means more of what the variable's
    display name names (ADR-0015): the load-time transform of
    :func:`flourish_stats.io.aligned_expr`, applied wherever a signed
    statistic — change, correlation, adjusted coefficient — is about to
    be taken. Means and shares never pass through here."""
    return frame.with_columns(
        aligned_expr(column, polarity=variable.polarity, lo=variable.min, hi=variable.max)
    )


@dataclass(frozen=True)
class AssembledFrame:
    """Everything an estimator call needs, plus the resolved weight spec."""

    frame: pl.DataFrame
    spec: WeightSpec
    design: Design
    value: str
    groups: tuple[str, ...]


def apply_domain_filters(
    frame: pl.DataFrame, value: str, filters: Sequence[DomainFilter]
) -> pl.DataFrame:
    """Null ``value`` outside the filtered domain; keep every row.

    Pure so the domain-vs-subset distinction is testable on a toy frame.
    """
    if not filters:
        return frame
    condition = pl.lit(True)
    for item in filters:
        condition = condition & pl.col(item.column).is_in(list(item.values))
    return frame.with_columns(pl.when(condition).then(pl.col(value)).otherwise(None).alias(value))


def state_columns(spec: WeightSpec) -> list[str]:
    """The respondent columns a state scope must load: the spec's own
    state column (nothing for the global scope)."""
    return [spec.state_column] if spec.state_column is not None else []


def present_state(frame: pl.DataFrame, spec: WeightSpec) -> pl.DataFrame:
    """Expose the spec's state column as ``state``, the name every
    state-scope group and response uses."""
    if spec.state_column is None or spec.state_column == STATE_COLUMN:
        return frame
    return frame.with_columns(pl.col(spec.state_column).alias(STATE_COLUMN))


def assemble_aggregate_frame(store: DataStore, query: AggregateQuery) -> AssembledFrame:
    """Load, scope, filter and validate the frame for one aggregate query."""
    assert store.catalog is not None
    spec = resolve((query.wave,), query.scope)

    extra: list[str] = [c for c in query.by if c != "country_code"]
    extra.extend(item.column for item in query.filters)
    # DEFAULT_COLUMNS carries the global weights; state scopes need theirs.
    extra.append(spec.weight)
    extra.extend(state_columns(spec))
    frame = store.outcome_frame(
        query.outcome,
        query.wave,
        oriented=query.oriented,
        extra_columns=tuple(dict.fromkeys(extra)),
    )

    # The eligible rows for the weight spec ARE the design (ADR-0006).
    frame = present_state(frame.filter(eligibility_expr(spec)), spec)
    if query.countries:
        # Safe subset: strata nest within countries.
        frame = frame.filter(pl.col("country_code").is_in(list(query.countries)))
    frame = apply_domain_filters(frame, VALUE_COLUMN, query.filters)

    if query.by_variable is not None:
        breakdown = store.outcome_frame(query.by_variable, query.wave, extra_columns=()).select(
            "id", pl.col(VALUE_COLUMN).alias(query.by_variable.name)
        )
        frame = frame.join(breakdown, on="id", how="left")

    validate_frame(frame, spec)
    return AssembledFrame(
        frame=frame,
        spec=spec,
        design=Design(weight=spec.weight, strata="strata", psu="psu"),
        value=VALUE_COLUMN,
        groups=query.group_columns,
    )


def assemble_change_frame(store: DataStore, query: ChangeQuery) -> AssembledFrame:
    """One row per respondent with a value column per requested wave.

    The eligible rows for the longitudinal spec are the design; incomplete
    pairs stay in it (the engine treats them as domain exclusions), and
    non-country filters null **every** wave column so a filtered-out
    respondent contributes no pair anywhere.
    """
    spec = query.spec
    extra: list[str] = [c for c in query.by if c != "country_code"]
    extra.extend(item.column for item in query.filters)
    extra.append(spec.weight)
    extra.extend(state_columns(spec))

    first, *rest = query.waves
    frame = store.outcome_frame(
        query.outcome, first, extra_columns=tuple(dict.fromkeys(extra))
    ).rename({VALUE_COLUMN: wave_column(first)})
    if "nonresponse" in frame.columns:
        frame = frame.drop("nonresponse")
    for wave in rest:
        piece = store.outcome_frame(query.outcome, wave, extra_columns=()).select(
            "id", pl.col(VALUE_COLUMN).alias(wave_column(wave))
        )
        frame = frame.join(piece, on="id", how="left")
    # A mean change is a signed number: taken on aligned values. A
    # categorical item's change is the change in share at each of its
    # own codes, which needs the codes as coded.
    if query.outcome.scale_type in MEAN_SCALE_TYPES:
        for wave in query.waves:
            frame = align(frame, wave_column(wave), query.outcome)

    frame = present_state(frame.filter(eligibility_expr(spec)), spec)
    if query.countries:
        frame = frame.filter(pl.col("country_code").is_in(list(query.countries)))
    for wave in query.waves:
        frame = apply_domain_filters(frame, wave_column(wave), query.filters)

    validate_frame(frame, spec)
    return AssembledFrame(
        frame=frame,
        spec=spec,
        design=Design(weight=spec.weight, strata="strata", psu="psu"),
        value=wave_column(query.waves[-1]),
        groups=query.by,
    )


def assemble_correlates_frame(
    store: DataStore, query: CorrelatesQuery, predictors: Sequence[VariableInfo]
) -> AssembledFrame:
    """The outcome and every predictor on one eligible frame.

    One wide query (never one frame per predictor); the eligible rows for
    the wave's weight spec are the design; a country filter subsets, every
    other filter nulls the **outcome** outside the domain — which removes
    the row from every complete-case set while it stays in the variance
    design. Binary items become indicators of :data:`BINARY_EVENT_CODE`.
    The adjusted models' control columns ride along when ``adjusted``.
    """
    spec = resolve((query.wave,), "global")
    extra: list[str] = [c for c in query.by if c != "country_code"]
    extra.extend(item.column for item in query.filters)
    extra.append(spec.weight)
    if query.adjusted:
        extra.extend(c for c in DEFAULT_CONTROLS if c != "country_code")
    variables = [query.outcome, *predictors]
    frame = store.wide_frame(
        variables,
        query.wave,
        extra_columns=tuple(dict.fromkeys(extra)),
        country_codes=query.countries or None,
    )
    frame = frame.filter(eligibility_expr(spec))
    frame = apply_domain_filters(frame, query.outcome.name, query.filters)
    # Every correlation and coefficient is signed: the outcome and each
    # ordered predictor are aligned to their labels first (ADR-0015). A
    # binary item is aligned by its indicator instead — the event code is
    # the named thing (1 = Yes), so the 0/1 column already runs upward.
    for variable in variables:
        if variable.scale_type != "binary":
            frame = align(frame, variable.name, variable)
    binaries = [v.name for v in variables if v.scale_type == "binary"]
    if binaries:
        frame = frame.with_columns(
            [
                pl.when(pl.col(name).is_null())
                .then(None)
                .otherwise((pl.col(name) == BINARY_EVENT_CODE).cast(pl.Int8))
                .alias(name)
                for name in binaries
            ]
        )
    validate_frame(frame, spec)
    return AssembledFrame(
        frame=frame,
        spec=spec,
        design=Design(weight=spec.weight, strata="strata", psu="psu"),
        value=query.outcome.name,
        groups=query.by,
    )


#: The pair frame's columns: Y as coded (its mean is what the chart
#: plots — means are never re-coded, ADR-0015), Y and X aligned to their
#: labels (what the correlation and X's order are taken on).
PAIR_Y = "_y"
PAIR_Y_ALIGNED = "_y_aligned"
PAIR_X = "_x"


def _indicator(name: str) -> pl.Expr:
    """A yes/no item as 0/1 on its event code (null stays null)."""
    return (
        pl.when(pl.col(name).is_null())
        .then(None)
        .otherwise((pl.col(name) == BINARY_EVENT_CODE).cast(pl.Int8))
    )


def assemble_pair_frame(store: DataStore, query: PairQuery) -> AssembledFrame:
    """Two items on the country's eligible frame, for /v1/correlations/pair.

    Y keeps its codes for the group means (a yes/no Y is its indicator of
    "yes", so its mean is the share answering it), and is aligned beside
    that for the correlation; X is aligned (a yes/no X as its indicator),
    so its groups run from least to most of what its label names and a
    positive correlation slopes up. Only people who answered both count:
    every column is null for anyone else, who stays in the design. A
    non-country filter nulls Y outside its domain first.
    """
    spec = resolve((query.wave,), "global")
    extra: list[str] = [item.column for item in query.filters]
    extra.append(spec.weight)
    frame = store.wide_frame(
        [query.y, query.x],
        query.wave,
        extra_columns=tuple(dict.fromkeys(extra)),
        country_codes=query.countries,
    )
    frame = frame.filter(eligibility_expr(spec))
    frame = apply_domain_filters(frame, query.y.name, query.filters)
    y, x = query.y, query.x

    def aligned(variable: VariableInfo) -> pl.Expr:
        if variable.scale_type == "binary":
            return _indicator(variable.name)
        return aligned_expr(
            variable.name, polarity=variable.polarity, lo=variable.min, hi=variable.max
        )

    coded = _indicator(y.name) if y.scale_type == "binary" else pl.col(y.name)
    frame = frame.with_columns(
        coded.cast(pl.Float64).alias(PAIR_Y),
        aligned(y).cast(pl.Float64).alias(PAIR_Y_ALIGNED),
        aligned(x).cast(pl.Float64).alias(PAIR_X),
    )
    both = pl.col(PAIR_Y).is_not_null() & pl.col(PAIR_X).is_not_null()
    frame = frame.with_columns(
        [
            pl.when(both).then(pl.col(column)).otherwise(None).alias(column)
            for column in (PAIR_Y, PAIR_Y_ALIGNED, PAIR_X)
        ]
    )
    validate_frame(frame, spec)
    return AssembledFrame(
        frame=frame,
        spec=spec,
        design=Design(weight=spec.weight, strata="strata", psu="psu"),
        value=PAIR_Y,
        groups=(),
    )
