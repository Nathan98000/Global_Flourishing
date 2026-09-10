"""Unit tests for the pure derivation functions, on synthetic frames."""

from collections.abc import Mapping

import polars as pl
import pytest
from flourish_pipeline.derive import (
    GAD2_ITEMS,
    PHQ2_ITEMS,
    SFI_DOMAINS,
    SFI_ITEMS,
    age_band_expr,
    income_quintiles,
    midyear_priorities,
    screener_scores,
    sfi_scores,
)


def test_sfi_domains_cover_the_twelve_items() -> None:
    assert len(SFI_ITEMS) == 12
    assert len(set(SFI_ITEMS)) == 12
    assert set(SFI_DOMAINS) == {
        "happiness",
        "health",
        "meaning",
        "character",
        "relationships",
        "financial",
    }


def _items_frame(values: Mapping[str, int | None]) -> pl.LazyFrame:
    row = {"id": 1, **{item: values.get(item) for item in SFI_ITEMS}}
    return pl.LazyFrame([row], schema={"id": pl.Int64, **{item: pl.Int16 for item in SFI_ITEMS}})


def test_sfi_full_response_is_plain_mean() -> None:
    values = {item: i for i, item in enumerate(SFI_ITEMS)}  # 0..11
    out = sfi_scores(_items_frame(values)).collect()
    assert out["sfi"][0] == pytest.approx(sum(range(12)) / 12)
    assert out["sfi_n_items"][0] == 12
    assert out["sfi_happiness"][0] == pytest.approx((0 + 1) / 2)
    assert out["sfi_financial"][0] == pytest.approx((10 + 11) / 2)


def test_sfi_requires_ten_items() -> None:
    ten = {item: 5 for item in SFI_ITEMS[:10]}
    out = sfi_scores(_items_frame(ten)).collect()
    assert out["sfi"][0] == pytest.approx(5.0)  # mean of the available items
    assert out["sfi_n_items"][0] == 10

    nine = {item: 5 for item in SFI_ITEMS[:9]}
    out = sfi_scores(_items_frame(nine)).collect()
    assert out["sfi"][0] is None
    assert out["sfi_n_items"][0] == 9


def test_sfi_domain_requires_both_items() -> None:
    values = {item: 6 for item in SFI_ITEMS if item != "LIFE_SAT"}
    out = sfi_scores(_items_frame(values)).collect()
    assert out["sfi_happiness"][0] is None  # HAPPY present, LIFE_SAT missing
    assert out["sfi_health"][0] == pytest.approx(6.0)


def _screener_frame(a: int | None, b: int | None, items: tuple[str, str]) -> pl.LazyFrame:
    return pl.LazyFrame(
        [{"id": 1, items[0]: a, items[1]: b}],
        schema={"id": pl.Int64, items[0]: pl.Int16, items[1]: pl.Int16},
    )


def test_phq2_scoring_reverses_the_gfs_coding() -> None:
    # GFS codes 1 = Nearly every day … 4 = Not at all, so 1/1 is the worst
    # answer: item scores 3 + 3 = 6, screen-positive.
    worst = screener_scores(_screener_frame(1, 1, PHQ2_ITEMS), PHQ2_ITEMS, "phq2").collect()
    assert worst["phq2_score"][0] == 6
    assert bool(worst["phq2_positive"][0]) is True

    best = screener_scores(_screener_frame(4, 4, PHQ2_ITEMS), PHQ2_ITEMS, "phq2").collect()
    assert best["phq2_score"][0] == 0
    assert bool(best["phq2_positive"][0]) is False

    threshold = screener_scores(_screener_frame(3, 2, PHQ2_ITEMS), PHQ2_ITEMS, "phq2").collect()
    assert threshold["phq2_score"][0] == 3  # (4-3) + (4-2)
    assert bool(threshold["phq2_positive"][0]) is True


