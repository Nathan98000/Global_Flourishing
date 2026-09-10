"""Property-based invariants (Hypothesis; CI profile set in conftest.py)."""

import math

import polars as pl
import pytest
from flourish_stats import (
    Design,
    SuppressionPolicy,
    kish_n_eff,
    suppress,
    weighted_mean,
    weighted_proportion,
)
from hypothesis import given
from hypothesis import strategies as st

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")
KISH = Design(weight="w")

# A grid keeps "equal weights" a meaningful event and avoids degenerate
# floating-point corner cases while still exercising real variation.
WEIGHTS = st.sampled_from([0.25, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0])
VALUES = st.integers(min_value=0, max_value=10)


@st.composite
def simple_samples(draw, min_rows: int = 2, max_rows: int = 30):
    n = draw(st.integers(min_rows, max_rows))
    return (
        draw(st.lists(VALUES, min_size=n, max_size=n)),
        draw(st.lists(WEIGHTS, min_size=n, max_size=n)),
    )


@st.composite
def designed_frames(draw):
    """A stratified frame: 2–4 strata, 1–3 PSUs each, 1–3 rows per PSU."""
    rows: dict[str, list[object]] = {"strata": [], "psu": [], "w": [], "y": []}
    n_strata = draw(st.integers(2, 4))
    for h in range(n_strata):
        for j in range(draw(st.integers(1, 3))):
            for _ in range(draw(st.integers(1, 3))):
                rows["strata"].append(h)
                rows["psu"].append(h * 10 + j)
                rows["w"].append(draw(WEIGHTS))
                rows["y"].append(draw(VALUES))
    return pl.DataFrame(rows)


def the_row(table):
    rows = table.to_pylist()
    assert len(rows) == 1
    return rows[0]


@given(values=st.lists(VALUES, min_size=2, max_size=30))
def test_unit_weights_reproduce_unweighted_mean_and_classical_se(values: list[int]) -> None:
    n = len(values)
    frame = pl.DataFrame({"strata": [1] * n, "psu": list(range(n)), "w": [1.0] * n, "y": values})
    mean = sum(values) / n
    s = math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))
    taylor = the_row(weighted_mean(frame, "y", TAYLOR, policy=NO_SUPPRESSION))
    kish = the_row(weighted_mean(frame, "y", KISH, policy=NO_SUPPRESSION))
    for row in (taylor, kish):
        assert row["estimate"] == pytest.approx(mean, abs=1e-12)
        assert row["se"] == pytest.approx(s / math.sqrt(n), abs=1e-12)


