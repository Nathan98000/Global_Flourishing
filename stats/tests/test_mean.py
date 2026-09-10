"""Weighted mean: unit tests on a hand-computable design.

The toy design (3 strata: two PSUs, one lonely PSU, three PSUs) is fully
hand-computed below and every expected constant was independently verified
against R survey 4.5 with ``options(survey.lonely.psu="adjust",
survey.adjust.domain.lonely=TRUE)`` — the same options the parity harness
(stats/verify/) pins for the real data.
"""

import math

import polars as pl
import pytest
from flourish_stats import Design, SuppressionPolicy, weighted_mean

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")
KISH = Design(weight="w")

# Stratum 1: PSUs 11 (two respondents), 12. Stratum 2: PSU 21 — lonely in
# the design. Stratum 3: PSUs 31, 32, 33.
TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "y": [3, 5, 4, 10, 8, 1, 2, 6, 4],
        # Domain "b" = 3 rows in stratum 3 (PSUs 32, 33): strata 1 and 2
        # empty, stratum 3 missing one of its three design PSUs.
        "g": ["a", "a", "a", "a", "a", "a", "b", "b", "b"],
        # Domain "c" leaves stratum 3 with a single PSU (31) — lonely in
        # the domain, not in the design.
        "g2": ["c", "c", "c", "c", "c", "c", "d", "d", "d"],
    }
)


def one_row(table, **filters):
    rows = [r for r in table.to_pylist() if all(r[k] == v for k, v in filters.items())]
    assert len(rows) == 1, rows
    return rows[0]


