"""Structural validation of the committed R-parity fixture.

Runs in CI without any data: it checks that ``stats/verify/reference.json``
is well-formed and complete, so a broken regeneration cannot merge even
though the numeric parity test itself only runs where the data exists.
"""

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
VERIFY_DIR = REPO_ROOT / "stats" / "verify"

STATS = {"mean", "proportion", "quantile", "change", "correlation", "transition"}
FILTERS = {"y1", "y2", "my", "y1_y2", "my_y2"}


def load() -> dict:
    return json.loads((VERIFY_DIR / "reference.json").read_text())


def test_harness_files_are_present() -> None:
    """CI checks out tracked files only, so existence here proves the
    harness is committed — the repo-wide *.csv ignore once swallowed
    cases.csv silently."""
    for name in ("cases.csv", "extract.py", "reference.R", "reference.json", "test_parity.py"):
        assert (VERIFY_DIR / name).exists(), name
    header = (VERIFY_DIR / "cases.csv").read_text().splitlines()
    assert header[0] == "id,stat,country,filter,weight,var1,var2,by,p"
    assert len(header) == 31  # header + 30 cases


def test_meta_records_the_provenance() -> None:
    meta = load()["meta"]
    assert meta["survey_lonely_psu"] == "adjust"
    assert meta["survey_adjust_domain_lonely"] is True
    major, minor = (int(part) for part in meta["survey_version"].split(".")[:2])
    assert (major, minor) >= (4, 2), "survey >= 4.2 required (svyquantile qrule='math')"
    assert meta["r_version"].count(".") >= 1
    assert len(meta["extract_sha256"]) == 64
    assert int(meta["extract_rows"]) > 100_000
    assert meta["data_version"]


def test_thirty_well_formed_cases() -> None:
    reference = load()
    cases = reference["cases"]
    assert len(cases) == 30
    ids = [case["id"] for case in cases]
    assert len(set(ids)) == 30

    def finite(x: object) -> bool:
        return isinstance(x, int | float) and math.isfinite(x)

    def check_point(expect: dict, *, min_se: float = 0.0) -> None:
        # A domain can be a single respondent (Egypt has one gender-4 row),
        # in which case R legitimately reports SE 0 — so per-level expects
        # only require a finite non-negative SE.
        assert finite(expect["estimate"])
        assert isinstance(expect["n"], int) and expect["n"] > 0
        assert finite(expect["se"]) and expect["se"] >= min_se

    for case in cases:
        assert case["stat"] in STATS, case["id"]
        assert case["filter"] in FILTERS, case["id"]
        assert case["weight"].startswith("w_"), case["id"]
        assert isinstance(case["country"], int)
        expect = case["expect"]
        if case["stat"] == "mean" and case["by"] is not None:
            assert len(expect["levels"]) >= 2, case["id"]
            for level in expect["levels"]:
                check_point(level)
        elif case["stat"] in ("mean", "change"):
            check_point(expect, min_se=1e-12)
        elif case["stat"] == "proportion":
            levels = expect["levels"]
            assert len(levels) >= 2, case["id"]
            for level in levels:
                check_point(level)
            total = sum(level["estimate"] for level in levels)
            assert abs(total - 1.0) < 1e-9, case["id"]
        elif case["stat"] == "quantile":
            assert finite(expect["estimate"]) and expect["n"] > 0
            assert case["p"] is not None and 0 < case["p"] < 1
        elif case["stat"] == "correlation":
            assert -1 <= expect["estimate"] <= 1 and expect["n"] > 0
        elif case["stat"] == "transition":
            joint, conditional = expect["joint"], expect["conditional"]
            assert len(joint) == len(conditional)
            side = math.isqrt(len(joint))
            assert side * side == len(joint) and side >= 2, case["id"]
            assert abs(sum(cell["estimate"] for cell in joint) - 1.0) < 1e-9
            for cell in joint + conditional:
                assert finite(cell["estimate"]) and cell["estimate"] >= 0
                assert isinstance(cell["n"], int) and cell["n"] >= 0


def test_case_list_covers_the_required_designs() -> None:
    """The §2.5 coverage: self-representing, lonely-PSU and clustered
    countries, domains, both midyear-mode countries, every stat kind."""
    cases = load()["cases"]
    countries = {case["country"] for case in cases}
    assert {9, 3, 8, 4, 10, 22} <= countries  # Japan, Brazil, Israel, Egypt, Kenya, US
    stats = {case["stat"] for case in cases}
    assert stats == STATS
    filters = {case["filter"] for case in cases}
    assert filters == FILTERS
    my_y2 = [case for case in cases if case["filter"] == "my_y2"]
    assert {case["country"] for case in my_y2} == {10, 20}  # Kenya + mixed-mode UK
    assert any(case["by"] == "age_band" for case in cases)
    assert any(case["by"] == "gender" for case in cases)
    assert any(case["weight"] == "w_l1m2" for case in cases)
