"""Weighted correlations (unadjusted associations, proposal §5.3).

Point estimates only in Phase 2 — no CIs (``ci_method = "none"``); the
Correlates view ships in Phase 6 together with adjusted associations.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

import polars as pl
import pyarrow as pa

from ._core import Frame, check_columns, finalize, group_keys, to_polars, with_dummy
from .design import Design
from .suppression import DEFAULT_POLICY, SuppressionPolicy

Method = Literal["pearson", "spearman"]


def weighted_correlation(
    frame: Frame,
    x: str,
    y: str,
    design: Design,
    *,
    method: Method = "pearson",
    by: Sequence[str] = (),
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Weighted correlation of two items on their complete cases.

    Pearson is the weighted covariance over the weighted variances — the
    common denominator cancels, so it equals the ratio built from R
    ``svyvar(~x + y)``. Spearman average-ranks the *unweighted* values
    (ties averaged) within each group and takes the weighted Pearson of the
    ranks; that is one of several defensible definitions of a weighted
    Spearman (documented in METHODS.md), chosen because it reduces to the
    classical coefficient under equal weights.

    Undefined correlations (zero weighted variance in either item) return a
    null estimate with their ``n`` intact.
    """
    if method not in ("pearson", "spearman"):
        raise ValueError(f"method must be 'pearson' or 'spearman', got {method!r}")
    df = to_polars(frame)
    check_columns(df, design, x, by)
    check_columns(df, design, y, by)
    df = with_dummy(df, by)
    groups = group_keys(by)
    w = pl.col(design.weight)

    valid = df.filter(pl.col(x).is_not_null() & pl.col(y).is_not_null())
    if method == "spearman":
        valid = valid.with_columns(
            pl.col(x).rank(method="average").over(groups).cast(pl.Float64).alias("_vx"),
            pl.col(y).rank(method="average").over(groups).cast(pl.Float64).alias("_vy"),
        )
    else:
        valid = valid.with_columns(
            pl.col(x).cast(pl.Float64).alias("_vx"), pl.col(y).cast(pl.Float64).alias("_vy")
        )

    means = valid.group_by(groups).agg(
        ((w * pl.col("_vx")).sum() / w.sum()).alias("_mx"),
        ((w * pl.col("_vy")).sum() / w.sum()).alias("_my"),
    )
    moments = (
        valid.join(means, on=groups, how="inner")
        .with_columns(
            (pl.col("_vx") - pl.col("_mx")).alias("_dx"),
            (pl.col("_vy") - pl.col("_my")).alias("_dy"),
        )
        .group_by(groups)
        .agg(
            (w * pl.col("_dx") * pl.col("_dy")).sum().alias("_sxy"),
            (w * pl.col("_dx").pow(2)).sum().alias("_sxx"),
            (w * pl.col("_dy").pow(2)).sum().alias("_syy"),
            pl.len().cast(pl.Int64).alias("n"),
            w.sum().alias("sum_w"),
        )
    )
    records = moments.with_columns(
        pl.when((pl.col("_sxx") > 0) & (pl.col("_syy") > 0))
        .then(pl.col("_sxy") / (pl.col("_sxx") * pl.col("_syy")).sqrt())
        .otherwise(None)
        .alias("estimate"),
        pl.lit(None, dtype=pl.Float64).alias("se"),
        pl.lit(None, dtype=pl.Int64).alias("n_psu"),
        pl.lit(None, dtype=pl.Int64).alias("n_strata"),
        pl.lit(None, dtype=pl.Int64).alias("df"),
    )
    return finalize(
        records,
        df.select(groups).unique(),
        stat=f"{method}_r",
        design=design,
        groups=groups,
        by=by,
        ci_level=0.95,
        ci_method="none",
        policy=policy,
    )


def adjusted_association(
    frame: Frame,
    outcome: str,
    predictor: str,
    design: Design,
    *,
    controls: Sequence[str] = (
        "age_band",
        "gender",
        "education_3",
        "employment",
        "marital_status",
        "country_code",
    ),
    by: Sequence[str] = (),
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Adjusted association via survey-weighted OLS/logistic regression.

    Phase 6 (proposal §5.3, §7): the coefficient of ``predictor`` on
    ``outcome`` under the fixed control set (age, gender, education,
    employment, marital status, country fixed effects), with
    design-based SEs, feeding the Correlates view's "adjusted" toggle
    and its model cards.
    """
    raise NotImplementedError("Not implemented: Phase 6")
