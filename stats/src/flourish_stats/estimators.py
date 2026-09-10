"""Survey-weighted cross-sectional estimators with design-based SEs.

Public functions take a :class:`pyarrow.Table` (or a polars ``DataFrame``)
whose rows are the eligible sample for one weight spec, and return a
``pyarrow.Table`` with one row per group and the common record described in
``docs/METHODS.md`` (``RESULT_COLUMNS``). Rows with a null value are
excluded from estimation (complete-case per item) but their strata and
PSUs stay in the variance design — see ``flourish_stats._core`` for the
Taylor-linearisation machinery and the exact R ``survey`` semantics it
mirrors.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence

import polars as pl
import pyarrow as pa

from ._core import (
    RESULT_COLUMNS,
    Frame,
    check_columns,
    finalize,
    group_keys,
    mean_records,
    proportion_records,
    to_polars,
    with_dummy,
)
from .design import Design
from .suppression import DEFAULT_POLICY, SuppressionPolicy

__all__ = [
    "RESULT_COLUMNS",
    "Frame",
    "kish_n_eff",
    "weighted_distribution",
    "weighted_mean",
    "weighted_proportion",
    "weighted_quantile",
]


def kish_n_eff(weights: Sequence[float]) -> float:
    """Kish effective sample size ``(Σw)² / Σw²``.

    At most ``n``, with equality exactly when all weights are equal; the
    basis of the fallback SE when no design columns are available.
    """
    if not weights:
        raise ValueError("weights must be non-empty")
    if any(w <= 0 for w in weights):
        raise ValueError("weights must be positive")
    total = float(sum(weights))
    return total * total / float(sum(w * w for w in weights))


def weighted_mean(
    frame: Frame,
    value: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Survey-weighted mean of ``value`` per ``by`` group.

    Equals R ``svymean(~value, design, na.rm=TRUE)`` / ``svyby(..., svymean)``
    on ``svydesign(ids=~psu, strata=~strata, weights=~w, nest=TRUE)`` under
    ``options(survey.lonely.psu="adjust", survey.adjust.domain.lonely=TRUE)``.
    """
    df = to_polars(frame)
    check_columns(df, design, value, by)
    df = with_dummy(df, by)
    groups = group_keys(by)
    universe = df.select(groups).unique()
    records = mean_records(df, value, design, groups)
    return finalize(
        records,
        universe,
        stat="mean",
        design=design,
        groups=groups,
        by=by,
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def weighted_proportion(
    frame: Frame,
    value: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    levels: Sequence[int] | None = None,
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Weighted share of each level of ``value`` per group, one row per level.

    Each level is estimated as the mean of its indicator, so the Taylor and
    domain machinery is exactly the mean's (R ``svymean(~factor(value))``).
    ``n`` on a proportion row is the unweighted count *at that level* —
    that is the cell the suppression policy protects — while ``sum_w`` is
    the group's weighted denominator. Levels with no valid responses appear
    with ``n = 0`` (estimate 0 when the group has other valid responses).
    """
    df = to_polars(frame)
    check_columns(df, design, value, by)
    df = with_dummy(df, by)
    groups = group_keys(by)
    records, level_frame = proportion_records(df, value, design, groups, levels)
    universe = df.select(groups).unique().join(level_frame, how="cross")
    return finalize(
        records,
        universe,
        stat="proportion",
        design=design,
        groups=groups,
        by=by,
        extra=["level"],
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def weighted_distribution(
    frame: Frame,
    value: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    levels: Sequence[int] | None = None,
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """The full weighted histogram of an integer-coded item, with per-bin CIs.

    This is how distributions ship with uncertainty: one row per bin (level)
    per group, estimated exactly like :func:`weighted_proportion` but with
    ``levels`` defaulting to the item's full contiguous range across the
    frame, so empty bins appear with ``n = 0`` rather than vanishing. Pass
    the catalog's ``[min, max]`` as explicit ``levels`` when the frame might
    not realise the extremes.
    """
    df = to_polars(frame)
    check_columns(df, design, value, by)
    if levels is None:
        if not df[value].dtype.is_integer():
            raise ValueError(
                f"cannot infer histogram bins for non-integer column {value!r}; "
                f"pass explicit levels"
            )
        observed = df[value].drop_nulls()
        if observed.is_empty():
            raise ValueError(f"column {value!r} has no valid values to bin")
        low, high = int(observed.min()), int(observed.max())  # type: ignore[arg-type]
        levels = range(low, high + 1)
    df = with_dummy(df, by)
    groups = group_keys(by)
    records, level_frame = proportion_records(df, value, design, groups, list(levels))
    universe = df.select(groups).unique().join(level_frame, how="cross")
    return finalize(
        records,
        universe,
        stat="distribution",
        design=design,
        groups=groups,
        by=by,
        extra=["level"],
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def weighted_quantile(
    frame: Frame,
    value: str,
    design: Design,
    *,
    p: Sequence[float] = (0.5,),
    by: Sequence[str] = (),
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Weighted quantiles: the smallest value with weighted CDF ≥ p.

    Matches R ``svyquantile(..., qrule="math")`` (survey ≥ 4.1). Point
    estimate only: ``se`` and ``ci_*`` are null and ``ci_method`` is
    ``"none"`` — Woodruff CIs are a recorded backlog item, not implemented.
    """
    if not p or not all(0.0 < q < 1.0 for q in p):
        raise ValueError(f"p must be a non-empty sequence within (0, 1), got {p!r}")
    df = to_polars(frame)
    check_columns(df, design, value, by)
    df = with_dummy(df, by)
    groups = group_keys(by)

    w = pl.col(design.weight)
    valid = df.filter(pl.col(value).is_not_null()).sort([*groups, value])
    valid = valid.with_columns((w.cum_sum().over(groups) / w.sum().over(groups)).alias("_cdf"))
    sizes = valid.group_by(groups).agg(pl.len().cast(pl.Int64).alias("n"), w.sum().alias("sum_w"))
    parts: list[pl.DataFrame] = []
    for q in p:  # p is a handful of values; the group-bys stay vectorised
        at_q = (
            valid.filter(pl.col("_cdf") >= q)
            .group_by(groups)
            .agg(pl.col(value).min().cast(pl.Float64).alias("estimate"))
            .with_columns(pl.lit(float(q)).alias("p"))
        )
        parts.append(at_q.join(sizes, on=groups, how="inner"))
    records = pl.concat(parts).with_columns(
        pl.lit(None, dtype=pl.Float64).alias("se"),
        pl.lit(None, dtype=pl.Int64).alias("n_psu"),
        pl.lit(None, dtype=pl.Int64).alias("n_strata"),
        pl.lit(None, dtype=pl.Int64).alias("df"),
    )
    universe = (
        df.select(groups).unique().join(pl.DataFrame({"p": [float(q) for q in p]}), how="cross")
    )
    return finalize(
        records,
        universe,
        stat="quantile",
        design=design,
        groups=groups,
        by=by,
        extra=["p"],
        ci_level=0.95,
        ci_method="none",
        policy=policy,
    )