def test_screener_requires_both_items() -> None:
    out = screener_scores(_screener_frame(1, None, GAD2_ITEMS), GAD2_ITEMS, "gad2").collect()
    assert out["gad2_score"][0] is None
    assert out["gad2_positive"][0] is None


@pytest.mark.parametrize(
    ("age", "band"),
    [
        (18, "18-24"),
        (24, "18-24"),
        (25, "25-29"),
        (39, "30-39"),
        (49, "40-49"),
        (79, "70-79"),
        (80, "80+"),
        (98, "80+"),
        (99, "80+"),  # the 99+ top-code lands in 80+
        (None, None),
    ],
)
def test_age_bands(age: int | None, band: str | None) -> None:
    frame = pl.DataFrame({"age": [age]}, schema={"age": pl.Int16})
    assert frame.select(age_band_expr(pl.col("age")).alias("band"))["band"][0] == band


def _midyear_frame(money: int | None, relation: int | None, meaning: int | None) -> pl.LazyFrame:
    return pl.LazyFrame(
        [{"id": 1, "MONEY": money, "GOOD_RELATION": relation, "MEANINGFUL": meaning}],
        schema={
            "id": pl.Int64,
            "MONEY": pl.Int16,
            "GOOD_RELATION": pl.Int16,
            "MEANINGFUL": pl.Int16,
        },
    )


@pytest.mark.parametrize(
    ("money", "relation", "meaning", "top", "gap"),
    [
        (9, 5, 5, "money", 4),
        (3, 8, 5, "relationships", -5),
        (3, 5, 8, "meaning", -2),
        (7, 7, 3, "tie", 0),
        (7, 7, 7, "tie", 0),
        (None, 5, 5, None, None),
    ],
)
def test_midyear_priorities(
    money: int | None,
    relation: int | None,
    meaning: int | None,
    top: str | None,
    gap: int | None,
) -> None:
    out = midyear_priorities(_midyear_frame(money, relation, meaning)).collect()
    assert out["priority_top"][0] == top
    assert out["money_minus_relationships"][0] == gap


def test_income_quintiles_weighted_midpoints() -> None:
    # One country, five equally weighted bands: midpoints 0.1/0.3/0.5/0.7/0.9
    # → quintiles 1..5. A second country with one dominant band shows the
    # midpoint rule: its 90% band spans quintiles but sits at midpoint 0.45.
    respondents = pl.DataFrame(
        {
            "id": list(range(1, 8)),
            "country_code": [1, 1, 1, 1, 1, 2, 2],
            "w_c1": [1.0, 1.0, 1.0, 1.0, 1.0, 9.0, 1.0],
            "income_code": [101, 102, 103, 104, 105, 201, 202],
        },
        schema={
            "id": pl.Int64,
            "country_code": pl.Int16,
            "w_c1": pl.Float64,
            "income_code": pl.Int16,
        },
    )
    out = income_quintiles(respondents).sort("id")
    assert out["income_band"].to_list() == [1, 2, 3, 4, 5, 1, 2]
    assert out["income_quintile"].to_list() == [1, 2, 3, 4, 5, 3, 5]


def test_income_quintiles_no_income_code_sorts_to_bottom() -> None:
    respondents = pl.DataFrame(
        {
            "id": [1, 2, 3],
            "country_code": [1, 1, 1],
            "w_c1": [1.0, 1.0, 1.0],
            "income_code": [9900, 101, None],  # 9900 = no household income
        },
        schema={
            "id": pl.Int64,
            "country_code": pl.Int16,
            "w_c1": pl.Float64,
            "income_code": pl.Int16,
        },
    )
    out = income_quintiles(respondents).sort("id")
    assert out["income_band"].to_list() == [0, 1, None]
    quintiles = out["income_quintile"].to_list()
    assert quintiles[2] is None
    assert quintiles[0] is not None and quintiles[1] is not None
    assert quintiles[0] <= quintiles[1]  # band 0 never above band 1
