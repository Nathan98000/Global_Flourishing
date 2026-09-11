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

from flourish_api.data import DataStore
from flourish_api.queries import AggregateQuery, ChangeQuery, DomainFilter

VALUE_COLUMN = "value"


def wave_column(wave: str) -> str:
    return f"value_{wave.lower()}"


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


def assemble_aggregate_frame(store: DataStore, query: AggregateQuery) -> AssembledFrame:
    """Load, scope, filter and validate the frame for one aggregate query."""
    assert store.catalog is not None
    spec = resolve((query.wave,), query.scope)

    extra: list[str] = [c for c in query.by if c != "country_code"]
    extra.extend(item.column for item in query.filters)
    # DEFAULT_COLUMNS carries the global weights; state scopes need theirs.
    extra.append(spec.weight)
    if query.scope != "global":
        extra.append("state")
    frame = store.outcome_frame(
        query.outcome,
        query.wave,
        oriented=query.oriented,
        extra_columns=tuple(dict.fromkeys(extra)),
    )

    # The eligible rows for the weight spec ARE the design (ADR-0006).
    frame = frame.filter(eligibility_expr(spec))
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
    if query.scope != "global":
        extra.append("state")

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

    frame = frame.filter(eligibility_expr(spec))
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
