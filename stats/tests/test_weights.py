"""The wave → weight → eligibility table (the only home of these facts)."""

import json

import polars as pl
import pytest
from flourish_stats import weights
from flourish_stats.weights import (
    WEIGHT_TABLE,
    eligibility_expr,
    get,
    resolve,
    validate_frame,
    weight_table_json,
)

# The respondents weight columns as built by Phase 1 (hard-coded here on
# purpose; test_built.py checks the same names against the real Parquet
# schema when the data is present).
RESPONDENTS_WEIGHT_COLUMNS = {
    "w_c1",
    "w_c2",
    "w_l2",
    "w_r2",
    "w_l1m",
    "w_l1m2",
    "w_state_c1",
    "w_state_c2",
    "w_state_l2",
    "w_state_r2",
    "w_state_l1m",
    "w_state_l1m2",
    "w_state_adj_c2",
    "w_state_adj_l2",
    "w_state_adj_r2",
    "w_state_adj_l1m",
    "w_state_adj_l1m2",
}


def test_every_weight_column_exists_in_respondents() -> None:
    used = {spec.weight for spec in WEIGHT_TABLE}
    assert used <= RESPONDENTS_WEIGHT_COLUMNS
    assert used == RESPONDENTS_WEIGHT_COLUMNS  # and every column is reachable


def test_table_shape_and_keys_are_stable() -> None:
    assert len(WEIGHT_TABLE) == 23  # 8 global + 8 us_state + 7 us_state_adj
    keys = [spec.key for spec in WEIGHT_TABLE]
    assert len(set(keys)) == len(keys)
    assert "us_state_adj:y1" not in keys  # no _ADJ_ variant of the Wave 1 weight
    assert all(spec.rationale.strip() for spec in WEIGHT_TABLE)


def test_resolve_defaults() -> None:
    assert resolve(("Y1",)).weight == "w_c1"
    assert resolve(("Y2",)).weight == "w_c2"
    assert resolve(("MY",)).weight == "w_l1m"
    assert resolve(("Y1", "Y2")).key == "y1_y2"
    assert resolve(("Y1", "Y2")).weight == "w_l2"  # never w_r2 by default
    assert resolve(("Y1", "MY")).weight == "w_l1m"
    assert resolve(("Y1", "MY", "Y2")).weight == "w_l1m2"
    assert resolve(("MY", "Y2")).weight == "w_l1m2"
    assert resolve(("Y1",), scope="us_state").weight == "w_state_c1"
    assert resolve(("Y2",), scope="us_state_adj").weight == "w_state_adj_c2"
    with pytest.raises(KeyError, match="no weight spec"):
        resolve(("Y2", "Y1"))
    with pytest.raises(KeyError, match="no weight spec"):
        resolve(("Y1",), scope="us_state_adj")


def test_get_reaches_the_rectangular_alternative() -> None:
    rect = get("y1_y2_rect")
    assert rect.weight == "w_r2"
    assert rect.is_default is False
    assert "207,919" in rect.rationale  # the quirk is documented on the row
    with pytest.raises(KeyError, match="no weight spec"):
        get("y3")


def test_my_y2_requires_standalone_midyear() -> None:
    for key in ("my_y2", "us_state:my_y2", "us_state_adj:my_y2"):
        spec = get(key)
        assert spec.requires_midyear_type_1
        assert spec.requires_retained_y2
        assert spec.requires_has_midyear
    # No other row restricts by midyear type.
    others = [s for s in WEIGHT_TABLE if not s.key.endswith("my_y2")]
    assert not any(s.requires_midyear_type_1 for s in others)


def make_frame(**overrides: object) -> pl.DataFrame:
    base = pl.DataFrame(
        {
            "id": [1, 2],
            "country_code": [22, 22],
            "state": ["CA", "NY"],
            "retained_y2": [True, True],
            "has_midyear": [True, True],
            "midyear_type": [1, 1],
            "w_c1": [1.0, 1.0],
            "w_l1m2": [1.0, 1.1],
            "w_r2": [0.9, 1.2],
            "w_state_c1": [1.0, 1.0],
        }
    )
    return base.with_columns(
        *[pl.Series(name, values) for name, values in overrides.items()]  # type: ignore[arg-type]
    )


def test_eligibility_expr_selects_the_right_rows() -> None:
    frame = make_frame(retained_y2=[True, False], has_midyear=[True, True], midyear_type=[1, 2])
    assert frame.filter(eligibility_expr(get("y1"))).height == 2
    assert frame.filter(eligibility_expr(get("y2"))).height == 1
    assert frame.filter(eligibility_expr(get("my_y2"))).height == 1  # type 2 excluded
    us = make_frame(country_code=[22, 3])
    assert us.filter(eligibility_expr(get("us_state:y1"))).height == 1


def test_validate_frame_accepts_an_eligible_frame() -> None:
    validate_frame(make_frame(), get("my_y2"))
    validate_frame(make_frame().to_arrow(), get("my_y2"))


def test_validate_frame_rejects_ineligible_rows() -> None:
    with pytest.raises(ValueError, match="not eligible"):
        validate_frame(make_frame(retained_y2=[True, False]), get("y1_y2_rect"))
    with pytest.raises(ValueError, match="not eligible"):
        validate_frame(make_frame(midyear_type=[1, 2]), get("my_y2"))
    with pytest.raises(ValueError, match="not eligible"):
        validate_frame(make_frame(state=["CA", None]), get("us_state:y1"))


def test_validate_frame_rejects_null_weights_on_eligible_rows() -> None:
    with pytest.raises(ValueError, match="null or non-positive"):
        validate_frame(make_frame(w_l1m2=[1.0, None]), get("my_y2"))
    with pytest.raises(ValueError, match="null or non-positive"):
        validate_frame(make_frame(w_l1m2=[1.0, -0.5]), get("my_y2"))


def test_validate_frame_rejects_missing_columns() -> None:
    with pytest.raises(ValueError, match="missing columns"):
        validate_frame(make_frame().drop("midyear_type"), get("my_y2"))
    with pytest.raises(ValueError, match="missing columns"):
        validate_frame(make_frame().drop("w_l1m2"), get("my_y2"))


def test_json_export_round_trips() -> None:
    rows = json.loads(weight_table_json())
    assert len(rows) == len(WEIGHT_TABLE)
    by_key = {row["key"]: row for row in rows}
    assert by_key["y1_y2"]["weight"] == "w_l2"
    assert by_key["my_y2"]["requires_midyear_type_1"] is True
    assert by_key["y1_y2_rect"]["is_default"] is False
    assert by_key["us_state:y1"]["waves"] == ["Y1"]
    assert all(row["rationale"] for row in rows)


def test_flag_columns_cover_the_predicate() -> None:
    assert weights.get("y1").flag_columns == ()
    assert set(get("my_y2").flag_columns) == {"retained_y2", "has_midyear", "midyear_type"}
    assert {"country_code", "state"} <= set(get("us_state:y2").flag_columns)
