"""Weighted correlations, adjusted associations and the Phase 5 stub."""

import math

import numpy as np
import polars as pl
import pytest
from flourish_stats import (
    Design,
    SuppressionPolicy,
    adjusted_association,
    pooled_population_weights,
    weighted_correlation,
    weighted_correlations,
)

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

# Same toy design as test_mean.py plus a second item; R survey 4.5:
# svyvar(~y + x2) → cov/sqrt(vy·vx2) = 0.925982832432145.
TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "y": [3, 5, 4, 10, 8, 1, 2, 6, 4],
        "x2": [2, 4, 5, 9, 9, 2, 1, 5, 5],
    }
)


def one_row(table):
    rows = table.to_pylist()
    assert len(rows) == 1
    return rows[0]


def test_pearson_matches_r_svyvar_ratio() -> None:
    row = one_row(weighted_correlation(TOY, "y", "x2", TAYLOR, policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(0.925982832432145, rel=1e-12)
    assert row["stat"] == "pearson_r"
    assert row["n"] == 9
    assert row["sum_w"] == pytest.approx(10.5)
    assert row["se"] is None and row["ci_lo"] is None
    assert row["ci_method"] == "none" and row["se_method"] == "none"


def test_equal_weights_reduce_to_classical_pearson() -> None:
    xs = [1, 3, 2, 5, 4, 7, 6]
    ys = [2, 4, 4, 5, 6, 9, 7]
    frame = pl.DataFrame({"w": [1.0] * 7, "x": xs, "y": ys})
    mx, my = sum(xs) / 7, sum(ys) / 7
    sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys, strict=True))
    r = sxy / math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
    row = one_row(weighted_correlation(frame, "x", "y", Design(weight="w"), policy=NO_SUPPRESSION))
    assert row["estimate"] == pytest.approx(r, rel=1e-12)


def test_spearman_is_pearson_on_average_ranks() -> None:
    # Ties get average ranks: x = [1, 2, 2, 4] → ranks [1, 2.5, 2.5, 4].
    frame = pl.DataFrame({"w": [1.0] * 4, "x": [1, 2, 2, 4], "y": [10, 30, 20, 40]})
    ranks_x = [1.0, 2.5, 2.5, 4.0]
    ranks_y = [1.0, 3.0, 2.0, 4.0]
    mx, my = 2.5, 2.5
    r = sum((a - mx) * (b - my) for a, b in zip(ranks_x, ranks_y, strict=True)) / math.sqrt(
        sum((a - mx) ** 2 for a in ranks_x) * sum((b - my) ** 2 for b in ranks_y)
    )
    row = one_row(
        weighted_correlation(
            frame, "x", "y", Design(weight="w"), method="spearman", policy=NO_SUPPRESSION
        )
    )
    assert row["estimate"] == pytest.approx(r, rel=1e-12)
    assert row["stat"] == "spearman_r"


def test_spearman_ranks_within_each_group() -> None:
    # Group b's y values are shifted by 100: within-group ranks are what
    # matter, so both groups report a perfect positive rank correlation.
    frame = pl.DataFrame(
        {
            "w": [1.0] * 6,
            "g": ["a", "a", "a", "b", "b", "b"],
            "x": [1, 2, 3, 1, 2, 3],
            "y": [1, 4, 9, 101, 104, 109],
        }
    )
    rows = weighted_correlation(
        frame, "x", "y", Design(weight="w"), method="spearman", by=["g"], policy=NO_SUPPRESSION
    ).to_pylist()
    assert all(r["estimate"] == pytest.approx(1.0) for r in rows)


def test_complete_cases_only() -> None:
    frame = TOY.with_columns(
        pl.when(pl.col("psu") == 21).then(None).otherwise(pl.col("x2")).alias("x2")
    )
    row = one_row(weighted_correlation(frame, "y", "x2", TAYLOR, policy=NO_SUPPRESSION))
    assert row["n"] == 7


