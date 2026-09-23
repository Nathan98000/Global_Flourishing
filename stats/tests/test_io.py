"""DuckDB loaders against a tiny synthetic database (no GFS data).

The real built-data round trip lives in test_built.py; these tests build a
three-respondent in-memory database with the same table shapes so the
loaders and their guards are covered in CI, where duckdb is present (the
pipeline depends on it) but the data never is.
"""

import polars as pl
import pytest

duckdb = pytest.importorskip("duckdb")

from flourish_stats.io import (  # noqa: E402
    DEFAULT_COLUMNS,
    analysis_frame,
    derived_frame,
    wide_frame,
)


@pytest.fixture()
def con():
    connection = duckdb.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE respondents AS
        SELECT * FROM (VALUES
            (1, 9, 1, 101, TRUE,  TRUE,  1,   1.0, 1.1, 0.9, 1.0, 1.2, 0.8),
            (2, 9, 1, 102, FALSE, FALSE, NULL, 1.0, NULL, NULL, 1.1, NULL, NULL),
            (3, 3, 2, 201, TRUE,  TRUE,  2,   1.0, 0.9, 1.0, 0.9, 1.0, 1.0)
        ) AS t(id, country_code, strata, psu, retained_y2, has_midyear,
               midyear_type, w_c1, w_c2, w_l2, w_r2, w_l1m, w_l1m2)
        """
    )
    connection.execute(
        """
        CREATE TABLE responses_long AS
        SELECT * FROM (VALUES
            (1, 'Y1', 'HAPPY', 7, NULL),
            (2, 'Y1', 'HAPPY', NULL, 'refused'),
            (3, 'Y1', 'HAPPY', 4, NULL),
            (1, 'Y1', 'LONELY_TEST', 2, NULL)
        ) AS t(id, wave, variable, value, nonresponse)
        """
    )
    connection.execute(
        """
        CREATE VIEW responses_oriented AS
        SELECT id, wave, variable,
               CASE WHEN variable = 'LONELY_TEST' THEN 10 - value ELSE value END AS value,
               nonresponse
        FROM responses_long
        """
    )
    connection.execute(
        """
        CREATE TABLE derived AS
        SELECT * FROM (VALUES
            (1, 'Y1', 6.5), (2, 'Y1', NULL), (3, 'Y1', 4.25)
        ) AS t(id, wave, sfi)
        """
    )
    yield connection
    connection.close()


def test_analysis_frame_joins_respondent_columns(con) -> None:
    frame = analysis_frame(con, "HAPPY", "Y1")
    assert frame.height == 3
    assert set(frame.columns) == {"id", "value", "nonresponse", *DEFAULT_COLUMNS}
    by_id = {row["id"]: row for row in frame.to_dicts()}
    assert by_id[1]["value"] == 7 and by_id[1]["w_c1"] == 1.0
    assert by_id[2]["value"] is None and by_id[2]["nonresponse"] == "refused"


def test_analysis_frame_reads_the_oriented_view(con) -> None:
    plain = analysis_frame(con, "LONELY_TEST", "Y1", columns=("country_code",))
    oriented = analysis_frame(con, "LONELY_TEST", "Y1", oriented=True, columns=("country_code",))
    assert plain["value"].to_list() == [2]
    assert oriented["value"].to_list() == [8]


def test_derived_frame(con) -> None:
    frame = derived_frame(con, "sfi", "Y1", columns=("country_code", "w_c1"))
    assert frame.sort("id")["value"].to_list() == [6.5, None, 4.25]
    assert frame.columns == ["id", "value", "country_code", "w_c1"]


def test_estimating_from_a_loaded_frame(con) -> None:
    from flourish_stats import Design, SuppressionPolicy, weighted_mean

    frame = analysis_frame(con, "HAPPY", "Y1")
    row = weighted_mean(
        frame,
        "value",
        Design(weight="w_c1", strata="strata", psu="psu"),
        policy=SuppressionPolicy(threshold=0, flag_below=0),
    ).to_pylist()[0]
    assert row["estimate"] == pytest.approx(5.5)  # (7 + 4) / 2, equal weights
    assert row["n"] == 2


def test_invalid_identifiers_rejected(con) -> None:
    with pytest.raises(ValueError, match="invalid column name"):
        analysis_frame(con, "HAPPY", "Y1", columns=("w_c1; DROP TABLE respondents",))
    with pytest.raises(ValueError, match="invalid column name"):
        derived_frame(con, "sfi; DROP TABLE derived", "Y1")


def test_frames_come_back_as_polars(con) -> None:
    assert isinstance(analysis_frame(con, "HAPPY", "Y1"), pl.DataFrame)


def test_wide_frame_puts_every_item_and_score_on_one_row(con) -> None:
    frame = wide_frame(
        con, ["HAPPY", "LONELY_TEST"], "Y1", derived=["sfi"], columns=("country_code", "w_c1")
    )
    assert frame.columns == ["id", "country_code", "w_c1", "HAPPY", "LONELY_TEST", "sfi"]
    by_id = {row["id"]: row for row in frame.sort("id").to_dicts()}
    assert [by_id[i]["HAPPY"] for i in (1, 2, 3)] == [7, None, 4]
    assert [by_id[i]["LONELY_TEST"] for i in (1, 2, 3)] == [2, None, None]
    assert [by_id[i]["sfi"] for i in (1, 2, 3)] == [6.5, None, 4.25]
    # Country subset keeps only that country's respondents.
    subset = wide_frame(con, ["HAPPY"], "Y1", columns=("country_code",), country_codes=[9])
    assert subset["country_code"].to_list() == [9, 9]
    assert wide_frame(con, ["HAPPY"], "Y1", columns=(), country_codes=[]).height == 0
    # Items only, scores only.
    assert wide_frame(con, [], "Y1", derived=["sfi"], columns=()).columns == ["id", "sfi"]
    assert wide_frame(con, ["HAPPY"], "Y1", columns=()).columns == ["id", "HAPPY"]


def test_wide_frame_rejects_bad_names(con) -> None:
    with pytest.raises(ValueError, match="item name"):
        wide_frame(con, ["happy; drop table"], "Y1")
    with pytest.raises(ValueError, match="column name"):
        wide_frame(con, [], "Y1", derived=["SFI"])
    with pytest.raises(ValueError, match="at least one"):
        wide_frame(con, [], "Y1")
