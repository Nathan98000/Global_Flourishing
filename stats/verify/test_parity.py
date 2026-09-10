"""R `survey` parity: the engine reproduces stats/verify/reference.json.

Marked ``built``: it needs the built data (to create or check the extract)
and is auto-skipped in CI. The committed reference embeds the extract's
sha256 and the data version it was computed from; if the extract on disk
disagrees, the test fails loudly instead of comparing against the wrong
data — re-run ``make parity`` after a data rebuild.

Tolerances (recorded here per statistic, as ADR-0006 documents):

- point estimates (means, proportions, changes): |Δ| ≤ 1e-9
- standard errors: relative Δ ≤ 1e-6
- quantiles: exact
- correlations: |Δ| ≤ 1e-9
- unweighted n: exact

``CASE_TOLERANCES`` may loosen a single case only together with a comment
explaining the mechanism (none needed for survey 4.5).
"""

import hashlib
import json
from pathlib import Path

import polars as pl
import pytest
from flourish_stats import (
    Design,
    SuppressionPolicy,
    get,
    paired_change,
    transition_matrix,
    validate_frame,
    weighted_correlation,
    weighted_mean,
    weighted_proportion,
    weighted_quantile,
)
from flourish_stats.weights import eligibility_expr

VERIFY_DIR = Path(__file__).resolve().parent
REPO_ROOT = VERIFY_DIR.parents[1]
EXTRACT_CSV = REPO_ROOT / "data" / "intermediate" / "verify_extract.csv"

REFERENCE = json.loads((VERIFY_DIR / "reference.json").read_text())
CASES = {case["id"]: case for case in REFERENCE["cases"]}

ESTIMATE_ABS = 1e-9
SE_REL = 1e-6
QUANTILE_ABS = 0.0
CORRELATION_ABS = 1e-9
#: id → {"estimate_abs" | "se_rel": value}; every entry needs a comment
#: explaining the mechanism (see ADR-0006). Empty against survey 4.5.
CASE_TOLERANCES: dict[str, dict[str, float]] = {}

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)

pytestmark = pytest.mark.built


@pytest.fixture(scope="module")
def extract() -> pl.DataFrame:
    if not EXTRACT_CSV.exists():
        pytest.importorskip("duckdb")
        import importlib.util

        spec = importlib.util.spec_from_file_location("verify_extract", VERIFY_DIR / "extract.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.main()
    sha = hashlib.sha256(EXTRACT_CSV.read_bytes()).hexdigest()
    if sha != REFERENCE["meta"]["extract_sha256"]:
        pytest.fail(
            f"verify_extract.csv sha256 {sha[:12]}… does not match the committed "
            f"reference ({REFERENCE['meta']['extract_sha256'][:12]}…). The data "
            f"version changed — regenerate the reference with `make parity` "
            f"(reference was built from data {REFERENCE['meta']['data_version']})."
        )
    return pl.read_csv(EXTRACT_CSV, null_values="NA").with_columns(
        pl.col("retained_y2").cast(pl.Boolean),
        pl.col("has_midyear").cast(pl.Boolean),
    )


def case_frame(extract: pl.DataFrame, case: dict) -> pl.DataFrame:
    """The eligible frame for one case — filter comes from the weight table."""
    spec = get(case["filter"])
    assert spec.weight == case["weight"], (case["id"], spec.weight, case["weight"])
    frame = extract.filter((pl.col("country_code") == case["country"]) & eligibility_expr(spec))
    validate_frame(frame, spec)
    return frame


def check_point(row: dict, expect: dict, *, estimate_abs: float, se_rel: float) -> None:
    assert row["n"] == expect["n"]
    assert row["estimate"] == pytest.approx(expect["estimate"], abs=estimate_abs)
    assert row["se"] == pytest.approx(expect["se"], rel=se_rel)


@pytest.mark.parametrize("case_id", sorted(CASES))
def test_parity(case_id: str, extract: pl.DataFrame) -> None:
    case = CASES[case_id]
    overrides = CASE_TOLERANCES.get(case_id, {})
    estimate_abs = overrides.get("estimate_abs", ESTIMATE_ABS)
    se_rel = overrides.get("se_rel", SE_REL)
    frame = case_frame(extract, case)
    design = Design(weight=case["weight"], strata="strata", psu="psu")

    if case["stat"] == "mean" and case["by"] is None:
        rows = weighted_mean(frame, case["var1"], design, policy=NO_SUPPRESSION).to_pylist()
        check_point(rows[0], case["expect"], estimate_abs=estimate_abs, se_rel=se_rel)
    elif case["stat"] == "mean":
        rows = weighted_mean(
            frame, case["var1"], design, by=[case["by"]], policy=NO_SUPPRESSION
        ).to_pylist()
        by_level = {row[case["by"]]: row for row in rows}
        for expect in case["expect"]["levels"]:
            check_point(by_level[expect["level"]], expect, estimate_abs=estimate_abs, se_rel=se_rel)
    elif case["stat"] == "proportion":
        rows = weighted_proportion(frame, case["var1"], design, policy=NO_SUPPRESSION).to_pylist()
        by_level = {row["level"]: row for row in rows}
        expected_levels = case["expect"]["levels"]
        assert set(by_level) == {expect["level"] for expect in expected_levels}
        for expect in expected_levels:
            check_point(by_level[expect["level"]], expect, estimate_abs=estimate_abs, se_rel=se_rel)
    elif case["stat"] == "quantile":
        rows = weighted_quantile(
            frame, case["var1"], design, p=(case["p"],), policy=NO_SUPPRESSION
        ).to_pylist()
        assert rows[0]["n"] == case["expect"]["n"]
        assert rows[0]["estimate"] == pytest.approx(case["expect"]["estimate"], abs=QUANTILE_ABS)
    elif case["stat"] == "change":
        rows = paired_change(
            frame, case["var1"], case["var2"], design, policy=NO_SUPPRESSION
        ).to_pylist()
        check_point(rows[0], case["expect"], estimate_abs=estimate_abs, se_rel=se_rel)
    elif case["stat"] == "correlation":
        rows = weighted_correlation(
            frame, case["var1"], case["var2"], design, policy=NO_SUPPRESSION
        ).to_pylist()
        assert rows[0]["n"] == case["expect"]["n"]
        assert rows[0]["estimate"] == pytest.approx(case["expect"]["estimate"], abs=CORRELATION_ABS)
    elif case["stat"] == "transition":
        rows = transition_matrix(
            frame, case["var1"], case["var2"], design, policy=NO_SUPPRESSION
        ).to_pylist()
        cells = {(row["measure"], row["from_level"], row["to_level"]): row for row in rows}
        for measure in ("joint", "conditional"):
            for expect in case["expect"][measure]:
                row = cells[(f"transition_{measure}", expect["from"], expect["to"])]
                check_point(row, expect, estimate_abs=estimate_abs, se_rel=se_rel)
    else:  # pragma: no cover - cases.csv is fixed
        pytest.fail(f"unknown stat {case['stat']!r}")


def test_reference_covers_thirty_cases(extract: pl.DataFrame) -> None:
    assert len(CASES) == 30
    assert extract.height == REFERENCE["meta"]["extract_rows"]