def test_zero_variance_gives_null_estimate() -> None:
    frame = pl.DataFrame({"w": [1.0] * 4, "x": [3, 3, 3, 3], "y": [1, 2, 3, 4]})
    row = one_row(weighted_correlation(frame, "x", "y", Design(weight="w"), policy=NO_SUPPRESSION))
    assert row["estimate"] is None
    assert row["n"] == 4


def test_suppression_and_method_validation() -> None:
    row = one_row(weighted_correlation(TOY, "y", "x2", TAYLOR))  # default policy, n=9
    assert row["suppressed"] is True and row["estimate"] is None
    with pytest.raises(ValueError, match="method"):
        weighted_correlation(TOY, "y", "x2", TAYLOR, method="kendall")  # type: ignore[arg-type]


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_sweep_matches_the_pairwise_estimator(method: str) -> None:
    # Two predictors with different missingness, two groups: every
    # (group, predictor) cell equals the pairwise function's estimate.
    frame = TOY.with_columns(
        pl.when(pl.col("psu") == 21).then(None).otherwise(pl.col("x2")).alias("x2"),
        pl.when(pl.col("psu") == 33)
        .then(None)
        .otherwise(pl.col("y") * 2 - pl.col("x2"))
        .alias("x3"),
        pl.Series("g", ["a", "a", "a", "b", "b", "a", "b", "b", "a"]),
    )
    for by in ((), ("g",)):
        sweep = weighted_correlations(
            frame,
            "y",
            ["x2", "x3"],
            TAYLOR,
            method=method,  # type: ignore[arg-type]
            by=by,
            policy=NO_SUPPRESSION,
        ).to_pylist()
        assert [r["predictor"] for r in sweep][: len(sweep) // 2 + 1][:2] == ["x2", "x3"] or by
        for row in sweep:
            pairwise = weighted_correlation(
                frame,
                "y",
                row["predictor"],
                TAYLOR,
                method=method,  # type: ignore[arg-type]
                by=by,
                policy=NO_SUPPRESSION,
            ).to_pylist()
            expected = next(r for r in pairwise if all(r[k] == row[k] for k in by))
            assert row["estimate"] == pytest.approx(expected["estimate"], rel=1e-12)
            assert row["n"] == expected["n"] and row["sum_w"] == pytest.approx(expected["sum_w"])
            assert row["stat"] == f"{method}_r" and row["ci_method"] == "none"
            assert row["se"] is None and row["ci_lo"] is None


def test_sweep_undefined_and_empty_cells() -> None:
    frame = TOY.with_columns(pl.lit(3).alias("flat"), pl.lit(None, dtype=pl.Int64).alias("gone"))
    rows = {
        r["predictor"]: r
        for r in weighted_correlations(
            frame, "y", ["flat", "gone", "x2"], TAYLOR, policy=NO_SUPPRESSION
        ).to_pylist()
    }
    assert rows["flat"]["estimate"] is None and rows["flat"]["n"] == 9
    assert rows["gone"]["estimate"] is None and rows["gone"]["n"] == 0
    assert rows["gone"]["sum_w"] == 0.0
    assert rows["x2"]["estimate"] == pytest.approx(0.925982832432145, rel=1e-12)
    with pytest.raises(ValueError, match="distinct"):
        weighted_correlations(TOY, "y", ["x2", "x2"], TAYLOR)
    with pytest.raises(ValueError, match="distinct"):
        weighted_correlations(TOY, "y", ["y"], TAYLOR)
    with pytest.raises(ValueError, match="method"):
        weighted_correlations(TOY, "y", ["x2"], TAYLOR, method="kendall")  # type: ignore[arg-type]


def test_phase_5_stub_raises_loudly() -> None:
    with pytest.raises(NotImplementedError, match="Not implemented: Phase 5"):
        pooled_population_weights(TOY, {22: 258e6})


# --- adjusted associations -----------------------------------------------
#
# The R references below come from survey 4.5 on TOY_ADJ with
#   des <- svydesign(ids=~psu, strata=~strata, weights=~w, data=d, nest=TRUE)
#   options(survey.lonely.psu="adjust", survey.adjust.domain.lonely=TRUE)
# and, for the binomial fits, control=glm.control(epsilon=1e-14, maxit=200)
# (R's default stops at a 1e-8 relative deviance change; the engine iterates
# to 1e-10 on the coefficients, so both must converge past the tolerance).

Z95 = 1.959963984540054

TOY_ADJ = TOY.with_columns(
    pl.Series("g", [1, 1, 2, 2, 1, 2, 1, 2, 1]),
    (pl.col("y") > 4).cast(pl.Int8).alias("yb"),
)
KISH = Design(weight="w")
#: TOY_ADJ with unit weights, one stratum and every row its own PSU: the
#: Taylor path is then the plain with-replacement sandwich.
UNIT = TOY_ADJ.with_columns(
    pl.lit(1.0).alias("w"), pl.lit(1).alias("strata"), pl.int_range(1, 10).alias("psu")
)


def beta_rows(table) -> list[dict]:
    return [r for r in table.to_pylist() if r["measure"] == "beta"]


def beta_row(table) -> dict:
    rows = beta_rows(table)
    assert len(rows) == 1
    return rows[0]


def test_gaussian_matches_r_svyglm() -> None:
    # svyglm(y ~ x2 + factor(g), des): coef 1.04539800995025, SE 0.0731494441002001
    table = adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION)
    row = beta_row(table)
    assert row["estimate"] == pytest.approx(1.04539800995025, rel=1e-12)
    assert row["se"] == pytest.approx(0.0731494441002001, rel=1e-9)
    assert row["stat"] == "beta" and row["ci_method"] == "normal" and row["ci_level"] == 0.95
    assert row["se_method"] == "taylor" and row["weight"] == "w"
    assert row["n"] == 9 and row["sum_w"] == pytest.approx(10.5)
    assert (row["n_psu"], row["n_strata"], row["df"]) == (6, 3, 3)
    assert row["ci_lo"] == pytest.approx(row["estimate"] - Z95 * row["se"])
    assert row["ci_hi"] == pytest.approx(row["estimate"] + Z95 * row["se"])
    assert [r["measure"] for r in table.to_pylist()] == ["beta", "beta_per_sd"]


