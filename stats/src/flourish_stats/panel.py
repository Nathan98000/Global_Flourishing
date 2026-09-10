"""Panel estimators: paired change, three-point panels, transition matrices.

Change is estimated on the same people at two waves — never by differencing
two cross-sections — so every function here takes a frame of respondents
eligible for a *longitudinal* weight spec (``flourish_stats.weights``) with
one column per wave. A pair is valid when both waves are non-null; rows
with an incomplete pair stay in the variance design (domain estimation,
exactly as null values do in the cross-sectional estimators).
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from collections.abc import Sequence

import polars as pl
import pyarrow as pa

from ._core import (
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
from .weights import eligibility_expr, resolve, validate_frame

_CHANGE = "_change_"


def _with_change(df: pl.DataFrame, earlier: str, later: str) -> pl.DataFrame:
    """later − earlier where the pair is complete, null otherwise."""
    pair_ok = pl.col(earlier).is_not_null() & pl.col(later).is_not_null()
    change = (pl.col(later).cast(pl.Float64) - pl.col(earlier).cast(pl.Float64)).alias(_CHANGE)
    return df.with_columns(pl.when(pair_ok).then(change).otherwise(None).alias(_CHANGE))


def paired_change(
    frame: Frame,
    earlier: str,
    later: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Mean within-person change ``later − earlier`` with a design-based SE.

    A mean of a derived variable, so the Taylor/Kish machinery is exactly
    :func:`~flourish_stats.estimators.weighted_mean`'s; ``n`` counts
    complete pairs. Equals R ``svymean(~I(later - earlier), design,
    na.rm=TRUE)``.
    """
    df = to_polars(frame)
    check_columns(df, design, earlier, by)
    check_columns(df, design, later, by)
    df = with_dummy(_with_change(df, earlier, later), by)
    groups = group_keys(by)
    records = mean_records(df, _CHANGE, design, groups)
    return finalize(
        records,
        df.select(groups).unique(),
        stat="change",
        design=design,
        groups=groups,
        by=by,
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def paired_change_distribution(
    frame: Frame,
    earlier: str,
    later: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    levels: Sequence[int] | None = None,
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """The weighted histogram of individual change, with per-bin CIs.

    One row per change value per group via the proportion machinery.
    ``levels`` defaults to the full contiguous integer range of observed
    change; pass ``range(-max, max + 1)`` from the catalog when the frame
    might not realise the extremes.
    """
    df = to_polars(frame)
    check_columns(df, design, earlier, by)
    check_columns(df, design, later, by)
    for column in (earlier, later):
        if not df[column].dtype.is_integer():
            raise ValueError(
                f"cannot infer change bins for non-integer column {column!r}; pass explicit levels"
            )
    df = with_dummy(_with_change(df, earlier, later), by)
    df = df.with_columns(pl.col(_CHANGE).cast(pl.Int32))
    groups = group_keys(by)
    if levels is None:
        observed = df[_CHANGE].drop_nulls()
        if observed.is_empty():
            raise ValueError("no complete pairs to bin")
        levels = range(int(observed.min()), int(observed.max()) + 1)  # type: ignore[arg-type]
    records, level_frame = proportion_records(df, _CHANGE, design, groups, list(levels))
    universe = df.select(groups).unique().join(level_frame, how="cross")
    return finalize(
        records,
        universe,
        stat="change_distribution",
        design=design,
        groups=groups,
        by=by,
        extra=["level"],
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def three_point_panel(
    frame: Frame,
    y1: str,
    my: str,
    y2: str,
    design: Design,
    *,
    scope: str = "global",
    by: Sequence[str] = (),
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """The three legs of the Y1 → MY → Y2 panel under the panel weight.

    One row per leg (``y1_my``, ``my_y2``, ``y1_y2``) per group, all
    estimated on the same three-point-panel frame and weight (``w_l1m2``)
    so the legs are comparable. The MY → Y2 leg is restricted to standalone
    midyear interviews (``midyear_type = 1``) **by the weight table, not by
    the caller**: combined-mode answers were given on the same day as Wave
    2 (see ``flourish_stats.weights``), and the restriction is applied here
    as domain estimation, keeping the full panel design for the variance.
    """
    spec = resolve(("Y1", "MY", "Y2"), scope)
    if design.weight != spec.weight:
        raise ValueError(
            f"three-point panel in scope {scope!r} must use weight {spec.weight!r} "
            f"(the {spec.key!r} row of the weight table), got {design.weight!r}"
        )
    df = to_polars(frame)
    for column in (y1, my, y2):
        check_columns(df, design, column, by)
    validate_frame(df, spec)
    my_y2_domain = eligibility_expr(resolve(("MY", "Y2"), scope))

    legs = {
        "y1_my": _with_change(df, y1, my),
        "my_y2": _with_change(df, my, y2).with_columns(
            pl.when(my_y2_domain).then(pl.col(_CHANGE)).otherwise(None).alias(_CHANGE)
        ),
        "y1_y2": _with_change(df, y1, y2),
    }
    parts: list[pl.DataFrame] = []
    universes: list[pl.DataFrame] = []
    groups = group_keys(by)
    for leg, changes in legs.items():
        leg_frame = with_dummy(changes, by)
        records = mean_records(leg_frame, _CHANGE, design, groups)
        parts.append(records.with_columns(pl.lit(leg).alias("leg")))
        universes.append(leg_frame.select(groups).unique().with_columns(pl.lit(leg).alias("leg")))
    return finalize(
        pl.concat(parts),
        pl.concat(universes),
        stat="change",
        design=design,
        groups=groups,
        by=by,
        extra=["leg"],
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )


def transition_matrix(
    frame: Frame,
    earlier: str,
    later: str,
    design: Design,
    *,
    by: Sequence[str] = (),
    levels: Sequence[int] | None = None,
    ci_level: float = 0.95,
    policy: SuppressionPolicy = DEFAULT_POLICY,
) -> pa.Table:
    """Weighted transitions between the levels of an ordinal/nominal item.

    Two stacked measures per ``(from_level, to_level)`` cell and group:

    - ``transition_joint``: P(earlier = i, later = j) over complete pairs —
      R ``svymean(~interaction(factor(earlier), factor(later)))``; cells
      sum to 1 within a group.
    - ``transition_conditional``: P(later = j | earlier = i), estimated as
      the domain mean of the ``later = j`` indicator within ``earlier = i``
      — R ``svymean(~factor(later), subset(design, earlier == i))``; each
      ``from_level`` row sums to 1.

    ``n`` is the unweighted pair count of the cell for both measures and
    suppression applies per cell. ``levels`` (default: observed values of
    either wave) spans both axes — transitions are for one item at two
    waves.
    """
    df = to_polars(frame)
    check_columns(df, design, earlier, by)
    check_columns(df, design, later, by)
    pair_ok = pl.col(earlier).is_not_null() & pl.col(later).is_not_null()
    df = with_dummy(
        df.with_columns(
            pl.when(pair_ok).then(pl.col(earlier)).otherwise(None).alias("_from"),
            pl.when(pair_ok).then(pl.col(later)).otherwise(None).alias("_to"),
        ),
        by,
    )
    groups = group_keys(by)
    if levels is None:
        observed = pl.concat([df["_from"].drop_nulls(), df["_to"].drop_nulls()])
        levels = sorted(observed.unique().to_list())
    if len(set(levels)) != len(levels):
        raise ValueError("levels must be distinct")
    k = len(levels)
    if k == 0:
        raise ValueError("no complete pairs to tabulate")
    index = {level: i for i, level in enumerate(levels)}

    # Joint: one interaction code per (from, to) cell, then the proportion
    # machinery over all k² codes; decode back to the two level columns.
    coded = df.with_columns(
        (
            pl.col("_from").replace_strict(index, return_dtype=pl.Int32) * k
            + pl.col("_to").replace_strict(index, return_dtype=pl.Int32)
        ).alias("_cell")
    )
    joint, _ = proportion_records(coded, "_cell", design, groups, list(range(k * k)))
    decode = pl.DataFrame(
        {
            "level": pl.Series(list(range(k * k)), dtype=pl.Int32),
            "from_level": [levels[c // k] for c in range(k * k)],
            "to_level": [levels[c % k] for c in range(k * k)],
        }
    )
    joint = joint.join(decode, on="level", how="inner").drop("level")
    joint = joint.with_columns(pl.lit("transition_joint").alias("measure"))

    # Conditional: the from-level is a by-group (domain), the to-level the
    # proportion level; rows with an incomplete pair belong to no domain
    # but stay in the design.
    conditional, _ = proportion_records(df, "_to", design, [*groups, "_from"], list(levels))
    conditional = (
        conditional.filter(pl.col("_from").is_not_null())
        .rename({"_from": "from_level", "level": "to_level"})
        .with_columns(pl.lit("transition_conditional").alias("measure"))
    )

    grid = decode.drop("level").with_columns(
        pl.col("from_level").cast(df[earlier].dtype), pl.col("to_level").cast(df[later].dtype)
    )
    universe = (
        df.select(groups)
        .unique()
        .join(grid, how="cross")
        .join(
            pl.DataFrame({"measure": ["transition_joint", "transition_conditional"]}), how="cross"
        )
    )
    records = pl.concat(
        [
            part.select(
                [*groups, "from_level", "to_level", "measure"]
                + [
                    c
                    for c in part.columns
                    if c not in (*groups, "from_level", "to_level", "measure")
                ]
            ).with_columns(
                pl.col("from_level").cast(df[earlier].dtype),
                pl.col("to_level").cast(df[later].dtype),
            )
            for part in (joint, conditional)
        ]
    )
    return finalize(
        records,
        universe,
        stat="transition",
        design=design,
        groups=groups,
        by=by,
        extra=["from_level", "to_level", "measure"],
        ci_level=ci_level,
        ci_method="normal",
        policy=policy,
    )
