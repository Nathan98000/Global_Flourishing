"""Manifest: checksums, versions and timings for reproducibility.

``data_version`` is ``gfs-w2my.<pipeline version>.<first 8 hex of the
global CSV's sha256>`` — it changes iff the input data or the pipeline
version changes, and Phase 3 displays it in the API and footer.

The DuckDB file is rebuilt on every run and its bytes are NOT stable
across runs (DuckDB storage is not byte-deterministic), so its sha256
identifies this build only; every Parquet/JSON output is byte-stable.
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from pathlib import Path
from typing import Any

import duckdb
import polars as pl

from . import __version__
from .columns import CODEBOOK_PDF, GLOBAL_CSV, US_CSV
from .util import read_timings, sha256_file


def _git_sha() -> str | None:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return completed.stdout.strip()


def _parquet_rows(path: Path) -> int:
    return int(pl.scan_parquet(path).select(pl.len()).collect().item())


def _file_entry(base: Path, path: Path, rows: int | None) -> dict[str, Any]:
    try:
        relative = str(path.resolve().relative_to(base))
    except ValueError:  # out-dir outside the repo (tests)
        relative = str(path)
    return {
        "path": relative,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "rows": rows,
    }


def run_manifest(raw_dir: Path, out_dir: Path) -> int:
    global_csv = raw_dir / GLOBAL_CSV
    if not global_csv.exists():
        print(f"manifest: missing {global_csv}", file=sys.stderr)
        return 1
    database = out_dir / "flourish.duckdb"
    if not database.exists():
        print(f"manifest: missing {database} (run derive first)", file=sys.stderr)
        return 1

    repo_root = out_dir.resolve().parent
    global_sha = sha256_file(global_csv)
    ingest_report_path = out_dir / "intermediate" / "ingest_report.json"
    ingest_report: dict[str, Any] = (
        json.loads(ingest_report_path.read_text()) if ingest_report_path.exists() else {}
    )

    inputs = [
        {
            **_file_entry(repo_root, global_csv, ingest_report.get("rows_global")),
            "sha256": global_sha,
        },
        _file_entry(repo_root, raw_dir / US_CSV, ingest_report.get("rows_us")),
        _file_entry(repo_root, raw_dir / CODEBOOK_PDF, None),
    ]

    outputs: list[dict[str, Any]] = []
    connection = duckdb.connect(str(database), read_only=True)
    try:
        row = connection.execute("SELECT count(*) FROM responses_long").fetchone()
        assert row is not None and isinstance(row[0], int)
        db_rows = row[0]
    finally:
        connection.close()
    for path in [
        out_dir / "catalog.json",
        out_dir / "catalog.schema.json",
        out_dir / "catalog_coverage.md",
        out_dir / "catalog" / "variables.parquet",
        out_dir / "catalog" / "value_labels.parquet",
        *sorted((out_dir / "parquet").glob("*.parquet")),
        out_dir / "validation_report.md",
    ]:
        rows = _parquet_rows(path) if path.suffix == ".parquet" else None
        outputs.append(_file_entry(repo_root, path, rows))
    outputs.append(_file_entry(repo_root, database, db_rows))

    manifest = {
        "data_version": f"gfs-w2my.{__version__}.{global_sha[:8]}",
        "pipeline_version": __version__,
        "git_sha": _git_sha(),
        "generated_at_utc": datetime.now(tz=UTC).isoformat(timespec="seconds"),
        "engine_versions": {
            "polars": pl.__version__,
            "duckdb": duckdb.__version__,
            "pyarrow": version("pyarrow"),
            "pandera": version("pandera"),
        },
        "stage_seconds": read_timings(out_dir),
        "inputs": inputs,
        "outputs": outputs,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"manifest: data_version {manifest['data_version']}")
    return 0