def test_binomial_matches_r_svyglm() -> None:
    # svyglm(yb ~ x2 + factor(g), des, family=quasibinomial(), control=ctl):
    #   coef 1.37314033762521, SE 0.895097479583677
    row = beta_row(
        adjusted_association(
            TOY_ADJ, "yb", "x2", TAYLOR, family="binomial", controls=["g"], policy=NO_SUPPRESSION
        )
    )
    assert row["estimate"] == pytest.approx(1.37314033762521, rel=1e-9)
    assert row["se"] == pytest.approx(0.895097479583677, rel=1e-6)
    assert row["n"] == 9


def test_no_controls_matches_r_svyglm() -> None:
    # svyglm(y ~ x2, des): coef 1.004662004662, SE 0.110454467903896
    row = beta_row(
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, controls=[], policy=NO_SUPPRESSION)
    )
    assert row["estimate"] == pytest.approx(1.004662004662, rel=1e-12)
    assert row["se"] == pytest.approx(0.110454467903896, rel=1e-9)


def test_unit_weights_reproduce_ols_and_logistic() -> None:
    # lm(y ~ x2 + factor(g)):            coef 0.933910306845004, SE 0.149502394216962
    # glm(yb ~ x2 + factor(g), binomial): coef 0.944062874171203, SE 0.710109443631471
    # svyglm on ids=~1 (each row a PSU):  same coefficient, sandwich SE 0.131472683215364
    ols = beta_row(
        adjusted_association(UNIT, "y", "x2", KISH, controls=["g"], policy=NO_SUPPRESSION)
    )
    assert ols["estimate"] == pytest.approx(0.933910306845004, rel=1e-12)
    assert ols["se"] == pytest.approx(0.149502394216962, rel=1e-9)
    assert ols["se_method"] == "kish" and ols["n_psu"] is None and ols["df"] is None
    logit = beta_row(
        adjusted_association(
            UNIT, "yb", "x2", KISH, family="binomial", controls=["g"], policy=NO_SUPPRESSION
        )
    )
    assert logit["estimate"] == pytest.approx(0.944062874171203, rel=1e-9)
    assert logit["se"] == pytest.approx(0.710109443631471, rel=1e-6)
    sandwich = beta_row(
        adjusted_association(UNIT, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION)
    )
    assert sandwich["estimate"] == pytest.approx(0.933910306845004, rel=1e-12)
    assert sandwich["se"] == pytest.approx(0.131472683215364, rel=1e-9)
    assert sandwich["se_method"] == "taylor" and (sandwich["n_psu"], sandwich["df"]) == (9, 8)


