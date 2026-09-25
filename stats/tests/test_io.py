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


# --- Alignment (ADR-0015) ---------------------------------------------------


class TestAlignedExpr:
    def test_descending_reflects_about_the_scale_and_keeps_nulls(self) -> None:
        from flourish_stats.io import aligned_expr

        frame = pl.DataFrame({"x": pl.Series([1, 2, 3, 4, None], dtype=pl.Int16)})
        aligned = frame.select(aligned_expr("x", polarity="descending", lo=1, hi=4))
        assert aligned["x"].to_list() == [4, 3, 2, 1, None]
        assert aligned["x"].dtype.is_integer()

    def test_ascending_is_the_identity(self) -> None:
        from flourish_stats.io import aligned_expr

        frame = pl.DataFrame({"x": pl.Series([0, 5, 10, None], dtype=pl.Int16)})
        aligned = frame.select(aligned_expr("x", polarity="ascending", lo=0, hi=10))
        assert aligned["x"].to_list() == [0, 5, 10, None]

    def test_needs_bounds_and_a_known_polarity(self) -> None:
        from flourish_stats.io import aligned_expr

        with pytest.raises(ValueError, match="min and max"):
            aligned_expr("x", polarity="descending", lo=None, hi=4)
        with pytest.raises(ValueError, match="polarity"):
            aligned_expr("x", polarity="upward", lo=1, hi=4)

    def test_aligned_correlation_flips_sign_for_a_descending_item(self) -> None:
        """Pearson and Spearman are invariant to a reflection up to sign:
        the aligned correlation is exactly the negative of the raw one."""
        from flourish_stats import NO_SUPPRESSION, Design, weighted_correlation
        from flourish_stats.io import aligned_expr

        frame = pl.DataFrame(
            {
                "strata": [1, 1, 1, 2, 2, 2, 3, 3],
                "psu": [11, 12, 12, 21, 22, 22, 31, 32],
                "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0],
                "score": [7.0, 6.0, 8.0, 3.0, 4.0, 9.0, 5.0, 2.0],
                "item": pl.Series([4, 3, 4, 1, 2, 4, 3, 1], dtype=pl.Int16),
            }
        )
        design = Design(weight="w", strata="strata", psu="psu")
        aligned = frame.with_columns(aligned_expr("item", polarity="descending", lo=1, hi=4))
        for method in ("pearson", "spearman"):
            raw = weighted_correlation(
                frame, "score", "item", design, method=method, policy=NO_SUPPRESSION
            )
            flipped = weighted_correlation(
                aligned, "score", "item", design, method=method, policy=NO_SUPPRESSION
            )
            r_raw = raw.to_pylist()[0]["estimate"]
            r_aligned = flipped.to_pylist()[0]["estimate"]
            assert r_raw is not None and r_raw > 0.5
            assert r_aligned == pytest.approx(-r_raw, rel=1e-12)

    def test_phq2_components_align_positively_with_their_score(self) -> None:
        """DEPRESSED and INTEREST are 1 = Nearly every day … 4 = Not at all
        and the score rescores each 4 − code: the raw items run against the
        score, the aligned items (5 − code) run with it — the same holds
        for GAD-2's FEEL_ANXIOUS and CONTROL_WORRY."""
        from flourish_stats import NO_SUPPRESSION, Design, weighted_correlation
        from flourish_stats.io import aligned_expr

        a = [1, 2, 3, 4, 4, 3, 2, 1, 4, 2, 3, 1]
        b = [2, 1, 4, 4, 3, 3, 1, 2, 4, 3, 4, 2]
        frame = pl.DataFrame(
            {
                "strata": [1] * 6 + [2] * 6,
                "psu": [11, 11, 12, 12, 13, 13, 21, 21, 22, 22, 23, 23],
                "w": [1.0, 1.5, 0.5, 2.0, 1.0, 1.0, 1.2, 0.8, 1.0, 1.0, 1.5, 0.5],
                "DEPRESSED": pl.Series(a, dtype=pl.Int16),
                "INTEREST": pl.Series(b, dtype=pl.Int16),
                "phq2_score": [(4 - x) + (4 - y) for x, y in zip(a, b, strict=True)],
            }
        )
        design = Design(weight="w", strata="strata", psu="psu")
        for item in ("DEPRESSED", "INTEREST"):
            raw = weighted_correlation(
                frame, "phq2_score", item, design, policy=NO_SUPPRESSION
            ).to_pylist()[0]
            assert raw["estimate"] < 0
            aligned = frame.with_columns(aligned_expr(item, polarity="descending", lo=1, hi=4))
            r = weighted_correlation(
                aligned, "phq2_score", item, design, policy=NO_SUPPRESSION
            ).to_pylist()[0]
            assert r["estimate"] > 0


class TestBinnedExpr:
    def test_one_point_bins_with_the_top_bin_closed(self) -> None:
        from flourish_stats.io import binned_expr

        frame = pl.DataFrame({"s": [0.0, 0.99, 1.0, 7.25, 9.0, 9.999, 10.0, None]})
        binned = frame.select(binned_expr("s", lo=0, hi=10))["s"]
        assert binned.to_list() == [0, 0, 1, 7, 9, 9, 9, None]
        assert binned.dtype == pl.Int32

    def test_bins_follow_the_score_registry(self) -> None:
        from flourish_stats.outcomes import DERIVED_OUTCOMES, score_bins

        bins = score_bins(DERIVED_OUTCOMES["sfi"])
        assert [level for level, _ in bins] == list(range(10))
        assert [label for _, label in bins] == [f"{k}–{k + 1}" for k in range(10)]
        assert score_bins(DERIVED_OUTCOMES["phq2_score"]) == []

    def test_validation(self) -> None:
        from flourish_stats.io import binned_expr

        with pytest.raises(ValueError):
            binned_expr("s", lo=0, hi=0)
