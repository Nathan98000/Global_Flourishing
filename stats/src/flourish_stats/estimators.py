"""Survey-weighted estimators with design-based standard errors.

Public functions take a :class:`pyarrow.Table` (or a polars ``DataFrame``)
whose rows are the eligible sample for one weight spec, and return a
``pyarrow.Table`` with one row per group and the common record described in
``docs/METHODS.md``. Internally everything is polars/numpy group-by
arithmetic — no Python loops over the 136,781 PSUs.

Taylor linearisation follows R's ``survey`` package (verified against
version 4.5 source and, in ``stats/verify/``, its numbers) for
``svydesign(ids=~psu, strata=~strata, weights=~w, nest=TRUE)`` with
``options(survey.lonely.psu="adjust", survey.adjust.domain.lonely=TRUE)``:

- The score of observation *i* for a mean is ``z_i = w_i (y_i − ȳ) / Σw``,
  summed into PSU totals ``z_hj``.
- A stratum with ``n_h`` design PSUs, ``m_h`` of them containing valid
  domain rows, contributes to the variance:

  - ``m_h > 1``:  ``n_h/(n_h−1) · (Σ_j z_hj² − T_h²/n_h)`` — PSUs with no
    domain rows enter as zero totals (R pads them), so the stratum mean
    divides by the *design* PSU count;
  - ``m_h = 1 < n_h`` (lonely in the domain): the single total is centred
    at the grand mean ``z̄`` instead of the stratum mean, keeping the
    ``n_h/(n_h−1)`` factor and the padded zeros:
    ``n_h/(n_h−1) · ((z_h1 − z̄)² + (n_h−1)·z̄²)``;
  - ``n_h = 1`` (lonely in the design): ``(z_h1 − z̄)²`` with no factor.

  ``z̄`` is R's "recentering": the sum of all scores over the sum of design
  PSU counts of the strata present in the domain. For the Hájek means and
  proportions estimated here the score sum is zero by construction, so the
  recentering only matters through floating point — it is computed
  faithfully anyway so the machinery stays correct for future statistics.

Domain (subpopulation) estimation keeps the full design: per-stratum design
PSU counts come from the whole frame handed in, and only the scores are
restricted to the domain — which is also how null values are handled
(complete-case per item, R ``na.rm=TRUE``).
"""

# polars' expression API (when/then/otherwise, over, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence
from statistics import NormalDist

import polars as pl
import pyarrow as pa

from .design import Design
from .suppression import DEFAULT_POLICY, SuppressionPolicy

Frame = pa.Table | pl.DataFrame

#: The record every estimator emits, after the group-key columns.
RESULT_COLUMNS: tuple[str, ...] = (
    "stat",
    "estimate",
    "se",
    "ci_lo",
    "ci_hi",
    "ci_level",
    "ci_method",
    "n",
    "sum_w",
    "n_psu",
    "n_strata",
    "df",
    "se_method",
    "weight",
    "suppressed",
    "flagged",
)

_ALL = "_all_"  # internal group key when `by` is empty


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


def _to_polars(frame: object) -> pl.DataFrame:
    # `object` rather than `Frame`: the public signatures promise `Frame`,
    # but a wrong runtime type should fail here with a clear message.
    if isinstance(frame, pl.DataFrame):
        return frame
    if isinstance(frame, pa.Table):
        df = pl.from_arrow(frame)
        assert isinstance(df, pl.DataFrame)
        return df
    raise TypeError(f"expected a pyarrow Table or polars DataFrame, got {type(frame).__name__}")


def _check_columns(df: pl.DataFrame, design: Design, value: str, by: Sequence[str]) -> None:
    missing = [c for c in (value, *design.columns, *by) if c not in df.columns]
    if missing:
        raise ValueError(f"frame is missing columns {missing}")
    if df[design.weight].null_count():
        raise ValueError(
            f"weight column {design.weight!r} has nulls; filter to the eligible rows "
            f"for the weight spec first (see flourish_stats.weights.validate_frame)"
        )
    for column in (design.strata, design.psu):
        if column is not None and df[column].null_count():
            raise ValueError(f"design column {column!r} has nulls")


def _groups(by: Sequence[str]) -> list[str]:
    return list(by) if by else [_ALL]


def _with_dummy(df: pl.DataFrame, by: Sequence[str]) -> pl.DataFrame:
    return df if by else df.with_columns(pl.lit(1, dtype=pl.Int8).alias(_ALL))


