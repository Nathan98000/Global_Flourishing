"""CLI tests: stage wiring, not-implemented stubs, and the real codebook run."""

import json
from pathlib import Path

import pytest
from flourish_pipeline.cli import STAGES, main


def test_stages_cover_proposal_sections() -> None:
    assert STAGES == (
        "codebook",
        "ingest",
        "reshape",
        "derive",
        "validate",
        "aggregate",
        "manifest",
    )


def test_no_command_is_an_error(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as excinfo:
        main([])
    assert excinfo.value.code == 2
    assert "command" in capsys.readouterr().err


@pytest.mark.parametrize("stage", ["ingest", "reshape", "derive", "validate", "manifest"])
def test_stages_fail_cleanly_without_inputs(
    stage: str, tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    assert main([stage, "--raw-dir", str(empty), "--out-dir", str(empty)]) == 1
    assert "missing" in capsys.readouterr().err


def test_aggregate_fails_cleanly_without_the_duckdb(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["aggregate", "--raw-dir", str(tmp_path), "--out-dir", str(tmp_path)]) == 1
    assert "missing" in capsys.readouterr().err


def test_run_fails_at_first_stage_missing_inputs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert (
        main(["run", "--from", "ingest", "--raw-dir", str(tmp_path), "--out-dir", str(tmp_path)])
        == 1
    )
    captured = capsys.readouterr()
    assert "missing" in captured.err
    assert "[ingest] FAILED" in captured.out


def test_run_rejects_reversed_range(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["run", "--from", "manifest", "--to", "codebook"]) == 2
    assert "after" in capsys.readouterr().err


def test_codebook_reports_missing_inputs(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert main(["codebook", "--raw-dir", str(tmp_path), "--out-dir", str(tmp_path)]) == 1
    assert "missing input" in capsys.readouterr().err


@pytest.mark.raw
def test_codebook_stage_writes_catalog(raw_dir: Path, tmp_path: Path) -> None:
    out_dir = tmp_path / "out"
    assert main(["codebook", "--raw-dir", str(raw_dir), "--out-dir", str(out_dir)]) == 0
    catalog = json.loads((out_dir / "catalog.json").read_text(encoding="utf-8"))
    assert len(catalog["variables"]) == 182
    assert (out_dir / "catalog.schema.json").exists()
    assert (out_dir / "catalog" / "variables.parquet").exists()
    assert (out_dir / "catalog" / "value_labels.parquet").exists()
    coverage = (out_dir / "catalog_coverage.md").read_text(encoding="utf-8")
    assert "(none)" in coverage


@pytest.mark.raw
def test_codebook_output_is_deterministic(raw_dir: Path, tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    assert main(["codebook", "--raw-dir", str(raw_dir), "--out-dir", str(first)]) == 0
    assert main(["codebook", "--raw-dir", str(raw_dir), "--out-dir", str(second)]) == 0
    for name in ("catalog.json", "catalog.schema.json"):
        assert (first / name).read_bytes() == (second / name).read_bytes()
    for name in ("variables.parquet", "value_labels.parquet"):
        assert (first / "catalog" / name).read_bytes() == (second / "catalog" / name).read_bytes()
