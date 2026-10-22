"""The serving policy (ADR-0031): thin estimates flagged at 30 people — a
share by its group's answerers — and no interval where the SE is zero."""

import polars as pl
import pytest
from flourish_stats import SERVING_POLICY, Design, weighted_mean, weighted_proportion

SRS = Design(weight="w")


def frame(groups: dict[str, list[int]]) -> pl.DataFrame:
    """One row per answer, grouped by ``g``, all weights 1."""
    g = [name for name, values in groups.items() for _ in values]
    y = [value for values in groups.values() for value in values]
    return pl.DataFrame({"g": g, "y": y, "w": [1.0] * len(y)})


def by_group(rows: list[dict[str, object]]) -> dict[object, dict[str, object]]:
    return {row["g"]: row for row in rows}


def test_serving_policy_shows_every_cell_and_flags_below_thirty() -> None:
    assert SERVING_POLICY.threshold == 0
    assert SERVING_POLICY.flag_below == 30


def test_a_mean_is_flagged_below_thirty_people() -> None:
    data = frame({"small": [1, 2] * 14 + [3], "big": [1, 2] * 15})
    rows = by_group(weighted_mean(data, "y", SRS, by=["g"], policy=SERVING_POLICY).to_pylist())
    assert rows["small"]["n"] == 29 and rows["small"]["flagged"] is True
    assert rows["big"]["n"] == 30 and rows["big"]["flagged"] is False
    assert rows["small"]["suppressed"] is False and rows["small"]["estimate"] is not None


def test_a_share_is_flagged_by_its_groups_answerers_not_its_level() -> None:
    # 1,000 people, 5 of whom said 2: a well-measured small share.
    data = frame({"big": [1] * 995 + [2] * 5, "small": [1] * 10 + [2] * 10})
    rows = weighted_proportion(data, "y", SRS, by=["g"], policy=SERVING_POLICY).to_pylist()
    rare = next(r for r in rows if r["g"] == "big" and r["level"] == 2)
    assert rare["n"] == 5  # n keeps its meaning: the people at the level
    assert rare["flagged"] is False
    assert all(r["flagged"] for r in rows if r["g"] == "small")


def test_one_person_has_no_interval() -> None:
    data = frame({"one": [9], "many": [1, 2, 3, 4, 5]})
    rows = by_group(weighted_mean(data, "y", SRS, by=["g"], policy=SERVING_POLICY).to_pylist())
    assert rows["one"]["estimate"] == pytest.approx(9.0)
    assert rows["one"]["ci_lo"] is None and rows["one"]["ci_hi"] is None
    assert rows["many"]["ci_lo"] is not None and rows["many"]["ci_hi"] is not None


def test_everyone_giving_the_same_answer_has_no_interval() -> None:
    data = frame({"same": [10, 10, 10, 10], "mixed": [9, 10, 10, 10]})
    rows = by_group(weighted_mean(data, "y", SRS, by=["g"], policy=SERVING_POLICY).to_pylist())
    assert rows["same"]["ci_lo"] is None
    assert rows["mixed"]["ci_lo"] is not None


def test_a_group_with_no_answers_is_not_flagged() -> None:
    schema = {"g": pl.String, "y": pl.Int64, "w": pl.Float64}
    empty = pl.DataFrame({"g": ["b"], "y": [None], "w": [1.0]}, schema=schema)
    data = frame({"a": [1, 2, 3]}).vstack(empty)
    rows = by_group(weighted_mean(data, "y", SRS, by=["g"], policy=SERVING_POLICY).to_pylist())
    assert rows["b"]["estimate"] is None and rows["b"]["flagged"] is False
