"""Tests against the built Phase 1 data (marked ``built``, skipped without it).

These pin the weight-availability facts the weight table encodes to the
actual release, including the ``w_r2`` quirk, and exercise the DuckDB
loaders end to end.
"""

from pathlib import Path

import polars as pl
import pytest
from flourish_stats import Design, eligibility_expr, get, validate_frame, weighted_mean
from flourish_stats.weights import WEIGHT_TABLE

pytestmark = pytest.mark.built


@pytest.fixture(scope="module")
def respondents(data_dir: Path) -> pl.DataFrame:
    return pl.read_parquet(data_dir / "parquet" / "respondents.parquet")


def test_weight_columns_exist_in_the_parquet_schema(respondents: pl.DataFrame) -> None:
    present = set(respondents.columns)
    assert {spec.weight for spec in WEIGHT_TABLE} <= present
    for spec in WEIGHT_TABLE:
        assert set(spec.flag_columns) <= present, spec.key


def test_weight_availability_counts(respondents: pl.DataFrame) -> None:
    """The §1 ground-truth counts, incl. the w_r2 quirk."""
    non_null = {
        w: respondents[w].drop_nulls().len()
        for w in ("w_c1", "w_c2", "w_l2", "w_r2", "w_l1m", "w_l1m2")
    }
    assert non_null == {
        "w_c1": 207_919,
        "w_c2": 128_868,
        "w_l2": 128_868,
        "w_r2": 207_919,  # populated for ALL rows — not a retention indicator
        "w_l1m": 131_487,
        "w_l1m2": 116_038,
    }
    assert respondents.filter(pl.col("w_state_c1").is_not_null()).height == 38_155


def test_w_r2_differs_from_c1_and_l2_everywhere(respondents: pl.DataFrame) -> None:
    """w_r2 is a distinct weight, non-null even where w_l2 is null: row
    eligibility must be the retained_y2 flag, never the weight."""
    assert respondents.filter(pl.col("w_r2") == pl.col("w_c1")).height == 0
    retained = respondents.filter(pl.col("retained_y2"))
    assert retained.filter(pl.col("w_r2") == pl.col("w_l2")).height == 0
    not_retained = respondents.filter(~pl.col("retained_y2"))
    assert not_retained.height == 79_051
    assert not_retained.filter(pl.col("w_r2").is_null()).height == 0
    assert not_retained.filter(pl.col("w_l2").is_not_null()).height == 0


def test_eligibility_matches_weight_availability(respondents: pl.DataFrame) -> None:
    """Every global spec's eligible rows carry its weight, and (except for
    the w_r2 quirk) the weight exists only there."""
    strict_specs = {"y1", "y2", "y1_y2", "my", "y1_my", "y1_my_y2"}
    for spec in WEIGHT_TABLE:
        if spec.scope != "global":
            continue
        eligible = respondents.filter(eligibility_expr(spec))
        assert eligible.filter(pl.col(spec.weight).is_null()).height == 0, spec.key
        validate_frame(eligible.select("id", spec.weight, *spec.flag_columns), spec)
        if spec.key in strict_specs:
            with_weight = respondents.filter(pl.col(spec.weight).is_not_null()).height
            assert eligible.height == with_weight, spec.key


def test_my_y2_eligibility_is_the_standalone_midyear_subset(
    respondents: pl.DataFrame,
) -> None:
    eligible = respondents.filter(eligibility_expr(get("my_y2")))
    assert eligible.height == 38_982  # midyear_type = 1 among the 116,038
    assert eligible["midyear_type"].unique().to_list() == [1]


def test_design_structure(respondents: pl.DataFrame) -> None:
    """Strata nest in countries and PSUs nest in strata — the facts that
    make per-country estimation equal domain estimation."""
    assert respondents["strata"].n_unique() == 411
    assert respondents["psu"].n_unique() == 136_781
    strata_countries = respondents.group_by("strata").agg(
        pl.col("country_code").n_unique().alias("k")
    )
    assert strata_countries.filter(pl.col("k") > 1).height == 0
    psu_strata = respondents.group_by("psu").agg(pl.col("strata").n_unique().alias("k"))
    assert psu_strata.filter(pl.col("k") > 1).height == 0
    lonely = (
        respondents.group_by("strata")
        .agg(pl.col("psu").n_unique().alias("n_psu"))
        .filter(pl.col("n_psu") == 1)
    )
    assert lonely.height == 38


def test_analysis_frame_and_a_real_estimate(data_dir: Path) -> None:
    duckdb = pytest.importorskip("duckdb")
    from flourish_stats.io import analysis_frame

    con = duckdb.connect(str(data_dir / "flourish.duckdb"), read_only=True)
    try:
        frame = analysis_frame(con, "HAPPY", "Y1")
    finally:
        con.close()
    assert frame.height == 207_919  # HAPPY was asked of everyone at Wave 1
    assert {"id", "value", "nonresponse", "w_c1", "strata", "psu"} <= set(frame.columns)
    validate_frame(frame, get("y1"))
    design = Design(weight="w_c1", strata="strata", psu="psu")
    rows = weighted_mean(frame, "value", design, by=["country_code"]).to_pylist()
    assert len(rows) == 23
    assert all(not r["suppressed"] for r in rows)
    assert all(r["se"] is not None and 0 < r["se"] < 0.2 for r in rows)
    assert all(r["se_method"] == "taylor" for r in rows)


def test_oriented_view_flips_lower_better(data_dir: Path) -> None:
    duckdb = pytest.importorskip("duckdb")
    from flourish_stats.io import analysis_frame

    con = duckdb.connect(str(data_dir / "flourish.duckdb"), read_only=True)
    try:
        plain = analysis_frame(con, "TRUST_PEOPLE", "Y1", columns=("country_code",))
        oriented = analysis_frame(
            con, "TRUST_PEOPLE", "Y1", oriented=True, columns=("country_code",)
        )
    finally:
        con.close()
    joined = plain.join(oriented, on="id", suffix="_o").drop_nulls("value")
    # TRUST_PEOPLE is lower_better on 1–5: the view maps v → 1 + 5 − v.
    assert joined.height > 0
    assert joined.filter(pl.col("value") + pl.col("value_o") != 6).height == 0


def test_invalid_identifiers_rejected(data_dir: Path) -> None:
    duckdb = pytest.importorskip("duckdb")
    from flourish_stats.io import analysis_frame

    con = duckdb.connect(str(data_dir / "flourish.duckdb"), read_only=True)
    try:
        with pytest.raises(ValueError, match="invalid column name"):
            analysis_frame(con, "HAPPY", "Y1", columns=("w_c1; DROP TABLE respondents",))
    finally:
        con.close()