def test_full_design_hand_computed() -> None:
    # ȳ = Σwy/Σw = 45/10.5 = 30/7.
    # Scores z_i = w_i(y_i − ȳ)/10.5, in units of 1/73.5:
    #   stratum 1 PSU totals: 1, −3        (T=−2,  Σz²=10)
    #   stratum 2 PSU total : 53           (lonely in design)
    #   stratum 3 PSU totals: −46, −16, 11 (T=−51, Σz²=2493)
    # Grand recentering z̄ = Σz / Σ design PSUs = 0/6 = 0.
    # V = 2/1·(10 − 4/2) + 53² + 3/2·(2493 − 51²/3)  [all /73.5²]
    #   = (16 + 2809 + 2439)/5402.25 = 5264/5402.25
    row = one_row(weighted_mean(TOY, "y", TAYLOR, policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(30 / 7, abs=1e-12)
    assert row["se"] == pytest.approx(math.sqrt(5264 / 5402.25), rel=1e-12)
    # R: svymean → 4.285714285714286, SE 0.987121477399568
    assert row["se"] == pytest.approx(0.987121477399568, rel=1e-12)
    assert (row["n"], row["n_psu"], row["n_strata"], row["df"]) == (9, 6, 3, 3)
    assert row["sum_w"] == pytest.approx(10.5)
    assert row["se_method"] == "taylor"
    assert row["weight"] == "w"
    assert row["stat"] == "mean"
    assert row["ci_level"] == 0.95
    assert row["ci_method"] == "normal"
    # Normal-based CI, verified against R confint():
    assert row["ci_lo"] == pytest.approx(2.350991741645165, rel=1e-9)
    assert row["ci_hi"] == pytest.approx(6.220436829783406, rel=1e-9)


def test_domain_pads_to_design_psu_count() -> None:
    # Domain "b": ȳ = 10/2.5 = 4; scores z = w(y−4)/2.5 → PSU totals
    # −0.8 (PSU 32) and 0.8 (PSU 33). Stratum 3 has THREE design PSUs, so
    # R pads a zero total: mean 0, V = 3/2·(0.64 + 0.64 + 0) = 1.92.
    # A naive two-PSU computation would give 2/1·(0.64+0.64−0) = 2.56.
    row = one_row(weighted_mean(TOY, "y", TAYLOR, by=["g"], policy=NO_SUPPRESSION), g="b")
    assert row["estimate"] == pytest.approx(4.0)
    assert row["se"] == pytest.approx(math.sqrt(1.92), rel=1e-12)
    assert row["se"] == pytest.approx(1.385640646055102, rel=1e-12)  # R svyby/subset
    assert (row["n"], row["n_psu"], row["n_strata"], row["df"]) == (3, 2, 1, 1)


def test_domain_lonely_psu_centred_at_grand_mean() -> None:
    # Domain "c" (6 rows): ȳ = 35/8 = 4.375; scores w(y−ȳ)/8.
    #   stratum 1: PSU totals −0.015625, −0.0703125
    #   stratum 2: 0.9296875 (lonely in design)
    #   stratum 3: −0.84375 (one of three design PSUs → lonely in domain)
    # z̄ = 0/(2+1+3) = 0.
    #   h1: 2·(Σz² − T²/2)                       = 0.00299072265625
    #   h2: (0.9296875 − 0)²                     = 0.86431884765625
    #   h3: 3/2·((−0.84375 − 0)² + 2·0²)         = 1.06787109375
    expected_var = 0.00299072265625 + 0.86431884765625 + 1.06787109375
    row = one_row(weighted_mean(TOY, "y", TAYLOR, by=["g2"], policy=NO_SUPPRESSION), g2="c")
    assert row["estimate"] == pytest.approx(4.375)
    assert row["se"] == pytest.approx(math.sqrt(expected_var), rel=1e-12)
    assert row["se"] == pytest.approx(1.391107711164919, rel=1e-12)  # R


def test_null_values_stay_in_the_variance_design() -> None:
    # Nulling y for both respondents of PSU 11 leaves the PSU in the
    # design: stratum 1 becomes lonely *in the domain* (valid rows only in
    # PSU 12) but keeps its two design PSUs.
    # R (svymean, na.rm=TRUE): 4.266666…, SE 1.383928921317587.
    nulled = TOY.with_columns(
        pl.when(pl.col("psu") == 11).then(None).otherwise(pl.col("y")).alias("y")
    )
    row = one_row(weighted_mean(nulled, "y", TAYLOR, policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(32 / 7.5, rel=1e-12)
    assert row["se"] == pytest.approx(1.383928921317587, rel=1e-9)
    assert row["n"] == 7

    # Dropping the rows instead would shrink stratum 1 to one *design* PSU
    # (R on the 7-row design: SE 1.382900869482269) — proving eligibility
    # filtering and complete-case exclusion are not interchangeable.
    dropped = TOY.filter(pl.col("psu") != 11)
    row_dropped = one_row(weighted_mean(dropped, "y", TAYLOR, policy=NO_SUPPRESSION))
    assert row_dropped["estimate"] == pytest.approx(row["estimate"])
    assert row_dropped["se"] == pytest.approx(1.382900869482269, rel=1e-9)
    assert row_dropped["se"] != pytest.approx(row["se"], rel=1e-6)


def test_group_subset_equals_domain_when_strata_nest() -> None:
    # Strata nest within countries in the GFS design, so estimating one
    # country as a by-group of the full frame must equal estimating on the
    # country's rows alone (§ CLAUDE.md / task 2.3.2).
    frame = TOY.with_columns(
        pl.when(pl.col("strata") == 3).then(pl.lit("B")).otherwise(pl.lit("A")).alias("country")
    )
    by_group = one_row(
        weighted_mean(frame, "y", TAYLOR, by=["country"], policy=NO_SUPPRESSION), country="B"
    )
    alone = one_row(
        weighted_mean(frame.filter(pl.col("country") == "B"), "y", TAYLOR, policy=NO_SUPPRESSION)
    )
    assert by_group["estimate"] == pytest.approx(alone["estimate"], rel=1e-14)
    assert by_group["se"] == pytest.approx(alone["se"], rel=1e-14)
    assert by_group["df"] == alone["df"]


def test_kish_fallback_matches_classical_se_for_equal_weights() -> None:
    frame = pl.DataFrame({"w": [1.0] * 6, "y": [2, 4, 4, 5, 7, 8]})
    row = one_row(weighted_mean(frame, "y", KISH, policy=NO_SUPPRESSION))
    values = [2, 4, 4, 5, 7, 8]
    mean = sum(values) / 6
    s = math.sqrt(sum((v - mean) ** 2 for v in values) / 5)
    assert row["estimate"] == pytest.approx(mean)
    assert row["se"] == pytest.approx(s / math.sqrt(6), rel=1e-12)
    assert row["se_method"] == "kish"
    assert row["n_psu"] is None and row["n_strata"] is None and row["df"] is None


def test_kish_single_observation_has_no_se() -> None:
    frame = pl.DataFrame({"w": [2.0], "y": [5]})
    row = one_row(weighted_mean(frame, "y", KISH, policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(5.0)
    assert row["se"] is None and row["ci_lo"] is None and row["ci_hi"] is None


def test_empty_domain_appears_with_n_zero() -> None:
    frame = TOY.with_columns(
        pl.when(pl.col("g") == "b").then(None).otherwise(pl.col("y")).alias("y")
    )
    row = one_row(weighted_mean(frame, "y", TAYLOR, by=["g"], policy=NO_SUPPRESSION), g="b")
    assert row["n"] == 0
    assert row["sum_w"] == 0.0
    assert row["estimate"] is None and row["se"] is None


def test_default_policy_suppresses_and_flags() -> None:
    # 9 respondents < 50 → suppressed under the default policy, but the
    # row keeps its n and sum_w so the suppression is visible.
    row = one_row(weighted_mean(TOY, "y", TAYLOR))
    assert row["suppressed"] is True and row["flagged"] is False
    assert row["estimate"] is None and row["se"] is None
    assert row["ci_lo"] is None and row["ci_hi"] is None
    assert row["n"] == 9
    assert row["sum_w"] == pytest.approx(10.5)

    frame = pl.DataFrame({"w": [1.0] * 60, "y": list(range(60))})
    row = one_row(weighted_mean(frame, "y", KISH))
    assert row["suppressed"] is False and row["flagged"] is True
    assert row["estimate"] is not None


def test_rejects_missing_and_null_columns() -> None:
    with pytest.raises(ValueError, match="missing columns"):
        weighted_mean(TOY, "nope", TAYLOR)
    with pytest.raises(ValueError, match="missing columns"):
        weighted_mean(TOY.drop("psu"), "y", TAYLOR)
    with pytest.raises(ValueError, match="weight column"):
        weighted_mean(
            TOY.with_columns(
                pl.when(pl.col("psu") == 11).then(None).otherwise(pl.col("w")).alias("w")
            ),
            "y",
            TAYLOR,
        )
    with pytest.raises(ValueError, match="design column"):
        weighted_mean(
            TOY.with_columns(
                pl.when(pl.col("psu") == 11).then(None).otherwise(pl.col("strata")).alias("strata")
            ),
            "y",
            TAYLOR,
        )
    with pytest.raises(TypeError, match="pyarrow Table or polars DataFrame"):
        weighted_mean([1, 2, 3], "y", TAYLOR)  # type: ignore[arg-type]


def test_accepts_pyarrow_and_returns_pyarrow() -> None:
    import pyarrow as pa

    table = TOY.to_arrow()
    out = weighted_mean(table, "y", TAYLOR, policy=NO_SUPPRESSION)
    assert isinstance(out, pa.Table)
    assert one_row(out)["estimate"] == pytest.approx(30 / 7)


def test_null_group_key_forms_its_own_group() -> None:
    frame = TOY.with_columns(
        pl.when(pl.col("g") == "b").then(None).otherwise(pl.col("g")).alias("g")
    )
    rows = weighted_mean(frame, "y", TAYLOR, by=["g"], policy=NO_SUPPRESSION).to_pylist()
    assert {r["g"] for r in rows} == {"a", None}
