"""Weighted proportions: indicator means through the same Taylor machinery."""

import polars as pl
import pytest
from flourish_stats import Design, SuppressionPolicy, weighted_proportion

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

# The same toy design as test_mean, with a two-level item; R survey 4.5:
# svymean(~factor) → P(x)=0.619047619047619, P(y)=0.380952380952381,
# SE 0.188194956201782 for both levels.
TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "f": [1, 2, 1, 2, 1, 1, 2, 1, 1],
    }
)


def rows_by_level(table):
    return {r["level"]: r for r in table.to_pylist()}


def test_matches_r_svymean_on_factor() -> None:
    rows = rows_by_level(weighted_proportion(TOY, "f", TAYLOR, policy=NO_SUPPRESSION))
    assert rows[1]["estimate"] == pytest.approx(0.619047619047619, rel=1e-12)
    assert rows[2]["estimate"] == pytest.approx(0.380952380952381, rel=1e-12)
    assert rows[1]["se"] == pytest.approx(0.188194956201782, rel=1e-9)
    assert rows[2]["se"] == pytest.approx(0.188194956201782, rel=1e-9)
    assert rows[1]["stat"] == "proportion"


def test_proportions_sum_to_one() -> None:
    rows = weighted_proportion(TOY, "f", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    assert sum(r["estimate"] for r in rows) == pytest.approx(1.0, abs=1e-12)


def test_n_is_the_level_count_and_sum_w_the_denominator() -> None:
    rows = rows_by_level(weighted_proportion(TOY, "f", TAYLOR, policy=NO_SUPPRESSION))
    assert rows[1]["n"] == 6
    assert rows[2]["n"] == 3
    # sum_w is the group's weighted denominator, identical across levels.
    assert rows[1]["sum_w"] == pytest.approx(10.5)
    assert rows[2]["sum_w"] == pytest.approx(10.5)


def test_zero_response_level_appears_with_n_zero() -> None:
    rows = rows_by_level(
        weighted_proportion(TOY, "f", TAYLOR, levels=[1, 2, 3], policy=NO_SUPPRESSION)
    )
    row = rows[3]
    assert row["n"] == 0
    # Nobody chose it, but the group has valid responses: the estimated
    # share is exactly zero with zero variance (as in R).
    assert row["estimate"] == 0.0
    assert row["se"] == pytest.approx(0.0, abs=1e-15)


def test_null_values_are_excluded_from_the_denominator() -> None:
    frame = TOY.with_columns(
        pl.when(pl.col("psu") == 21).then(None).otherwise(pl.col("f")).alias("f")
    )
    rows = rows_by_level(weighted_proportion(frame, "f", TAYLOR, policy=NO_SUPPRESSION))
    assert rows[1]["sum_w"] == pytest.approx(9.0)  # 10.5 − 1.5 of PSU 21
    assert sum(r["estimate"] for r in rows.values()) == pytest.approx(1.0, abs=1e-12)


def test_empty_group_has_null_estimates_for_every_level() -> None:
    frame = TOY.with_columns(
        pl.Series("g", ["a"] * 5 + ["b"] * 4),
        pl.when(pl.col("strata") == 3).then(None).otherwise(pl.col("f")).alias("f"),
    )
    out = weighted_proportion(frame, "f", TAYLOR, by=["g"], policy=NO_SUPPRESSION).to_pylist()
    b_rows = [r for r in out if r["g"] == "b"]
    assert len(b_rows) == 2  # levels observed anywhere in the frame
    assert all(r["n"] == 0 and r["estimate"] is None for r in b_rows)


def test_suppression_is_per_level() -> None:
    frame = pl.DataFrame({"w": [1.0] * 130, "f": [1] * 100 + [2] * 30})
    rows = rows_by_level(weighted_proportion(frame, "f", Design(weight="w")))
    assert rows[1]["suppressed"] is False and rows[1]["flagged"] is False
    assert rows[2]["suppressed"] is True and rows[2]["estimate"] is None
    assert rows[2]["n"] == 30  # n and sum_w survive suppression


def test_duplicate_levels_rejected() -> None:
    with pytest.raises(ValueError, match="distinct"):
        weighted_proportion(TOY, "f", TAYLOR, levels=[1, 1, 2])
