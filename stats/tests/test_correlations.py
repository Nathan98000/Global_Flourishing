"""Weighted correlations and the Phase 5/6 stubs."""

import math

import polars as pl
import pytest
from flourish_stats import (
    Design,
    SuppressionPolicy,
    adjusted_association,
    pooled_population_weights,
    weighted_correlation,
)

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

# Same toy design as test_mean.py plus a second item; R survey 4.5:
# svyvar(~y + x2) → cov/sqrt(vy·vx2) = 0.925982832432145.
TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "y": [3, 5, 4, 10, 8, 1, 2, 6, 4],
        "x2": [2, 4, 5, 9, 9, 2, 1, 5, 5],
    }
)


def one_row(table):
    rows = table.to_pylist()
    assert len(rows) == 1
    return rows[0]


def test_pearson_matches_r_svyvar_ratio() -> None:
    row = one_row(weighted_correlation(TOY, "y", "x2", TAYLOR, policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(0.925982832432145, rel=1e-12)
    assert row["stat"] == "pearson_r"
    assert row["n"] == 9
    assert row["sum_w"] == pytest.approx(10.5)
    assert row["se"] is None and row["ci_lo"] is None
    assert row["ci_method"] == "none" and row["se_method"] == "none"


def test_equal_weights_reduce_to_classical_pearson() -> None:
    xs = [1, 3, 2, 5, 4, 7, 6]
    ys = [2, 4, 4, 5, 6, 9, 7]
    frame = pl.DataFrame({"w": [1.0] * 7, "x": xs, "y": ys})
    mx, my = sum(xs) / 7, sum(ys) / 7
    sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys, strict=True))
    r = sxy / math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
    row = one_row(weighted_correlation(frame, "x", "y", Design(weight="w"), policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(r, rel=1e-12)


def test_spearman_is_pearson_on_average_ranks() -> None:
    # Ties get average ranks: x = [1, 2, 2, 4] → ranks [1, 2.5, 2.5, 4].
    frame = pl.DataFrame({"w": [1.0] * 4, "x": [1, 2, 2, 4], "y": [10, 30, 20, 40]})
    ranks_x = [1.0, 2.5, 2.5, 4.0]
    ranks_y = [1.0, 3.0, 2.0, 4.0]
    mx, my = 2.5, 2.5
    r = sum((a - mx) * (b - my) for a, b in zip(ranks_x, ranks_y, strict=True)) / math.sqrt(
        sum((a - mx) ** 2 for a in ranks_x) * sum((b - my) ** 2 for b in ranks_y)
    )
    row = one_row(
        weighted_correlation(
            frame, "x", "y", Design(weight="w"), method="spearman", policy=NO_SUPPRESSION
        )
    )
    assert row["estimate"] == pytest.approx(r, rel=1e-12)
    assert row["stat"] == "spearman_r"


def test_spearman_ranks_within_each_group() -> None:
    # Group b's y values are shifted by 100: within-group ranks are what
    # matter, so both groups report a perfect positive rank correlation.
    frame = pl.DataFrame(
        {
            "w": [1.0] * 6,
            "g": ["a", "a", "a", "b", "b", "b"],
            "x": [1, 2, 3, 1, 2, 3],
            "y": [1, 4, 9, 101, 104, 109],
        }
    )
    rows = weighted_correlation(
        frame, "x", "y", Design(weight="w"), method="spearman", by=["g"], policy=NO_SUPPRESSION
    ).to_pylist()
    assert all(r["estimate"] == pytest.approx(1.0) for r in rows)


def test_complete_cases_only() -> None:
    frame = TOY.with_columns(
        pl.when(pl.col("psu") == 21).then(None).otherwise(pl.col("x2")).alias("x2")
    )
    row = one_row(weighted_correlation(frame, "y", "x2", TAYLOR, policy=NO_SUPPRESSION))
    assert row["n"] == 7


def test_zero_variance_gives_null_estimate() -> None:
    frame = pl.DataFrame({"w": [1.0] * 4, "x": [3, 3, 3, 3], "y": [1, 2, 3, 4]})
    row = one_row(weighted_correlation(frame, "x", "y", Design(weight="w"), policy=NO_SUPPRESSION))
    assert row["estimate"] is None
    assert row["n"] == 4


def test_suppression_and_method_validation() -> None:
    row = one_row(weighted_correlation(TOY, "y", "x2", TAYLOR))  # default policy, n=9
    assert row["suppressed"] is True and row["estimate"] is None
    with pytest.raises(ValueError, match="method"):
        weighted_correlation(TOY, "y", "x2", TAYLOR, method="kendall")  # type: ignore[arg-type]


def test_phase_stubs_raise_loudly() -> None:
    with pytest.raises(NotImplementedError, match="Not implemented: Phase 5"):
        pooled_population_weights(TOY, {22: 258e6})
    with pytest.raises(NotImplementedError, match="Not implemented: Phase 6"):
        adjusted_association(TOY, "y", "x2", TAYLOR)
