"""All countries as the plain average of the countries (ADR-0020)."""

import math
from statistics import NormalDist

import polars as pl
import pytest
from flourish_stats import average_countries

Z = NormalDist().inv_cdf(0.975)


def records(**columns: list[object]) -> pl.DataFrame:
    return pl.DataFrame(
        columns,
        schema_overrides={"estimate": pl.Float64, "se": pl.Float64, "sum_w": pl.Float64},
    )


def test_the_average_is_the_plain_mean_of_the_countries() -> None:
    frame = records(
        country_code=[3, 1, 2],
        estimate=[0.30, -0.02, 0.11],
        se=[None, None, None],
        n=[120, 3_000, 45],
        sum_w=[120.0, 3_000.0, 45.0],
    )
    (row,) = average_countries(frame).to_dicts()
    # Every country counts the same, whatever its size: no weighting by n.
    assert row["estimate"] == pytest.approx((0.30 - 0.02 + 0.11) / 3, abs=1e-15)
    assert row["n"] == 3_165 and row["sum_w"] == 3_165.0
    assert row["n_countries"] == 3 and row["n_largest"] == 3_000
    assert row["countries"] == [1, 2, 3]
    # A correlation claims no interval, so neither does its average.
    assert row["se"] is None and row["ci_lo"] is None and row["ci_hi"] is None


def test_a_country_with_no_estimate_drops_out() -> None:
    frame = records(
        country_code=[1, 2, 3],
        estimate=[0.2, None, 0.4],
        se=[None, None, None],
        n=[100, 0, 50],
        sum_w=[100.0, 0.0, 50.0],
    )
    (row,) = average_countries(frame).to_dicts()
    assert row["estimate"] == pytest.approx(0.3, abs=1e-15)
    assert row["n_countries"] == 2 and row["n"] == 150 and row["countries"] == [1, 3]


def test_independent_countries_give_the_mean_its_standard_error() -> None:
    frame = records(
        column=[0, 0, 1, 1],
        country_code=[1, 2, 1, 2],
        estimate=[0.6, 0.2, 0.5, 0.1],
        se=[0.03, 0.04, 0.05, 0.12],
        n=[40, 60, 30, 10],
        sum_w=[40.0, 60.0, 30.0, 10.0],
    )
    rows = average_countries(frame, ["column"]).to_dicts()
    assert [row["column"] for row in rows] == [0, 1]
    first = rows[0]
    se = math.sqrt(0.03**2 + 0.04**2) / 2
    assert first["estimate"] == pytest.approx(0.4, abs=1e-15)
    assert first["se"] == pytest.approx(se, abs=1e-15)
    assert first["ci_lo"] == pytest.approx(0.4 - Z * se, abs=1e-15)
    assert first["ci_hi"] == pytest.approx(0.4 + Z * se, abs=1e-15)
    # One country with no standard error: no interval is claimed.
    missing = frame.with_columns(
        pl.when(pl.col("country_code") == 2).then(None).otherwise(pl.col("se")).alias("se")
    )
    assert all(row["se"] is None for row in average_countries(missing, ["column"]).to_dicts())


def test_no_country_no_average() -> None:
    frame = records(
        country_code=[1, 2],
        estimate=[None, None],
        se=[None, None],
        n=[0, 0],
        sum_w=[0.0, 0.0],
    )
    assert average_countries(frame).is_empty()
    assert average_countries(
        frame.with_columns(pl.lit("A").alias("predictor")), ["predictor"]
    ).is_empty()
