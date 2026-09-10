"""Reshape: typed wide frames → ``respondents`` + ``responses_long``.

- ``respondents`` — one row per ID: country, Wave 1 baseline demographics
  (cleaned: per-variable sentinel codes → null, real answers kept), all
  design fields and weights, and the US state file's 15 extra columns
  joined on ID (null outside the US).
- ``responses_long`` — (id, wave, variable, value, nonresponse) for every
  *suffixed substantive* column, demographics included. Blank cells (not
  asked / not present) are dropped; sentinel answers are kept with a null
  value and the non-response reason. GENDER/SELFID1/SELFID2 have no wave
  suffix and live only in ``respondents``.

Wave flags are trusted only as present/absent: ``WAVE_Y2`` is coded 2 and
``WAVE_MY`` 11 in the data despite the codebook's ``1``.
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import sys
from pathlib import Path

import polars as pl

from .catalog_io import (
    CatalogVariable,
    countries_frame,
    load_variables,
    nonresponse_frame,
)
from .codebook.model import WAVES
from .columns import base_name, wave_of
from .util import intermediate_dir

PARQUET_COMPRESSION = "zstd"


def clean(column: str, variable: CatalogVariable, alias: str) -> pl.Expr:
    """Null out this variable's sentinel codes, keeping real answers."""
    expr = pl.col(column)
    if variable.nonresponse:
        expr = expr.replace(dict.fromkeys(variable.nonresponse, None))
    return expr.alias(alias)


def build_respondents(
    wide: pl.LazyFrame,
    us_extra: pl.LazyFrame,
    variables: dict[str, CatalogVariable],
    countries: pl.DataFrame,
) -> pl.LazyFrame:
    v = variables
    frame = wide.select(
        pl.col("ID").alias("id"),
        pl.col("COUNTRY").alias("country_code"),
        clean("GENDER", v["GENDER"], "gender"),
        clean("AGE_Y1", v["AGE"], "age"),
        clean("EDUCATION_3_Y1", v["EDUCATION_3"], "education_3"),
        clean("EMPLOYMENT_Y1", v["EMPLOYMENT"], "employment"),
        clean("MARITAL_STATUS_Y1", v["MARITAL_STATUS"], "marital_status"),
        clean("URBAN_RURAL_Y1", v["URBAN_RURAL"], "urban_rural"),
        clean("INCOME_Y1", v["INCOME"], "income_code"),
        clean("REGION1_Y1", v["REGION1"], "region1"),
        clean("REGION2_Y1", v["REGION2"], "region2"),
        clean("REGION3_Y1", v["REGION3"], "region3"),
        clean("SELFID1", v["SELFID1"], "selfid1"),
        clean("SELFID2", v["SELFID2"], "selfid2"),
        pl.col("ANNUAL_WEIGHT_C1").alias("w_c1"),
        pl.col("ANNUAL_WEIGHT_C2").alias("w_c2"),
        pl.col("ANNUAL_WEIGHT_L2").alias("w_l2"),
        pl.col("ANNUAL_WEIGHT_R2").alias("w_r2"),
        pl.col("RETENTION_WEIGHT_L_1M").alias("w_l1m"),
        pl.col("RETENTION_WEIGHT_L_1M2").alias("w_l1m2"),
        pl.col("STRATA").alias("strata"),
        pl.col("PSU").alias("psu"),
        pl.col("WAVE_Y2").is_not_null().alias("retained_y2"),
        pl.col("WAVE_MY").is_not_null().alias("has_midyear"),
        pl.col("MIDYEAR_TYPE_MY").alias("midyear_type"),
        pl.col("FULL_PARTIAL_Y1").alias("full_partial_y1"),
        pl.col("FULL_PARTIAL_Y2").alias("full_partial_y2"),
        pl.col("FULL_PARTIAL_MY").alias("full_partial_my"),
        pl.col("MODE_RECRUIT").alias("mode_recruit"),
        pl.col("MODE_ANNUAL").alias("mode_annual"),
        pl.col("RECRUIT_TYPE").alias("recruit_type"),
        pl.col("DOI_RECRUIT_Y1").alias("doi_recruit_y1"),
        pl.col("DOI_ANNUAL_Y1").alias("doi_annual_y1"),
        pl.col("DOI_ANNUAL_Y2").alias("doi_annual_y2"),
        pl.col("DOI_MY").alias("doi_my"),
    )
    frame = frame.join(
        countries.lazy().select(
            pl.col("code").alias("country_code"), pl.col("name").alias("country_name")
        ),
        on="country_code",
        how="left",
    )
    us = us_extra.select(
        pl.col("ID").alias("id"),
        pl.col("STATE_FOR_ANALYSIS_Y1").alias("state"),
        pl.col("STATE_FOR_ANALYSIS_Y2").alias("state_y2"),
        pl.col("FIPS_Y1").alias("fips"),
        pl.col("FIPS_Y2").alias("fips_y2"),
        pl.col("ANNUAL_STATE_WEIGHT_C1").alias("w_state_c1"),
        pl.col("ANNUAL_STATE_WEIGHT_C2").alias("w_state_c2"),
        pl.col("ANNUAL_STATE_WEIGHT_L2").alias("w_state_l2"),
        pl.col("ANNUAL_STATE_WEIGHT_R2").alias("w_state_r2"),
        pl.col("ANNUAL_STATE_WEIGHT_ADJ_C2").alias("w_state_adj_c2"),
        pl.col("ANNUAL_STATE_WEIGHT_ADJ_L2").alias("w_state_adj_l2"),
        pl.col("ANNUAL_STATE_WEIGHT_ADJ_R2").alias("w_state_adj_r2"),
        pl.col("RETENTION_STATE_WEIGHT_L_1M").alias("w_state_l1m"),
        pl.col("RETENTION_STATE_WEIGHT_L_1M2").alias("w_state_l1m2"),
        pl.col("RETENTION_STATE_WEIGHT_ADJ_L_1M").alias("w_state_adj_l1m"),
        pl.col("RETENTION_STATE_WEIGHT_ADJ_L_1M2").alias("w_state_adj_l1m2"),
    )
    columns_first = frame.join(us, on="id", how="left")
    return columns_first.sort("id")


