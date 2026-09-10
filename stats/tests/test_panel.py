"""Panel estimators: paired change, three-point panel, transitions.

Expected constants verified against R survey 4.5 (same design and options
as test_mean.py): ``svymean(~I(y2 - y1), na.rm=TRUE)``,
``svymean(~interaction(factor(from), factor(to)))`` and
``svymean(~factor(to), subset(design, from == f))``.
"""

import polars as pl
import pytest
from flourish_stats import (
    Design,
    SuppressionPolicy,
    paired_change,
    paired_change_distribution,
    three_point_panel,
    transition_matrix,
)

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "from": [1, 2, 1, 2, 1, 1, 2, 1, 2],
        "to": [2, 2, 1, 2, 1, 1, 1, 1, 2],
        "y1": [3, 5, 4, 10, 8, 1, 2, 6, 4],
        "y2": [4, 4, 6, 9, None, 3, 2, 8, 4],
    }
)


def one_row(table, **filters):
    rows = [r for r in table.to_pylist() if all(r[k] == v for k, v in filters.items())]
    assert len(rows) == 1, rows
    return rows[0]


class TestPairedChange:
    def test_matches_r_and_counts_pairs(self) -> None:
        row = one_row(paired_change(TOY, "y1", "y2", TAYLOR, policy=NO_SUPPRESSION))
        assert row["estimate"] == pytest.approx(0.7, rel=1e-12)
        assert row["se"] == pytest.approx(0.604648658313239, rel=1e-12)  # R
        assert row["n"] == 8  # one incomplete pair excluded
        assert row["stat"] == "change"
        assert row["se_method"] == "taylor"

    def test_equals_difference_of_means_on_complete_pairs(self) -> None:
        from flourish_stats import weighted_mean

        pairs = TOY.drop_nulls(["y1", "y2"])
        change = one_row(paired_change(pairs, "y1", "y2", TAYLOR, policy=NO_SUPPRESSION))
        m1 = one_row(weighted_mean(pairs, "y1", TAYLOR, policy=NO_SUPPRESSION))
        m2 = one_row(weighted_mean(pairs, "y2", TAYLOR, policy=NO_SUPPRESSION))
        assert change["estimate"] == pytest.approx(m2["estimate"] - m1["estimate"], rel=1e-12)

    def test_suppression_applies_to_pair_count(self) -> None:
        row = one_row(paired_change(TOY, "y1", "y2", TAYLOR))  # default policy
        assert row["suppressed"] is True and row["estimate"] is None and row["n"] == 8


class TestChangeDistribution:
    def test_bins_span_the_contiguous_change_range(self) -> None:
        # Changes on complete pairs: 1, −1, 2, −1, 2, 0, 2, 0 → range −1…2.
        rows = paired_change_distribution(
            TOY, "y1", "y2", TAYLOR, policy=NO_SUPPRESSION
        ).to_pylist()
        assert [r["level"] for r in rows] == [-1, 0, 1, 2]
        assert sum(r["estimate"] for r in rows) == pytest.approx(1.0, abs=1e-12)
        assert sum(r["n"] for r in rows) == 8
        assert all(r["stat"] == "change_distribution" for r in rows)
        assert all(r["ci_lo"] is not None for r in rows if r["estimate"] is not None)

    def test_explicit_levels_keep_empty_bins(self) -> None:
        rows = paired_change_distribution(
            TOY, "y1", "y2", TAYLOR, levels=range(-3, 4), policy=NO_SUPPRESSION
        ).to_pylist()
        by_level = {r["level"]: r for r in rows}
        assert set(by_level) == set(range(-3, 4))
        assert by_level[-3]["n"] == 0 and by_level[-3]["estimate"] == 0.0
        assert by_level[3]["n"] == 0

    def test_float_items_need_explicit_levels(self) -> None:
        frame = TOY.with_columns(pl.col("y1").cast(pl.Float64))
        with pytest.raises(ValueError, match="non-integer"):
            paired_change_distribution(frame, "y1", "y2", TAYLOR)


