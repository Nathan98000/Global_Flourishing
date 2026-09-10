"""Ingest: raw CSVs → typed intermediate Parquet.

Everything is read as **strings first** (``infer_schema=False``) and cast
per the catalog — the only way the blank-a-single-space convention and the
zero-padded FIPS strings survive. Blanks (``" "`` or ``""``) become null.
Sentinel codes are NOT nulled here; that happens per-variable downstream
where the non-response reason is kept.

The stage also proves the structural facts later stages rely on and
records them in ``intermediate/ingest_report.json``:

- exact shapes (207,919 × 253 and 38,312 × 257),
- every US ``ID`` exists in the global file and the US rows are exactly
  ``COUNTRY = 22``,
- the 242 shared columns are cell-for-cell identical after blank
  normalisation (so the US file contributes only its 15 extra columns).
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
import sys
from pathlib import Path

import polars as pl

from .catalog_io import CatalogVariable, load_variables
from .columns import GLOBAL_CSV, US_CSV, base_name
from .util import intermediate_dir

EXPECTED_GLOBAL_SHAPE = (207_919, 253)
EXPECTED_US_SHAPE = (38_312, 257)
US_COUNTRY_CODE = 22
DATE_FORMAT = "%m/%d/%Y"  # e.g. 2/24/2023

# Design variables that are not Int16-coded.
_WIDE_DTYPES: dict[str, pl.DataType] = {
    "ID": pl.Int64(),
    "STRATA": pl.Int32(),
    "PSU": pl.Int64(),
}

# "Every value is an integer code" has exactly one exception in the whole
# release: a single DRINKS_Y2 cell of "4.5" in the global file. It is
# floored (4 completed drinks) rather than rejected; any OTHER fractional
# cell, now or in a future release, still fails the strict cast loudly.
KNOWN_FRACTIONAL_CELLS: dict[str, int] = {"DRINKS_Y2": 1}


class IngestError(RuntimeError):
    """The raw files do not look like the Wave 2 release."""


def read_raw(path: Path) -> pl.DataFrame:
    """The whole file as strings, with blank cells (a single space) as null."""
    frame = pl.read_csv(path, infer_schema=False)
    return frame.with_columns(pl.all().str.strip_chars().replace({"": None}))


def _target_dtype(column: str, variable: CatalogVariable) -> pl.DataType | None:
    if column in _WIDE_DTYPES:
        return _WIDE_DTYPES[column]
    match variable.scale_type:
        case "weight":
            return pl.Float64()
        case "string":
            return None  # FIPS / STATE_FOR_ANALYSIS keep their leading zeros
        case "date":
            return pl.Date()
        case "id":
            return pl.Int64()
        case _:
            return pl.Int16()


def typed_columns(columns: list[str], variables: dict[str, CatalogVariable]) -> list[pl.Expr]:
    expressions: list[pl.Expr] = []
    for column in columns:
        variable = variables.get(base_name(column))
        if variable is None:
            raise IngestError(f"column {column} is not in the catalog; rerun codebook")
        dtype = _target_dtype(column, variable)
        if dtype is None:
            expressions.append(pl.col(column))
        elif isinstance(dtype, pl.Date):
            expressions.append(pl.col(column).str.strptime(pl.Date, DATE_FORMAT))
        elif column in KNOWN_FRACTIONAL_CELLS:
            expressions.append(pl.col(column).cast(pl.Float64).floor().cast(dtype))
        else:
            expressions.append(pl.col(column).cast(dtype))
    return expressions


def check_known_fractional(frame: pl.DataFrame) -> None:
    """The floor() escape hatch stays exactly as narrow as documented."""
    for column, expected in KNOWN_FRACTIONAL_CELLS.items():
        values = frame[column].cast(pl.Float64)
        fractional = int((values != values.floor()).sum())
        if fractional != expected:
            raise IngestError(
                f"{column}: {fractional} fractional cells, expected exactly {expected} "
                "(update KNOWN_FRACTIONAL_CELLS only after checking the data)"
            )


def compare_shared_columns(global_us_rows: pl.DataFrame, us: pl.DataFrame) -> tuple[int, list[str]]:
    """(number of shared columns, columns with any differing cell)."""
    shared = [c for c in global_us_rows.columns if c in us.columns]
    left = global_us_rows.sort("ID").select(shared)
    right = us.sort("ID").select(shared)
    differing = [column for column in shared if left[column].ne_missing(right[column]).any()]
    return len(shared), differing


def run_ingest(raw_dir: Path, out_dir: Path) -> int:
    global_path = raw_dir / GLOBAL_CSV
    us_path = raw_dir / US_CSV
    for required in (global_path, us_path, out_dir / "catalog.json"):
        if not required.exists():
            print(f"ingest: missing {required} (run codebook first?)", file=sys.stderr)
            return 1
    variables = load_variables(out_dir)

    global_raw = read_raw(global_path)
    us_raw = read_raw(us_path)
    try:
        if global_raw.shape != EXPECTED_GLOBAL_SHAPE:
            raise IngestError(f"global file shape {global_raw.shape} != {EXPECTED_GLOBAL_SHAPE}")
        if us_raw.shape != EXPECTED_US_SHAPE:
            raise IngestError(f"US file shape {us_raw.shape} != {EXPECTED_US_SHAPE}")

        global_us_rows = global_raw.filter(pl.col("COUNTRY").cast(pl.Int16) == US_COUNTRY_CODE)
        us_ids = set(us_raw["ID"].to_list())
        global_ids = set(global_raw["ID"].to_list())
        missing = us_ids - global_ids
        if missing:
            raise IngestError(f"{len(missing)} US IDs are not in the global file")
        if set(global_us_rows["ID"].to_list()) != us_ids:
            raise IngestError("US file rows are not exactly the global COUNTRY=22 rows")

        shared_count, differing = compare_shared_columns(global_us_rows, us_raw)
        if differing:
            raise IngestError(
                f"US file differs from global file on shared columns: {differing[:5]}"
            )
        check_known_fractional(global_raw)
    except IngestError as error:
        print(f"ingest: {error}", file=sys.stderr)
        return 1

    inter = intermediate_dir(out_dir)
    global_typed = global_raw.select(typed_columns(global_raw.columns, variables))
    global_typed.write_parquet(inter / "global_typed.parquet", compression="zstd")

    us_extra_columns = ["ID", *[c for c in us_raw.columns if c not in global_raw.columns]]
    us_extra = us_raw.select(us_extra_columns).select(typed_columns(us_extra_columns, variables))
    us_extra.write_parquet(inter / "us_extra.parquet", compression="zstd")

    report = {
        "rows_global": global_raw.height,
        "rows_us": us_raw.height,
        "us_ids_missing_from_global": 0,
        "us_rows_equal_country_22": True,
        "shared_columns": shared_count,
        "shared_columns_differing": 0,
        "us_extra_columns": len(us_extra_columns) - 1,
    }
    (inter / "ingest_report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(
        f"ingest: {global_raw.height:,} global rows, {us_raw.height:,} US rows; "
        f"{shared_count} shared columns identical; "
        f"{len(us_extra_columns) - 1} US-only columns kept"
    )
    return 0
