"""Weighted quantiles: smallest value with weighted CDF ≥ p (R qrule="math")."""

import polars as pl
import pytest
from flourish_stats import Design, SuppressionPolicy, weighted_quantile

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "y": [3, 5, 4, 10, 8, 1, 2, 6, 4],
    }
)


def by_p(table):
    return {r["p"]: r for r in table.to_pylist()}


def test_matches_r_qrule_math() -> None:
    # R survey 4.5: svyquantile(~y, des, c(.25, .5, .75), qrule="math") → 2, 4, 5.
    rows = by_p(weighted_quantile(TOY, "y", TAYLOR, p=(0.25, 0.5, 0.75), policy=NO_SUPPRESSION))
    assert rows[0.25]["estimate"] == 2.0
    assert rows[0.5]["estimate"] == 4.0
    assert rows[0.75]["estimate"] == 5.0


def test_point_estimate_only() -> None:
    row = by_p(weighted_quantile(TOY, "y", TAYLOR, policy=NO_SUPPRESSION))[0.5]
    assert row["se"] is None and row["ci_lo"] is None and row["ci_hi"] is None
    assert row["ci_method"] == "none"
    assert row["se_method"] == "none"
    assert row["stat"] == "quantile"
    assert row["n"] == 9
    assert row["weight"] == "w"


def test_cdf_boundary_is_inclusive() -> None:
    # F(2) = 0.5 exactly: the smallest value with F ≥ 0.5 is 2.
    frame = pl.DataFrame({"w": [1.0, 1.0, 1.0, 1.0], "y": [1, 2, 3, 4]})
    row = by_p(weighted_quantile(frame, "y", Design(weight="w"), policy=NO_SUPPRESSION))[0.5]
    assert row["estimate"] == 2.0


def test_by_groups_and_null_values() -> None:
    frame = pl.DataFrame(
        {
            "w": [1.0] * 6,
            "y": [1, 2, 3, None, 10, 20],
            "g": ["a", "a", "a", "b", "b", "b"],
        }
    )
    rows = weighted_quantile(
        frame, "y", Design(weight="w"), by=["g"], policy=NO_SUPPRESSION
    ).to_pylist()
    by_group = {r["g"]: r for r in rows}
    assert by_group["a"]["estimate"] == 2.0
    assert by_group["b"]["estimate"] == 10.0  # null excluded: median of {10, 20}
    assert by_group["b"]["n"] == 2


def test_suppression_applies() -> None:
    row = by_p(weighted_quantile(TOY, "y", TAYLOR))[0.5]  # default policy, n=9 < 50
    assert row["suppressed"] is True and row["estimate"] is None and row["n"] == 9


def test_invalid_p_rejected() -> None:
    for bad in ((), (0.0,), (1.0,), (-0.1,), (0.5, 1.5)):
        with pytest.raises(ValueError, match="p must be"):
            weighted_quantile(TOY, "y", TAYLOR, p=bad)