def test_closed_form_fixture() -> None:
    # y = 2 + 3x + 0.5·[g = 2] exactly: the coefficient is 3, every residual
    # is zero, so both SE paths are exactly zero; beta_per_sd is 3·sd(x).
    x = [0, 1, 2, 3, 4, 5]
    g = [1, 2, 1, 2, 1, 2]
    w = [1.0, 2.0, 0.5, 1.5, 1.0, 3.0]
    frame = pl.DataFrame(
        {
            "strata": [1, 1, 1, 2, 2, 2],
            "psu": [1, 2, 3, 4, 5, 6],
            "w": w,
            "x": x,
            "g": g,
            "y": [2 + 3 * a + (0.5 if b == 2 else 0.0) for a, b in zip(x, g, strict=True)],
        }
    )
    mean_x = sum(a * b for a, b in zip(w, x, strict=True)) / sum(w)
    sd_x = math.sqrt(sum(b * (a - mean_x) ** 2 for a, b in zip(x, w, strict=True)) / sum(w))
    for design in (TAYLOR, KISH):
        rows = adjusted_association(frame, "y", "x", design, controls=["g"], policy=NO_SUPPRESSION)
        by_measure = {r["measure"]: r for r in rows.to_pylist()}
        assert by_measure["beta"]["estimate"] == pytest.approx(3.0, abs=1e-12)
        assert by_measure["beta"]["se"] == pytest.approx(0.0, abs=1e-12)
        assert by_measure["beta_per_sd"]["estimate"] == pytest.approx(3.0 * sd_x, abs=1e-12)
        assert by_measure["beta_per_sd"]["se"] == pytest.approx(0.0, abs=1e-12)


def test_beta_per_sd_is_the_fit_on_standardised_x() -> None:
    w, x = TOY_ADJ["w"].to_list(), TOY_ADJ["x2"].to_list()
    mean_x = sum(a * b for a, b in zip(w, x, strict=True)) / sum(w)
    sd_x = math.sqrt(sum(b * (a - mean_x) ** 2 for a, b in zip(x, w, strict=True)) / sum(w))
    standardised = TOY_ADJ.with_columns((pl.col("x2") / sd_x).alias("x2"))
    direct = beta_row(
        adjusted_association(standardised, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION)
    )
    per_sd = next(
        r
        for r in adjusted_association(
            TOY_ADJ, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION
        ).to_pylist()
        if r["measure"] == "beta_per_sd"
    )
    assert per_sd["estimate"] == pytest.approx(direct["estimate"], rel=1e-12)
    assert per_sd["se"] == pytest.approx(direct["se"], rel=1e-12)


