"""Write the slim R-parity extract (data/intermediate/verify_extract.csv).

The extract carries exactly what the 30 parity cases (cases.csv) need:
design columns, weights, eligibility flags, two demographics and the ~10
items at their waves — for the 12 countries the cases touch. R's only
dependency stays ``survey``: no arrow, no jsonlite (a KEY=VALUE sidecar
carries the sha256 and data version for reference.R to embed).

Run from the repo root with the built data present:

    uv run python stats/verify/extract.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import duckdb
import polars as pl
from flourish_stats.io import analysis_frame, derived_frame

REPO_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = REPO_ROOT / "data" / "flourish.duckdb"
OUT_DIR = REPO_ROOT / "data" / "intermediate"
EXTRACT_CSV = OUT_DIR / "verify_extract.csv"
EXTRACT_META = OUT_DIR / "verify_extract.meta"

#: (variable, wave) pairs the cases read; sfi comes from `derived`.
ITEMS: tuple[tuple[str, str], ...] = (
    ("HAPPY", "Y1"),
    ("HAPPY", "Y2"),
    ("LIFE_SAT", "Y1"),
    ("MENTAL_HEALTH", "Y2"),
    ("MONEY", "MY"),
    ("GOOD_RELATION", "MY"),
    ("FOOD_INSECURE", "MY"),
    ("ATTEND_SVCS", "Y1"),
    ("ATTEND_SVCS", "Y2"),
    ("BELIEVE_GOD", "Y1"),
    ("WB_TODAY", "Y1"),
    ("SAT_RELATNSHP", "Y2"),
)
SFI_WAVES = ("Y1", "Y2")

#: Countries any case touches (codes; see data catalog `countries`).
COUNTRIES = (3, 4, 6, 8, 9, 10, 12, 13, 14, 20, 22, 24)

RESPONDENT_COLUMNS = (
    "country_code",
    "strata",
    "psu",
    "age_band",
    "gender",
    "retained_y2",
    "has_midyear",
    "midyear_type",
    "w_c1",
    "w_c2",
    "w_l2",
    "w_l1m",
    "w_l1m2",
)


def build_extract(con: duckdb.DuckDBPyConnection) -> pl.DataFrame:
    base = (
        analysis_frame(con, *ITEMS[0], columns=RESPONDENT_COLUMNS)
        .rename({"value": f"{ITEMS[0][0]}_{ITEMS[0][1]}"})
        .drop("nonresponse")
    )
    for variable, wave in ITEMS[1:]:
        piece = analysis_frame(con, variable, wave, columns=()).select(
            "id", pl.col("value").alias(f"{variable}_{wave}")
        )
        base = base.join(piece, on="id", how="left")
    for wave in SFI_WAVES:
        piece = derived_frame(con, "sfi", wave, columns=()).select(
            "id", pl.col("value").alias(f"sfi_{wave}")
        )
        base = base.join(piece, on="id", how="left")
    return (
        base.filter(pl.col("country_code").is_in(COUNTRIES))
        # Integer flags: R reads 0/1 columns without type guessing.
        .with_columns(
            pl.col("retained_y2").cast(pl.Int8),
            pl.col("has_midyear").cast(pl.Int8),
        )
        .sort("id")
    )


def data_version() -> str:
    manifest = json.loads((REPO_ROOT / "data" / "manifest.json").read_text())
    version = manifest.get("data_version", "unknown")
    assert isinstance(version, str)
    return version


def main() -> int:
    if not DB_PATH.exists():
        raise SystemExit(f"missing {DB_PATH} — run `make data` first (see data/README.md)")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        extract = build_extract(con)
    finally:
        con.close()
    extract.write_csv(EXTRACT_CSV, null_value="NA")
    sha = hashlib.sha256(EXTRACT_CSV.read_bytes()).hexdigest()
    EXTRACT_META.write_text(f"sha256={sha}\ndata_version={data_version()}\nrows={extract.height}\n")
    print(f"wrote {EXTRACT_CSV} ({extract.height:,} rows, sha256 {sha[:12]}…)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
