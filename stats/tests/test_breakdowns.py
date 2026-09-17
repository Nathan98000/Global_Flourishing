"""The breakdown registry: levels, catalog sources, display labels."""

import polars as pl
import pytest
from flourish_stats.breakdowns import (
    BREAKDOWN_LEVELS,
    CATALOG_SOURCES,
    breakdown_labels,
)
from flourish_stats.outcomes import default_stat


def catalog_frames() -> tuple[pl.DataFrame, pl.DataFrame]:
    variables = pl.DataFrame(
        {
            "name": ["GENDER", "EDUCATION_3"],
            "display_name": ["Gender", "Education (three levels)"],
        }
    )
    value_labels = pl.DataFrame(
        [
            {"variable": "GENDER", "code": 1, "label": "Male", "is_nonresponse": False},
            {"variable": "GENDER", "code": 2, "label": "Female", "is_nonresponse": False},
            {"variable": "GENDER", "code": 3, "label": "Other", "is_nonresponse": False},
            {
                "variable": "GENDER",
                "code": 4,
                "label": "Prefer not to answer",
                "is_nonresponse": False,
            },
            {"variable": "GENDER", "code": 99, "label": "(Refused)", "is_nonresponse": True},
            {"variable": "EDUCATION_3", "code": 1, "label": "Elementary", "is_nonresponse": False},
            {"variable": "EDUCATION_3", "code": 2, "label": "Secondary", "is_nonresponse": False},
            {"variable": "EDUCATION_3", "code": 3, "label": "Tertiary", "is_nonresponse": False},
        ]
    )
    return variables, value_labels


def test_every_labelled_column_is_a_breakdown() -> None:
    assert set(CATALOG_SOURCES) == set(BREAKDOWN_LEVELS) - {"country_code"}


def test_catalog_sourced_labels() -> None:
    labels = breakdown_labels(*catalog_frames())
    gender = labels["gender"]
    assert gender["display_name"] == "Gender"
    assert [level["value"] for level in gender["levels"]] == [1, 2, 3, 4]
    assert gender["levels"][0]["label"] == "Male"
    # Nonresponse codes never become levels.
    assert all(level["value"] != 99 for level in gender["levels"])
    assert labels["education_3"]["display_name"] == "Education (three levels)"


def test_missing_catalog_source_falls_back_to_codes() -> None:
    labels = breakdown_labels(*catalog_frames())
    employment = labels["employment"]  # not in the tiny catalog above
    assert employment["display_name"] == "Employment"
    assert [level["label"] for level in employment["levels"]] == [str(v) for v in range(1, 9)]


def test_literal_columns() -> None:
    labels = breakdown_labels(*catalog_frames())
    bands = labels["age_band"]["levels"]
    assert [level["value"] for level in bands] == list(BREAKDOWN_LEVELS["age_band"])
    assert bands[0]["label"] == "18–24" and bands[-1]["label"] == "80+"
    quintiles = labels["income_quintile"]["levels"]
    assert quintiles[0] == {"value": 1, "label": "Q1 (lowest)"}
    assert quintiles[-1] == {"value": 5, "label": "Q5 (highest)"}


def test_payload_is_always_complete() -> None:
    labels = breakdown_labels(*catalog_frames())
    assert set(labels) == set(CATALOG_SOURCES)
    for column, entry in labels.items():
        assert entry["display_name"]
        values = [level["value"] for level in entry["levels"]]
        assert tuple(values) == BREAKDOWN_LEVELS[column]


@pytest.mark.parametrize(
    ("scale_type", "expected"),
    [
        ("scale_0_10", "mean"),
        ("count", "mean"),
        ("ordinal", "proportion"),
        ("nominal", "proportion"),
        ("binary", "proportion"),
    ],
)
def test_default_stat(scale_type: str, expected: str) -> None:
    assert default_stat(scale_type) == expected