class TestThreePointPanel:
    @staticmethod
    def make_frame() -> pl.DataFrame:
        return pl.DataFrame(
            {
                "strata": [1, 1, 1, 1, 2, 2],
                "psu": [11, 11, 12, 12, 21, 22],
                "w_l1m2": [1.0, 2.0, 1.0, 0.5, 1.5, 1.0],
                "retained_y2": [True] * 6,
                "has_midyear": [True] * 6,
                "midyear_type": [1, 1, 2, 2, 1, 2],
                "y1": [2, 4, 6, 3, 5, 7],
                "my": [3, 4, 5, 4, 6, 6],
                "y2": [5, 3, 7, 4, 8, 6],
            }
        )

    DESIGN = Design(weight="w_l1m2", strata="strata", psu="psu")

    def test_three_legs_with_midyear_restriction(self) -> None:
        table = three_point_panel(
            self.make_frame(), "y1", "my", "y2", self.DESIGN, policy=NO_SUPPRESSION
        )
        legs = {r["leg"]: r for r in table.to_pylist()}
        assert set(legs) == {"y1_my", "my_y2", "y1_y2"}
        # y1_my and y1_y2 use all six respondents…
        assert legs["y1_my"]["n"] == 6
        assert legs["y1_y2"]["n"] == 6
        # …but my_y2 is restricted to the three standalone (type 1) rows,
        # by the weight table, without the caller doing anything.
        assert legs["my_y2"]["n"] == 3
        # Hand check: type-1 rows have my→y2 changes 2, −1, 2 with weights
        # 1, 2, 1.5 → mean = (2 − 2 + 3)/4.5 = 2/3.
        assert legs["my_y2"]["estimate"] == pytest.approx(2 / 3, rel=1e-12)
        assert all(r["weight"] == "w_l1m2" for r in table.to_pylist())

    def test_rejects_the_wrong_weight(self) -> None:
        with pytest.raises(ValueError, match="w_l1m2"):
            three_point_panel(
                self.make_frame().rename({"w_l1m2": "w_l2"}),
                "y1",
                "my",
                "y2",
                Design(weight="w_l2", strata="strata", psu="psu"),
            )

    def test_rejects_ineligible_rows(self) -> None:
        bad = self.make_frame().with_columns(
            pl.Series("retained_y2", [True, True, True, True, True, False])
        )
        with pytest.raises(ValueError, match="not eligible"):
            three_point_panel(bad, "y1", "my", "y2", self.DESIGN)


class TestTransitionMatrix:
    def test_joint_matches_r_interaction(self) -> None:
        rows = transition_matrix(TOY, "from", "to", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
        joint = {
            (r["from_level"], r["to_level"]): r for r in rows if r["measure"] == "transition_joint"
        }
        expected = {  # R svymean(~interaction(factor(from), factor(to)))
            (1, 1): (0.476190476190476, 0.246342426911883, 4),
            (1, 2): (0.095238095238095, 0.083130624851807, 1),
            (2, 1): (0.095238095238095, 0.103913281064758, 1),
            (2, 2): (0.333333333333333, 0.160309602196223, 3),
        }
        assert set(joint) == set(expected)
        for cell, (est, se, n) in expected.items():
            assert joint[cell]["estimate"] == pytest.approx(est, rel=1e-9)
            assert joint[cell]["se"] == pytest.approx(se, rel=1e-9)
            assert joint[cell]["n"] == n
        assert sum(r["estimate"] for r in joint.values()) == pytest.approx(1.0, abs=1e-12)

    def test_conditional_matches_r_subset(self) -> None:
        rows = transition_matrix(TOY, "from", "to", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
        cond = {
            (r["from_level"], r["to_level"]): r
            for r in rows
            if r["measure"] == "transition_conditional"
        }
        expected = {  # R svymean(~factor(to), subset(design, from == f))
            (1, 1): (0.833333333333333, 0.187371355044889),
            (1, 2): (0.166666666666667, 0.187371355044889),
            (2, 1): (0.222222222222222, 0.238114833604764),
            (2, 2): (0.777777777777778, 0.238114833604764),
        }
        for cell, (est, se) in expected.items():
            assert cond[cell]["estimate"] == pytest.approx(est, rel=1e-9)
            assert cond[cell]["se"] == pytest.approx(se, rel=1e-9)
        for from_level in (1, 2):
            row_sum = sum(v["estimate"] for (f, _), v in cond.items() if f == from_level)
            assert row_sum == pytest.approx(1.0, abs=1e-12)

    def test_incomplete_pairs_are_excluded_but_stay_in_design(self) -> None:
        frame = TOY.with_columns(
            pl.when(pl.col("psu") == 21).then(None).otherwise(pl.col("to")).alias("to")
        )
        rows = transition_matrix(frame, "from", "to", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
        assert sum(r["n"] for r in rows if r["measure"] == "transition_joint") == 7

    def test_explicit_levels_emit_empty_cells(self) -> None:
        rows = transition_matrix(
            TOY, "from", "to", TAYLOR, levels=[1, 2, 3], policy=NO_SUPPRESSION
        ).to_pylist()
        joint = {
            (r["from_level"], r["to_level"]): r for r in rows if r["measure"] == "transition_joint"
        }
        assert set(joint) == {(i, j) for i in (1, 2, 3) for j in (1, 2, 3)}
        assert joint[(3, 3)]["n"] == 0 and joint[(3, 3)]["estimate"] == 0.0
        assert joint[(3, 1)]["n"] == 0

    def test_suppression_is_per_cell(self) -> None:
        rows = transition_matrix(TOY, "from", "to", TAYLOR).to_pylist()  # default policy
        assert all(r["suppressed"] for r in rows)  # every cell n < 50
        assert all(r["estimate"] is None for r in rows)
        assert {r["n"] for r in rows if r["measure"] == "transition_joint"} == {4, 1, 3}

    def test_stat_and_measure_labels(self) -> None:
        rows = transition_matrix(TOY, "from", "to", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
        assert {r["stat"] for r in rows} == {"transition"}
        assert {r["measure"] for r in rows} == {"transition_joint", "transition_conditional"}