def test_reflecting_the_predictor_flips_the_coefficient_only() -> None:
    """The alignment transform (ADR-0015) reflects a descending item about
    its scale: the adjusted coefficient changes sign and nothing else —
    the SE, n and the fit's interval width are identical, so an adjusted
    association on aligned values is the same model read in the label's
    direction."""
    from flourish_stats.io import aligned_expr

    reflected = TOY_ADJ.with_columns(aligned_expr("x2", polarity="descending", lo=1, hi=9))
    for design in (TAYLOR, KISH):
        raw = {
            r["measure"]: r
            for r in adjusted_association(
                TOY_ADJ, "y", "x2", design, controls=["g"], policy=NO_SUPPRESSION
            ).to_pylist()
        }
        flipped = {
            r["measure"]: r
            for r in adjusted_association(
                reflected, "y", "x2", design, controls=["g"], policy=NO_SUPPRESSION
            ).to_pylist()
        }
        for measure in ("beta", "beta_per_sd"):
            assert flipped[measure]["estimate"] == pytest.approx(
                -raw[measure]["estimate"], rel=1e-10
            )
            assert flipped[measure]["se"] == pytest.approx(raw[measure]["se"], rel=1e-10)
            assert flipped[measure]["n"] == raw[measure]["n"]
    assert raw["beta"]["estimate"] > 0  # the toy runs upward as coded


def test_country_fixed_effect_is_dropped_when_grouped_by_country() -> None:
    # Two countries with their own strata; the pooled fit carries a country
    # dummy, the per-country fits (by=country_code) must not — each equals
    # the plain fit on that country's rows.
    other = TOY_ADJ.with_columns(
        (pl.col("strata") + 10).alias("strata"),
        (pl.col("psu") + 100).alias("psu"),
        (12 - pl.col("y")).alias("y"),  # the opposite slope, not a level shift
        pl.lit(2).alias("country_code"),
    )
    frame = pl.concat([TOY_ADJ.with_columns(pl.lit(1).alias("country_code")), other])
    controls = ["g", "country_code"]
    grouped = adjusted_association(
        frame, "y", "x2", TAYLOR, controls=controls, by=["country_code"], policy=NO_SUPPRESSION
    )
    rows = {r["country_code"]: r for r in beta_rows(grouped)}
    for code, part in ((1, TOY_ADJ), (2, other)):
        plain = beta_row(
            adjusted_association(part, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION)
        )
        assert rows[code]["estimate"] == pytest.approx(plain["estimate"], rel=1e-12)
        assert rows[code]["se"] == pytest.approx(plain["se"], rel=1e-12)
        assert rows[code]["n"] == 9
    pooled = beta_row(
        adjusted_association(frame, "y", "x2", TAYLOR, controls=controls, policy=NO_SUPPRESSION)
    )
    assert pooled["n"] == 18
    assert pooled["estimate"] != pytest.approx(rows[1]["estimate"], rel=1e-6)
    # And a control that is also the grouping column drops the same way.
    by_g = beta_rows(
        adjusted_association(
            TOY_ADJ, "y", "x2", TAYLOR, controls=["g"], by=["g"], policy=NO_SUPPRESSION
        )
    )
    # svyglm(y ~ x2, subset(des, g == 1)): 0.73015873015873 / 0.063794287242607
    # svyglm(y ~ x2, subset(des, g == 2)): 1.28415300546448 / 0.0246760195120965
    by_level = {r["g"]: r for r in by_g}
    assert by_level[1]["estimate"] == pytest.approx(0.73015873015873, rel=1e-12)
    assert by_level[1]["se"] == pytest.approx(0.063794287242607, rel=1e-9)
    assert by_level[2]["estimate"] == pytest.approx(1.28415300546448, rel=1e-12)
    assert by_level[2]["se"] == pytest.approx(0.0246760195120965, rel=1e-9)
    assert (by_level[1]["n"], by_level[2]["n"]) == (5, 4)


