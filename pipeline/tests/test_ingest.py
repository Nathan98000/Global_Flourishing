"""Unit tests for ingest helpers on synthetic frames."""

import polars as pl
import pytest
from flourish_pipeline.catalog_io import CatalogVariable
from flourish_pipeline.ingest import (
    IngestError,
    check_known_fractional,
    compare_shared_columns,
    typed_columns,
)


def _variable(name: str, scale_type: str) -> CatalogVariable:
    return CatalogVariable(
        name=name,
        scale_type=scale_type,
        direction="none",
        min=None,
        max=None,
        waves_available=(),
        is_country_specific=False,
        is_us_only=False,
        nonresponse={},
    )


def test_typed_columns_preserve_strings_and_parse_dates() -> None:
    variables = {
        "ID": _variable("ID", "id"),
        "FIPS": _variable("FIPS", "string"),
        "DOI_ANNUAL": _variable("DOI_ANNUAL", "date"),
        "HAPPY": _variable("HAPPY", "scale_0_10"),
        "ANNUAL_WEIGHT_C1": _variable("ANNUAL_WEIGHT_C1", "weight"),
    }
    frame = pl.DataFrame(
        {
            "ID": ["230000000001"],
            "FIPS_Y1": ["06037"],
            "DOI_ANNUAL_Y1": ["2/24/2023"],
            "HAPPY_Y1": ["7"],
            "ANNUAL_WEIGHT_C1": [".595041317404655"],
        }
    )
    out = frame.select(typed_columns(frame.columns, variables))
    assert out["ID"].dtype == pl.Int64 and out["ID"][0] == 230000000001
    assert out["FIPS_Y1"].dtype == pl.String and out["FIPS_Y1"][0] == "06037"  # leading zero kept
    assert str(out["DOI_ANNUAL_Y1"][0]) == "2023-02-24"
    assert out["HAPPY_Y1"].dtype == pl.Int16
    assert out["ANNUAL_WEIGHT_C1"][0] == pytest.approx(0.595041317404655)


def test_typed_columns_reject_unknown_columns() -> None:
    with pytest.raises(IngestError, match="not in the catalog"):
        typed_columns(["MYSTERY_Y1"], {})


def test_known_fractional_cells_stay_exactly_as_documented() -> None:
    ok = pl.DataFrame({"DRINKS_Y2": ["1", "4.5", None]})
    check_known_fractional(ok)  # exactly one fractional cell: fine

    drifted = pl.DataFrame({"DRINKS_Y2": ["1", "4.5", "2.5"]})
    with pytest.raises(IngestError, match="fractional"):
        check_known_fractional(drifted)

    gone = pl.DataFrame({"DRINKS_Y2": ["1", "2"]})
    with pytest.raises(IngestError, match="fractional"):
        check_known_fractional(gone)


def test_fractional_drinks_cell_is_floored() -> None:
    variables = {"DRINKS": _variable("DRINKS", "count")}
    frame = pl.DataFrame({"DRINKS_Y2": ["4.5", "3", None]})
    out = frame.select(typed_columns(frame.columns, variables))
    assert out["DRINKS_Y2"].to_list() == [4, 3, None]
    assert out["DRINKS_Y2"].dtype == pl.Int16


def test_compare_shared_columns_detects_any_difference() -> None:
    left = pl.DataFrame({"ID": ["2", "1"], "A": ["x", "y"], "ONLY_LEFT": ["1", "2"]})
    right = pl.DataFrame({"ID": ["1", "2"], "A": ["y", "x"], "ONLY_RIGHT": ["9", "9"]})
    count, differing = compare_shared_columns(left, right)
    assert count == 2 and differing == []  # equal after sorting by ID

    right_bad = right.with_columns(pl.Series("A", ["y", "CHANGED"]))
    _, differing = compare_shared_columns(left, right_bad)
    assert differing == ["A"]

    right_null = right.with_columns(pl.Series("A", ["y", None]))
    _, differing = compare_shared_columns(left, right_null)
    assert differing == ["A"]  # null vs value counts as a difference