def long_columns(
    columns: list[str], variables: dict[str, CatalogVariable]
) -> dict[str, list[tuple[str, str]]]:
    """wave -> [(column, base)] for every suffixed substantive column."""
    plan: dict[str, list[tuple[str, str]]] = {wave: [] for wave in WAVES}
    for column in columns:
        wave = wave_of(column)
        if wave is None:
            continue
        variable = variables.get(base_name(column))
        if variable is None or not variable.is_substantive:
            continue
        plan[wave].append((column, base_name(column)))
    return plan


def build_responses_long(
    wide: pl.LazyFrame,
    variables: dict[str, CatalogVariable],
    columns: list[str],
) -> pl.LazyFrame:
    plan = long_columns(columns, variables)
    sentinels = nonresponse_frame(variables).lazy()
    parts: list[pl.LazyFrame] = []
    for wave in WAVES:
        selected = wide.select(
            pl.col("ID").alias("id"),
            *[pl.col(column).alias(base) for column, base in plan[wave]],
        )
        part = (
            selected.unpivot(index="id", variable_name="variable", value_name="raw")
            .filter(pl.col("raw").is_not_null())
            .with_columns(pl.lit(wave).alias("wave"))
        )
        parts.append(part)
    long = pl.concat(parts)
    long = long.join(
        sentinels, left_on=["variable", "raw"], right_on=["variable", "value"], how="left"
    )
    # Sorted on the full unique key so the parquet bytes are reproducible
    # run-to-run; variable-major order also matches the Phase 3 query
    # pattern (one variable × many respondents).
    return long.select(
        pl.col("id"),
        pl.col("wave"),
        pl.col("variable"),
        pl.when(pl.col("nonresponse").is_null()).then(pl.col("raw")).otherwise(None).alias("value"),
        pl.col("nonresponse"),
    ).sort(["variable", "wave", "id"])


def run_reshape(out_dir: Path) -> int:
    inter = intermediate_dir(out_dir)
    for required in (inter / "global_typed.parquet", inter / "us_extra.parquet"):
        if not required.exists():
            print(f"reshape: missing {required} (run ingest first)", file=sys.stderr)
            return 1
    variables = load_variables(out_dir)
    countries = countries_frame(out_dir)
    wide = pl.scan_parquet(inter / "global_typed.parquet")
    us_extra = pl.scan_parquet(inter / "us_extra.parquet")
    parquet_dir = out_dir / "parquet"
    parquet_dir.mkdir(parents=True, exist_ok=True)

    respondents = build_respondents(wide, us_extra, variables, countries).collect()
    respondents.write_parquet(parquet_dir / "respondents.parquet", compression=PARQUET_COMPRESSION)

    columns = pl.scan_parquet(inter / "global_typed.parquet").collect_schema().names()
    # In-memory engine: the streaming engine's row order is not reproducible
    # even under maintain_order, and byte-stable outputs matter more here
    # than the ~2 GB peak this saves.
    long = build_responses_long(wide, variables, columns).collect()
    long.write_parquet(parquet_dir / "responses_long.parquet", compression=PARQUET_COMPRESSION)

    # The catalog tables travel with the data tables so DuckDB assembly and
    # notebooks read one directory.
    for name in ("variables", "value_labels"):
        pl.read_parquet(out_dir / "catalog" / f"{name}.parquet").write_parquet(
            parquet_dir / f"{name}.parquet", compression=PARQUET_COMPRESSION
        )
    countries.write_parquet(parquet_dir / "countries.parquet", compression=PARQUET_COMPRESSION)

    print(
        f"reshape: {respondents.height:,} respondents, "
        f"{long.height:,} response rows "
        f"({long.filter(pl.col('nonresponse').is_not_null()).height:,} non-response)"
    )
    return 0