def test_rank_deficient_and_too_few_cases_return_nulls_with_n_intact() -> None:
    def check_null(table) -> None:
        for row in table.to_pylist():
            assert row["estimate"] is None and row["se"] is None
            assert row["ci_lo"] is None and row["ci_hi"] is None
            assert not row["suppressed"]

    constant = TOY_ADJ.with_columns(pl.lit(3).alias("x2"))
    for design in (TAYLOR, KISH):
        table = adjusted_association(
            constant, "y", "x2", design, controls=["g"], policy=NO_SUPPRESSION
        )
        check_null(table)
        assert beta_row(table)["n"] == 9
    # A control that reproduces the predictor exactly is aliased with it.
    aliased = TOY_ADJ.with_columns(pl.col("x2").alias("g"))
    check_null(
        adjusted_association(aliased, "y", "x2", TAYLOR, controls=["g"], policy=NO_SUPPRESSION)
    )
    # Three rows for three parameters: no residual degrees of freedom.
    tiny = TOY_ADJ.head(3)
    table = adjusted_association(tiny, "y", "x2", KISH, controls=["g"], policy=NO_SUPPRESSION)
    check_null(table)
    assert beta_row(table)["n"] == 3
    # A binary outcome that never varies has no finite log-odds.
    flat = TOY_ADJ.with_columns(pl.lit(1, dtype=pl.Int8).alias("yb"))
    check_null(
        adjusted_association(
            flat, "yb", "x2", TAYLOR, family="binomial", controls=["g"], policy=NO_SUPPRESSION
        )
    )
    # An empty group stays in the universe with n = 0.
    frame = TOY_ADJ.with_columns(
        pl.when(pl.col("g") == 2).then(None).otherwise(pl.col("y")).alias("y")
    )
    rows = {
        r["g"]: r
        for r in beta_rows(
            adjusted_association(
                frame, "y", "x2", TAYLOR, by=["g"], controls=[], policy=NO_SUPPRESSION
            )
        )
    }
    assert rows[2]["n"] == 0 and rows[2]["estimate"] is None
    assert rows[1]["n"] == 5 and rows[1]["estimate"] is not None


def test_kish_fallback_is_the_effective_sample_size_model_variance() -> None:
    # Unequal weights, no design columns: the SE is the model-based one
    # with the weights rescaled to sum to n_eff and n_eff − k residual
    # degrees of freedom — computed here independently with numpy.
    row = beta_row(
        adjusted_association(TOY_ADJ, "y", "x2", KISH, controls=["g"], policy=NO_SUPPRESSION)
    )
    assert row["se_method"] == "kish"
    w = TOY_ADJ["w"].to_numpy().astype(float)
    x = TOY_ADJ["x2"].to_numpy().astype(float)
    y = TOY_ADJ["y"].to_numpy().astype(float)
    g2 = (TOY_ADJ["g"].to_numpy() == 2).astype(float)
    xmat = np.column_stack([np.ones(9), x, g2])
    xtwx = xmat.T @ (xmat * w[:, None])
    beta = np.linalg.solve(xtwx, xmat.T @ (w * y))
    n_eff = w.sum() ** 2 / (w**2).sum()
    rss = (w * (y - xmat @ beta) ** 2).sum()
    se = math.sqrt(rss / (n_eff - 3) * np.linalg.inv(xtwx)[1, 1])
    assert row["estimate"] == pytest.approx(beta[1], rel=1e-12)
    assert row["se"] == pytest.approx(se, rel=1e-12)


def test_adjusted_validation_and_suppression() -> None:
    with pytest.raises(ValueError, match="family"):
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, family="poisson", controls=["g"])  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="different"):
        adjusted_association(TOY_ADJ, "y", "y", TAYLOR, controls=["g"])
    with pytest.raises(ValueError, match="also a control"):
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, controls=["x2"])
    with pytest.raises(ValueError, match="missing control columns"):
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, controls=["nope"])
    with pytest.raises(ValueError, match="0/1 outcome"):
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, family="binomial", controls=["g"])
    row = beta_row(
        adjusted_association(TOY_ADJ, "y", "x2", TAYLOR, controls=["g"])
    )  # default policy
    assert row["suppressed"] is True and row["estimate"] is None and row["n"] == 9
