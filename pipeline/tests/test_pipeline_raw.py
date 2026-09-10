"""End-to-end acceptance tests against the real raw files (marked ``raw``).

These mirror the validate stage: the same CheckResult list the stage
writes to ``data/validation_report.md`` must be all-pass, and the key
acceptance numbers are asserted here independently so a regression in the
check definitions themselves cannot hide one in the data.

They run against the repo's ``data/`` outputs; run ``make data`` first.
"""

from pathlib import Path

import pytest

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

pytestmark = [
    pytest.mark.raw,
    pytest.mark.skipif(
        not (DATA_DIR / "flourish.duckdb").exists(),
        reason="data/flourish.duckdb not built (run `make data`)",
    ),
]


@pytest.fixture(scope="module")
def checks() -> dict[str, tuple[bool, str, str]]:
    from flourish_pipeline.validate import run_checks

    return {r.name: (r.passed, r.observed, r.expected) for r in run_checks(DATA_DIR)}


def test_every_validation_check_passes(checks: dict[str, tuple[bool, str, str]]) -> None:
    failed = {name: rest for name, (ok, *rest) in checks.items() if not ok}
    assert not failed, f"failing checks: {failed}"


def test_the_acceptance_numbers_are_the_verified_facts(
    checks: dict[str, tuple[bool, str, str]],
) -> None:
    observed = {name: values[1] for name, values in checks.items()}
    assert observed["respondents rows"] == "207919"
    assert observed["US file rows"] == "38312"
    assert observed["retained at Wave 2"] == "128868"
    assert observed["midyear respondents"] == "131487"
    assert observed["midyear type 1 (separate)"] == "54358"
    assert observed["midyear type 2 (combined)"] == "77129"
    assert observed["strata"] == "411"
    assert observed["PSUs"] == "136781"
    assert observed["AGE keeps 99 as a valid top-code"] == "28"
    assert observed["AGE keeps 98 as a real age"] == "4"
    assert observed["US shared columns"] == "242"


def test_published_sfi_ranking_reproduced(checks: dict[str, tuple[bool, str, str]]) -> None:
    for name in (
        "SFI top five order",
        "SFI bottom three order",
        "SFI mean: Indonesia",
        "SFI mean: Japan",
        "SFI pooled mean (all respondents)",
        "SFI non-decreasing from 50-59 upward",
        "SFI age 80+",
    ):
        passed, observed, expected = checks[name]
        assert passed, f"{name}: observed {observed}, expected {expected}"


def test_validation_report_committed_and_all_pass() -> None:
    report = (DATA_DIR / "validation_report.md").read_text(encoding="utf-8")
    assert "FAIL" not in report
    assert "## Wave 1 SFI by country" in report
    assert "Retention and midyear coverage by country" in report


def test_run_is_under_the_performance_budget() -> None:
    from flourish_pipeline.util import read_timings

    timings = read_timings(DATA_DIR)
    assert timings, "no timings recorded; run `make data`"
    total = sum(timings.values())
    assert total < 300, f"pipeline took {total:.0f}s; budget is 300s"


def test_manifest_lists_inputs_and_outputs() -> None:
    import json

    manifest = json.loads((DATA_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["data_version"].startswith("gfs-w2my.")
    assert len(manifest["inputs"]) == 3
    output_paths = {entry["path"] for entry in manifest["outputs"]}
    assert "data/flourish.duckdb" in output_paths
    assert "data/parquet/responses_long.parquet" in output_paths
    assert all(len(entry["sha256"]) == 64 for entry in manifest["outputs"])
    long_rows = next(
        entry["rows"]
        for entry in manifest["outputs"]
        if entry["path"] == "data/parquet/responses_long.parquet"
    )
    assert long_rows == 33_295_632


def test_all_stages_end_to_end_into_a_fresh_out_dir(raw_dir: Path, tmp_path: Path) -> None:
    """`flourish-pipeline run` from scratch: every stage, fresh out-dir."""
    from flourish_pipeline.cli import main

    out_dir = tmp_path / "out"
    assert (
        main(
            [
                "run",
                "--raw-dir",
                str(raw_dir),
                "--out-dir",
                str(out_dir),
            ]
        )
        == 0
    )
    for artefact in (
        "catalog.json",
        "parquet/respondents.parquet",
        "parquet/responses_long.parquet",
        "parquet/derived.parquet",
        "parquet/coverage.parquet",
        "flourish.duckdb",
        "validation_report.md",
        "manifest.json",
    ):
        assert (out_dir / artefact).exists(), artefact
    report = (out_dir / "validation_report.md").read_text(encoding="utf-8")
    assert "FAIL" not in report

    # Stage-range semantics: re-running just validate+manifest succeeds on
    # the existing outputs (what `make data-validate` does).
    assert (
        main(
            [
                "run",
                "--from",
                "validate",
                "--raw-dir",
                str(raw_dir),
                "--out-dir",
                str(out_dir),
            ]
        )
        == 0
    )


@pytest.mark.raw
def test_draft_overrides_generator_writes_review_skeleton(raw_dir: Path, tmp_path: Path) -> None:
    from flourish_pipeline.cli import main

    draft = tmp_path / "draft.yaml"
    out_dir = tmp_path / "out"
    assert (
        main(
            [
                "codebook",
                "--raw-dir",
                str(raw_dir),
                "--out-dir",
                str(out_dir),
                "--draft-overrides",
                str(draft),
            ]
        )
        == 0
    )
    # every current entry is already curated, so the draft is empty
    assert "nothing missing" in draft.read_text(encoding="utf-8")


def test_responses_oriented_view_flips_lower_better() -> None:
    import duckdb

    connection = duckdb.connect(str(DATA_DIR / "flourish.duckdb"), read_only=True)
    try:
        row = connection.execute(
            """
            SELECT count(*) FROM responses_long r
            JOIN responses_oriented o
              ON o.id = r.id AND o.wave = r.wave AND o.variable = r.variable
            JOIN variables v ON v.name = r.variable
            WHERE v.direction = 'lower_better'
              AND r.value IS NOT NULL
              AND o.value != v."min" + v."max" - r.value
            """
        ).fetchone()
        assert row is not None and row[0] == 0
        flipped = connection.execute(
            "SELECT count(DISTINCT variable) FROM responses_long r "
            "JOIN variables v ON v.name = r.variable WHERE v.direction = 'lower_better'"
        ).fetchone()
        assert flipped is not None and flipped[0] > 0  # the view actually covers variables
    finally:
        connection.close()