@given(sample=simple_samples(), constant=st.sampled_from([0.1, 0.5, 2.0, 7.5, 100.0]))
def test_weight_scaling_leaves_estimates_and_ses_unchanged(sample, constant: float) -> None:
    values, weights = sample
    n = len(values)
    frame = pl.DataFrame({"strata": [1] * n, "psu": list(range(n)), "w": weights, "y": values})
    scaled = frame.with_columns((pl.col("w") * constant).alias("w"))
    for design in (TAYLOR, KISH):
        base = the_row(weighted_mean(frame, "y", design, policy=NO_SUPPRESSION))
        after = the_row(weighted_mean(scaled, "y", design, policy=NO_SUPPRESSION))
        assert after["estimate"] == pytest.approx(base["estimate"], rel=1e-12)
        assert after["se"] == pytest.approx(base["se"], rel=1e-9, abs=1e-15)
    base_p = weighted_proportion(frame, "y", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    after_p = weighted_proportion(scaled, "y", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    for b, a in zip(base_p, after_p, strict=True):
        assert a["level"] == b["level"]
        assert a["estimate"] == pytest.approx(b["estimate"], rel=1e-12, abs=1e-15)


@given(frame=designed_frames())
def test_proportions_sum_to_one(frame: pl.DataFrame) -> None:
    rows = weighted_proportion(frame, "y", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    assert sum(r["estimate"] for r in rows) == pytest.approx(1.0, abs=1e-9)


@given(n=st.integers(0, 300), bigger=st.integers(0, 300))
def test_suppress_is_monotone_in_n(n: int, bigger: int) -> None:
    n, larger = sorted((n, bigger))
    s1, f1 = suppress(n)
    s2, f2 = suppress(larger)
    assert s2 <= s1  # growing a cell never suppresses it
    assert (s2 or f2) <= (s1 or f1)  # …and never re-flags a clean one


@given(frame=designed_frames(), data=st.data())
def test_domain_of_whole_strata_equals_subset_estimation(frame: pl.DataFrame, data) -> None:
    strata = sorted(frame["strata"].unique().to_list())
    chosen = data.draw(
        st.lists(st.sampled_from(strata), min_size=1, max_size=len(strata), unique=True)
    )
    flagged = frame.with_columns(pl.col("strata").is_in(chosen).alias("in_domain"))
    by_rows = weighted_mean(flagged, "y", TAYLOR, by=["in_domain"], policy=NO_SUPPRESSION)
    domain = next(r for r in by_rows.to_pylist() if r["in_domain"])
    subset = the_row(
        weighted_mean(flagged.filter(pl.col("in_domain")), "y", TAYLOR, policy=NO_SUPPRESSION)
    )
    assert domain["estimate"] == pytest.approx(subset["estimate"], rel=1e-12)
    assert domain["se"] == pytest.approx(subset["se"], rel=1e-9, abs=1e-15)
    assert (domain["n"], domain["df"]) == (subset["n"], subset["df"])


@given(sample=simple_samples())
def test_kish_n_eff_at_most_n_with_equality_iff_equal_weights(sample) -> None:
    _, weights = sample
    n_eff = kish_n_eff(weights)
    assert n_eff <= len(weights) + 1e-9
    if len(set(weights)) == 1:
        assert n_eff == pytest.approx(len(weights), rel=1e-12)
    else:
        assert n_eff < len(weights) - 1e-9


@st.composite
def paired_frames(draw):
    """A designed frame with two complete waves of the same 0–10 item."""
    frame = draw(designed_frames())
    n = frame.height
    return frame.with_columns(
        pl.Series("later", draw(st.lists(VALUES, min_size=n, max_size=n)))
    ).rename({"y": "earlier"})


@given(frame=paired_frames())
def test_paired_change_equals_difference_of_means(frame: pl.DataFrame) -> None:
    from flourish_stats import paired_change

    change = the_row(paired_change(frame, "earlier", "later", TAYLOR, policy=NO_SUPPRESSION))
    m_earlier = the_row(weighted_mean(frame, "earlier", TAYLOR, policy=NO_SUPPRESSION))
    m_later = the_row(weighted_mean(frame, "later", TAYLOR, policy=NO_SUPPRESSION))
    assert change["estimate"] == pytest.approx(
        m_later["estimate"] - m_earlier["estimate"], rel=1e-9, abs=1e-12
    )
    assert change["n"] == frame.height


@given(frame=paired_frames())
def test_transition_matrix_rows_sum_to_one(frame: pl.DataFrame) -> None:
    from flourish_stats import transition_matrix

    rows = transition_matrix(frame, "earlier", "later", TAYLOR, policy=NO_SUPPRESSION).to_pylist()
    joint = [r for r in rows if r["measure"] == "transition_joint"]
    assert sum(r["estimate"] for r in joint) == pytest.approx(1.0, abs=1e-9)
    conditional = [r for r in rows if r["measure"] == "transition_conditional"]
    from_levels = {r["from_level"] for r in conditional if r["n"] > 0}
    for level in from_levels:
        row_total = sum(r["estimate"] for r in conditional if r["from_level"] == level)
        assert row_total == pytest.approx(1.0, abs=1e-9)


@given(
    sample=simple_samples(min_rows=3),
    ys=st.lists(VALUES, min_size=3, max_size=30),
    scale=st.sampled_from([-3.0, -0.5, 0.25, 2.0, 10.0]),
    shift=st.sampled_from([-5.0, 0.0, 3.5]),
)
def test_pearson_affine_invariance(sample, ys: list[int], scale: float, shift: float) -> None:
    from flourish_stats import weighted_correlation

    xs, weights = sample
    n = min(len(xs), len(ys))
    frame = pl.DataFrame({"w": weights[:n], "x": xs[:n], "y": ys[:n]})
    transformed = frame.with_columns((pl.col("x") * scale + shift).alias("x"))
    base = the_row(weighted_correlation(frame, "x", "y", KISH, policy=NO_SUPPRESSION))
    after = the_row(weighted_correlation(transformed, "x", "y", KISH, policy=NO_SUPPRESSION))
    if base["estimate"] is None:
        assert after["estimate"] is None
    else:
        sign = 1.0 if scale > 0 else -1.0
        assert after["estimate"] == pytest.approx(sign * base["estimate"], rel=1e-9, abs=1e-12)


@given(sample=simple_samples(min_rows=3), ys=st.lists(VALUES, min_size=3, max_size=30))
def test_spearman_invariant_under_monotone_transforms(sample, ys: list[int]) -> None:
    from flourish_stats import weighted_correlation

    xs, weights = sample
    n = min(len(xs), len(ys))
    frame = pl.DataFrame({"w": weights[:n], "x": xs[:n], "y": ys[:n]})
    # x → x³ and y → 2^y are strictly increasing, so ranks are unchanged.
    transformed = frame.with_columns(
        pl.col("x").pow(3).alias("x"), pl.lit(2.0).pow(pl.col("y")).alias("y")
    )
    base = the_row(
        weighted_correlation(frame, "x", "y", KISH, method="spearman", policy=NO_SUPPRESSION)
    )
    after = the_row(
        weighted_correlation(transformed, "x", "y", KISH, method="spearman", policy=NO_SUPPRESSION)
    )
    if base["estimate"] is None:
        assert after["estimate"] is None
    else:
        assert after["estimate"] == pytest.approx(base["estimate"], rel=1e-9, abs=1e-12)
