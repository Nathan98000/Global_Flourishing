"""weighted_distribution: histograms with per-bin CIs, and kish_n_eff guards."""

import polars as pl
import pytest
from flourish_stats import Design, SuppressionPolicy, kish_n_eff, weighted_distribution

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        # A gap at 4: the default bins must still include it.
        "y": [3, 5, 3, 6, 5, 3, 5, 6, 3],
    }
)


def test_bins_cover_the_contiguous_observed_range() -> None:
    rows = weighted_distribution(TOY, "y", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    assert [r["level"] for r in rows] == [3, 4, 5, 6]
    by_level = {r["level"]: r for r in rows}
    assert by_level[4]["n"] == 0 and by_level[4]["estimate"] == 0.0  # empty bin kept
    assert sum(r["estimate"] for r in rows) == pytest.approx(1.0, abs=1e-12)
    assert all(r["stat"] == "distribution" for r in rows)
    assert all(r["se"] is not None and r["ci_lo"] is not None for r in rows)
    assert by_level[3]["sum_w"] == pytest.approx(10.5)


def test_explicit_levels_override_the_range() -> None:
    rows = weighted_distribution(
        TOY, "y", TAYLOR, levels=range(0, 11), policy=NO_SUPPRESSION
    ).to_pylist()
    assert [r["level"] for r in rows] == list(range(11))
    assert {r["level"] for r in rows if r["n"] > 0} == {3, 5, 6}


def test_non_integer_values_need_explicit_levels() -> None:
    frame = TOY.with_columns(pl.col("y").cast(pl.Float64))
    with pytest.raises(ValueError, match="non-integer"):
        weighted_distribution(frame, "y", TAYLOR)
    # …and are fine once bins are given.
    rows = weighted_distribution(
        frame, "y", TAYLOR, levels=range(0, 11), policy=NO_SUPPRESSION
    ).to_pylist()
    assert sum(r["estimate"] for r in rows) == pytest.approx(1.0, abs=1e-12)


def test_all_null_values_rejected() -> None:
    frame = TOY.with_columns(pl.lit(None, dtype=pl.Int16).alias("y"))
    with pytest.raises(ValueError, match="no valid values"):
        weighted_distribution(frame, "y", TAYLOR)


def test_kish_n_eff_guards() -> None:
    with pytest.raises(ValueError, match="non-empty"):
        kish_n_eff([])
    with pytest.raises(ValueError, match="positive"):
        kish_n_eff([1.0, -1.0])
    assert kish_n_eff([2.0, 2.0]) == pytest.approx(2.0)