def _taylor_variance(
    valid: pl.DataFrame, groups: list[str], design: Design, score: str
) -> pl.DataFrame:
    """Per-group Taylor variance of a linearised score column.

    ``valid`` must contain one row per in-domain observation with the score
    in ``score`` and carry ``_n_psu_design`` (design PSU count of the row's
    stratum, computed on the full frame). Returns one row per group with
    ``_var``, ``_n_psu``, ``_n_strata``.
    """
    strata, psu = design.strata, design.psu
    assert strata is not None and psu is not None
    psu_totals = valid.group_by([*groups, strata, psu]).agg(
        pl.col(score).sum().alias("_zt"),
        pl.col("_n_psu_design").first().alias("_n_psu_design"),
    )
    per_stratum = psu_totals.group_by([*groups, strata]).agg(
        pl.col("_zt").pow(2).sum().alias("_s"),
        pl.col("_zt").sum().alias("_t"),
        pl.len().alias("_m"),
        pl.col("_n_psu_design").first().alias("_nh"),
    )
    # R's recentering: Σ scores / Σ design-PSU counts of the strata present.
    per_stratum = per_stratum.with_columns(
        (pl.col("_t").sum().over(groups) / pl.col("_nh").sum().over(groups)).alias("_zbar")
    )
    nh = pl.col("_nh").cast(pl.Float64)
    factor = nh / (nh - 1)
    contribution = (
        pl.when(pl.col("_nh") == 1)
        .then((pl.col("_t") - pl.col("_zbar")).pow(2))
        .when(pl.col("_m") == 1)
        .then(
            factor * ((pl.col("_t") - pl.col("_zbar")).pow(2) + (nh - 1) * pl.col("_zbar").pow(2))
        )
        .otherwise(factor * (pl.col("_s") - pl.col("_t").pow(2) / nh))
    )
    return per_stratum.group_by(groups).agg(
        contribution.sum().alias("_var"),
        pl.len().cast(pl.Int64).alias("_n_strata"),
        pl.col("_m").sum().cast(pl.Int64).alias("_n_psu"),
    )


def _mean_records(
    df: pl.DataFrame,
    value: str,
    design: Design,
    groups: list[str],
) -> pl.DataFrame:
    """Weighted mean, SE and design counts per group over ``df``.

    ``df`` is the full (eligible) frame; rows with a null value form no part
    of the estimate but their strata/PSUs stay in the variance design.
    Returns one row per group *with at least one valid observation*;
    ``estimate``, ``se``, ``n``, ``sum_w``, ``n_psu``, ``n_strata``, ``df``.
    """
    w = pl.col(design.weight)
    y = pl.col(value).cast(pl.Float64)
    valid = df.filter(pl.col(value).is_not_null())

    est = valid.group_by(groups).agg(
        ((w * y).sum() / w.sum()).alias("estimate"),
        pl.len().cast(pl.Int64).alias("n"),
        w.sum().alias("sum_w"),
    )

    if design.se_method == "taylor":
        strata, psu = design.strata, design.psu
        assert strata is not None and psu is not None
        design_counts = df.group_by(strata).agg(
            pl.col(psu).n_unique().cast(pl.Int64).alias("_n_psu_design")
        )
        group_stats = est.select([*groups, "estimate", "sum_w"]).rename(
            {"estimate": "_est_g", "sum_w": "_sumw_g"}
        )
        scored = (
            valid.join(group_stats, on=groups, how="inner")
            .join(design_counts, on=strata, how="inner")
            .with_columns(((w * (y - pl.col("_est_g"))) / pl.col("_sumw_g")).alias("_z"))
        )
        variance = _taylor_variance(scored, groups, design, "_z")
        out = est.join(variance, on=groups, how="left").with_columns(
            pl.col("_var").sqrt().alias("se"),
            (pl.col("_n_psu") - pl.col("_n_strata")).alias("df"),
        )
    else:
        kish = valid.group_by(groups).agg(
            (w.sum().pow(2) / w.pow(2).sum()).alias("_n_eff"),
            ((w * y.pow(2)).sum() / w.sum()).alias("_ey2"),
        )
        out = est.join(kish, on=groups, how="left").with_columns(
            pl.when(pl.col("_n_eff") > 1)
            .then(
                (
                    (pl.col("_ey2") - pl.col("estimate").pow(2))  # Σw(y−ȳ)²/Σw
                    * (pl.col("_n_eff") / (pl.col("_n_eff") - 1))
                    / pl.col("_n_eff")
                )
                .clip(lower_bound=0.0)
                .sqrt()
            )
            .otherwise(None)
            .alias("se"),
            pl.lit(None, dtype=pl.Int64).alias("_n_psu"),
            pl.lit(None, dtype=pl.Int64).alias("_n_strata"),
            pl.lit(None, dtype=pl.Int64).alias("df"),
        )
    return out.rename({"_n_psu": "n_psu", "_n_strata": "n_strata"}).select(
        [*groups, "estimate", "se", "n", "sum_w", "n_psu", "n_strata", "df"]
    )


