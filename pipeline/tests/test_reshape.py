"""Unit tests for reshape helpers on synthetic frames."""

import polars as pl
from flourish_pipeline.catalog_io import CatalogVariable
from flourish_pipeline.reshape import (
    build_responses_long,
    check_own_states,
    clean,
    long_columns,
    own_state,
    us_state_codes,
)


def _variable(
    name: str,
    scale_type: str = "scale_0_10",
    nonresponse: dict[int, str] | None = None,
    waves: tuple[str, ...] = ("Y1", "Y2"),
) -> CatalogVariable:
    return CatalogVariable(
        name=name,
        scale_type=scale_type,
        direction="none",
        min=0,
        max=10,
        waves_available=waves,
        is_country_specific=False,
        is_us_only=False,
        nonresponse=nonresponse
        if nonresponse is not None
        else {-98: "skipped", 98: "dk", 99: "refused"},
    )


def test_clean_nulls_only_this_variables_sentinels() -> None:
    age = _variable("AGE", "count", {-998: "skipped", 998: "dk", 999: "refused"})
    frame = pl.DataFrame(
        {"AGE_Y1": [18, 98, 99, 998, 999, -998, None]}, schema={"AGE_Y1": pl.Int16}
    )
    out = frame.select(clean("AGE_Y1", age, "age"))
    # 98 and 99 are REAL AGES for AGE; only -998/998/999 are sentinels.
    assert out["age"].to_list() == [18, 98, 99, None, None, None, None]


def test_long_columns_takes_only_suffixed_substantive() -> None:
    variables = {
        "HAPPY": _variable("HAPPY"),
        "GENDER": _variable("GENDER", "nominal", waves=()),
        "ANNUAL_WEIGHT_C1": _variable("ANNUAL_WEIGHT_C1", "weight", {}, waves=()),
        "DOI_ANNUAL": _variable("DOI_ANNUAL", "date", {}, waves=("Y1",)),
        "MONEY": _variable("MONEY", "scale_0_10", waves=("MY",)),
    }
    columns = [
        "ID",
        "GENDER",
        "HAPPY_Y1",
        "HAPPY_Y2",
        "MONEY_MY",
        "ANNUAL_WEIGHT_C1",
        "DOI_ANNUAL_Y1",
    ]
    plan = long_columns(columns, variables)
    assert plan["Y1"] == [("HAPPY_Y1", "HAPPY")]  # dates/weights/unsuffixed excluded
    assert plan["Y2"] == [("HAPPY_Y2", "HAPPY")]
    assert plan["MY"] == [("MONEY_MY", "MONEY")]


def test_build_responses_long_drops_blanks_and_keeps_nonresponse() -> None:
    variables = {"HAPPY": _variable("HAPPY"), "MONEY": _variable("MONEY", waves=("MY",))}
    wide = pl.LazyFrame(
        {
            "ID": [1, 2, 3],
            "HAPPY_Y1": [7, -98, None],  # answer / skipped / not asked
            "HAPPY_Y2": [None, 5, None],
            "MONEY_MY": [None, None, 10],
        },
        schema={
            "ID": pl.Int64,
            "HAPPY_Y1": pl.Int16,
            "HAPPY_Y2": pl.Int16,
            "MONEY_MY": pl.Int16,
        },
    )
    out = build_responses_long(
        wide, variables, ["ID", "HAPPY_Y1", "HAPPY_Y2", "MONEY_MY"]
    ).collect()
    assert out.rows() == [
        (1, "Y1", "HAPPY", 7, None),
        (2, "Y1", "HAPPY", None, "skipped"),
        (2, "Y2", "HAPPY", 5, None),
        (3, "MY", "MONEY", 10, None),
    ]
    assert out.schema["value"] == pl.Int16


def test_us_state_codes_come_from_the_codebooks_us_labels() -> None:
    labels = pl.DataFrame(
        {
            "variable": ["REGION1", "REGION1", "REGION1", "REGION1"],
            "country_code": [22, 22, 22, 3],
            "code": [2201, 2246, 2251, 301],
            "label": ["Alaska", "Vermont", "Other", "Alaska"],
        },
        schema={
            "variable": pl.String,
            "country_code": pl.Int16,
            "code": pl.Int16,
            "label": pl.String,
        },
    )
    # US codes only; "Other" names no state.
    assert us_state_codes(labels) == {2201: "AK", 2246: "VT"}


def test_own_state_unpools_small_states_and_stays_inside_the_group() -> None:
    """ADR-0028: a respondent's own state, wherever the release gives an
    analysis group (pooled or not); none where it gives none."""
    states = {2205: "CA", 2221: "ME", 2246: "VT", 2228: "ND"}
    frame = pl.DataFrame(
        {
            "region": [2205, 2246, 2221, 2251, 2228],
            "group": ["CA", "ME_NH_RI_VT", "ME_NH_RI_VT", None, "ND_SD_WY"],
        },
        schema={"region": pl.Int16, "group": pl.String},
    )
    out = frame.with_columns(own_state(pl.col("region"), pl.col("group"), states).alias("state"))
    assert out["state"].to_list() == ["CA", "VT", "ME", None, "ND"]
    checked = out.select(
        pl.col("state"),
        pl.col("group").alias("state_group"),
        pl.col("state").alias("state_y2"),
        pl.col("group").alias("state_group_y2"),
    )
    assert check_own_states(checked) == 0
    # A state outside its group, or none where there is a group, is caught.
    wrong = checked.with_columns(
        pl.Series("state_y2", ["CA", "CA", "ME", None, None], dtype=pl.String)
    )
    assert check_own_states(wrong) == 2