def _finalize(
    records: pl.DataFrame,
    universe: pl.DataFrame,
    *,
    stat: str,
    design: Design,
    groups: list[str],
    by: Sequence[str],
    extra: Sequence[str] = (),
    ci_level: float,
    ci_method: str,
    policy: SuppressionPolicy,
) -> pa.Table:
    """Join estimates onto the group universe, add CIs, suppress, order."""
    keys = [*groups, *extra]
    out = universe.join(records, on=keys, how="left").with_columns(
        pl.col("n").fill_null(0),
        pl.col("sum_w").fill_null(0.0),
    )
    if ci_method == "normal":
        z = NormalDist().inv_cdf((1.0 + ci_level) / 2.0)
        out = out.with_columns(
            (pl.col("estimate") - z * pl.col("se")).alias("ci_lo"),
            (pl.col("estimate") + z * pl.col("se")).alias("ci_hi"),
        )
    else:
        out = out.with_columns(
            pl.lit(None, dtype=pl.Float64).alias("se"),
            pl.lit(None, dtype=pl.Float64).alias("ci_lo"),
            pl.lit(None, dtype=pl.Float64).alias("ci_hi"),
        )
    out = out.with_columns(
        (pl.col("n") < policy.threshold).alias("suppressed"),
        ((pl.col("n") >= policy.threshold) & (pl.col("n") < policy.flag_below)).alias("flagged"),
    )
    nulled = [
        pl.when(pl.col("suppressed")).then(None).otherwise(pl.col(c)).alias(c)
        for c in ("estimate", "se", "ci_lo", "ci_hi")
    ]
    out = (
        out.with_columns(nulled)
        .with_columns(
            pl.lit(stat).alias("stat"),
            pl.lit(ci_level).alias("ci_level"),
            pl.lit(ci_method).alias("ci_method"),
            pl.lit(design.se_method if ci_method == "normal" else "none").alias("se_method"),
            pl.lit(design.weight).alias("weight"),
        )
        .sort(keys)
        .select([*([] if not by else list(by)), *extra, *RESULT_COLUMNS])
    )
    return out.to_arrow()


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
    the lonely-PSU options in the module docstring.
    """
    df = _to_polars(frame)
    _check_columns(df, design, value, by)
    df = _with_dummy(df, by)
    groups = _groups(by)
    universe = df.select(groups).unique()
    records = _mean_records(df, value, design, groups)
    return _finalize(
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
    df = _to_polars(frame)
    _check_columns(df, design, value, by)
    df = _with_dummy(df, by)
    groups = _groups(by)

    if levels is None:
        levels = sorted(df[value].drop_nulls().unique().to_list())
    level_frame = pl.DataFrame({"level": levels}).with_columns(
        pl.col("level").cast(df[value].dtype)
    )
    if level_frame["level"].n_unique() != level_frame.height:
        raise ValueError("levels must be distinct")

    # Only the needed columns cross the levels join (rows × levels).
    slim = df.select(sorted({*groups, *design.columns, value}))
    expanded = slim.join(level_frame, how="cross").with_columns(
        pl.when(pl.col(value).is_null())
        .then(None)
        .otherwise((pl.col(value) == pl.col("level")).cast(pl.Float64))
        .alias("_ind")
    )
    records = _mean_records(expanded, "_ind", design, [*groups, "level"])
    # n: the mean machinery counts the group's valid responses (the
    # denominator); the record's n is the count at the level.
    level_n = (
        expanded.filter(pl.col("_ind") == 1.0)
        .group_by([*groups, "level"])
        .agg(pl.len().cast(pl.Int64).alias("_level_n"))
    )
    records = (
        records.join(level_n, on=[*groups, "level"], how="left")
        .with_columns(pl.col("_level_n").fill_null(0).alias("n"))
        .drop("_level_n")
    )
    universe = df.select(groups).unique().join(level_frame, how="cross")
    return _finalize(
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
    df = _to_polars(frame)
    _check_columns(df, design, value, by)
    df = _with_dummy(df, by)
    groups = _groups(by)

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
    return _finalize(
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
