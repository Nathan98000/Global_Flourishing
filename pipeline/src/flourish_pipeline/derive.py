"""Derive: SFI + domains, PHQ-2/GAD-2, age bands, income quintiles, midyear
priorities, the coverage table — then assemble ``data/flourish.duckdb``.

All derivations are pure functions over polars frames (unit-tested on
synthetic data). Scores are computed from ``responses_long`` — the
sentinel-cleaned single source of truth — via a pivot of just the needed
items, not from the raw wide file.

Coding facts the scores rest on (verified against the catalog):

- All 12 SFI items are 0–10 and higher-is-better *as coded* (including
  EXPENSES/WORRY_SAFETY, coded 0 = worry all the time … 10 = never
  worry), so the SFI is a plain mean with no re-orientation.
- The PHQ-2/GAD-2 items are coded 1 = Nearly every day … 4 = Not at all —
  the reverse of standard PHQ coding — so each item scores ``4 − code``
  (0–3), summed to 0–6, screen-positive at ≥ 3.
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import sys
from pathlib import Path

import duckdb
import polars as pl

SFI_DOMAINS: dict[str, tuple[str, str]] = {
    "happiness": ("HAPPY", "LIFE_SAT"),
    "health": ("PHYSICAL_HLTH", "MENTAL_HEALTH"),
    "meaning": ("WORTHWHILE", "LIFE_PURPOSE"),
    "character": ("PROMOTE_GOOD", "GIVE_UP"),
    "relationships": ("CONTENT", "SAT_RELATNSHP"),
    "financial": ("EXPENSES", "WORRY_SAFETY"),
}
SFI_ITEMS: tuple[str, ...] = tuple(item for pair in SFI_DOMAINS.values() for item in pair)
SFI_MIN_ITEMS = 10

PHQ2_ITEMS = ("DEPRESSED", "INTEREST")
GAD2_ITEMS = ("FEEL_ANXIOUS", "CONTROL_WORRY")
SCREEN_POSITIVE_AT = 3

PRIORITY_ITEMS = {"money": "MONEY", "relationships": "GOOD_RELATION", "meaning": "MEANINGFUL"}

AGE_BANDS: tuple[tuple[int, int, str], ...] = (
    (18, 24, "18-24"),
    (25, 29, "25-29"),
    (30, 39, "30-39"),
    (40, 49, "40-49"),
    (50, 59, "50-59"),
    (60, 69, "60-69"),
    (70, 79, "70-79"),
    (80, 999, "80+"),  # AGE is top-coded 99 = 99+, which lands here
)


def age_band_expr(age: pl.Expr) -> pl.Expr:
    expr: pl.Expr = pl.lit(None, dtype=pl.String)
    for low, high, label in reversed(AGE_BANDS):
        expr = pl.when(age.is_between(low, high)).then(pl.lit(label)).otherwise(expr)
    return expr


def sfi_scores(items: pl.LazyFrame) -> pl.LazyFrame:
    """id + the 12 item columns → sfi, sfi_n_items, six domain scores.

    A domain score needs both its items; the overall SFI needs ≥ 10 of 12
    non-missing items and is the mean of the *available* items.
    """
    item_columns = [pl.col(name) for name in SFI_ITEMS]
    n_items = pl.sum_horizontal(c.is_not_null() for c in item_columns)
    total = pl.sum_horizontal(c.fill_null(0) for c in item_columns)
    domain_exprs = [
        pl.when(pl.col(a).is_not_null() & pl.col(b).is_not_null())
        .then((pl.col(a) + pl.col(b)) / 2.0)
        .otherwise(None)
        .alias(f"sfi_{domain}")
        for domain, (a, b) in SFI_DOMAINS.items()
    ]
    return items.select(
        pl.col("id"),
        pl.when(n_items >= SFI_MIN_ITEMS).then(total / n_items).otherwise(None).alias("sfi"),
        n_items.cast(pl.Int8).alias("sfi_n_items"),
        *domain_exprs,
    )


def screener_scores(items: pl.LazyFrame, pair: tuple[str, str], prefix: str) -> pl.LazyFrame:
    """PHQ-2 / GAD-2: items coded 1..4 (4 = not at all) → 4 − code each, sum 0–6."""
    a, b = (pl.col(name) for name in pair)
    score = (
        pl.when(a.is_not_null() & b.is_not_null())
        .then((4 - a) + (4 - b))
        .otherwise(None)
        .cast(pl.Int8)
    )
    return items.select(
        pl.col("id"),
        score.alias(f"{prefix}_score"),
        (score >= SCREEN_POSITIVE_AT).alias(f"{prefix}_positive"),
    )


def midyear_priorities(items: pl.LazyFrame) -> pl.LazyFrame:
    """MONEY/GOOD_RELATION/MEANINGFUL importance (0–10) → the top priority.

    ``priority_top`` needs all three items; a shared maximum is "tie".
    ``money_minus_relationships`` needs just those two.
    """
    money, relation, meaning = (pl.col(c) for c in PRIORITY_ITEMS.values())
    complete = money.is_not_null() & relation.is_not_null() & meaning.is_not_null()
    top = pl.max_horizontal(money, relation, meaning)
    n_at_top = (
        (money == top).cast(pl.Int8)
        + (relation == top).cast(pl.Int8)
        + (meaning == top).cast(pl.Int8)
    )
    winner = (
        pl.when(n_at_top > 1)
        .then(pl.lit("tie"))
        .when(money == top)
        .then(pl.lit("money"))
        .when(relation == top)
        .then(pl.lit("relationships"))
        .otherwise(pl.lit("meaning"))
    )
    return items.select(
        pl.col("id"),
        pl.when(complete).then(winner).otherwise(None).alias("priority_top"),
        (money - relation).cast(pl.Int16).alias("money_minus_relationships"),
    )


def income_quintiles(respondents: pl.DataFrame) -> pl.DataFrame:
    """Within-country income quintile from the C1-weighted band distribution.

    Bands are coarse, so a band is assigned the quintile at the midpoint of
    its cumulative weight share (documented as approximate). ``income_band``
    is code % 100; INCOME's 9900 = no household income becomes band 0, at
    the bottom of the distribution.
    """
    banded = respondents.select(
        "id",
        "country_code",
        "w_c1",
        (pl.col("income_code") % 100).cast(pl.Int16).alias("income_band"),
    )
    shares = (
        banded.drop_nulls(["income_band"])
        .group_by("country_code", "income_band")
        .agg(pl.col("w_c1").sum().alias("band_weight"))
        .sort("country_code", "income_band")
        .with_columns(
            (pl.col("band_weight") / pl.col("band_weight").sum().over("country_code")).alias(
                "share"
            )
        )
        .with_columns(
            (pl.col("share").cum_sum().over("country_code") - pl.col("share") / 2).alias("midpoint")
        )
        .with_columns((pl.col("midpoint") * 5).floor().cast(pl.Int8).clip(0, 4).alias("quintile0"))
        .select(
            "country_code",
            "income_band",
            (pl.col("quintile0") + 1).alias("income_quintile"),
        )
    )
    return banded.join(shares, on=["country_code", "income_band"], how="left").select(
        "id", "income_band", "income_quintile"
    )


def pivot_items(long: pl.LazyFrame, wave: str, items: tuple[str, ...]) -> pl.LazyFrame:
    """responses_long → id + one column per item, for one wave."""
    subset = (
        long.filter((pl.col("wave") == wave) & pl.col("variable").is_in(items))
        .select("id", "variable", "value")
        .collect()
        .pivot(on="variable", index="id", values="value")
    )
    for item in items:  # a wave might lack an item entirely
        if item not in subset.columns:
            subset = subset.with_columns(pl.lit(None, dtype=pl.Int16).alias(item))
    return subset.lazy()


def build_derived(long: pl.LazyFrame, respondents: pl.LazyFrame) -> pl.DataFrame:
    parts: list[pl.DataFrame] = []
    annual_items = tuple(sorted({*SFI_ITEMS, *PHQ2_ITEMS, *GAD2_ITEMS}))
    for wave in ("Y1", "Y2"):
        present = respondents.filter(
            pl.col("retained_y2") if wave == "Y2" else pl.lit(True)
        ).select("id")
        items = present.join(pivot_items(long, wave, annual_items), on="id", how="left")
        combined = (
            sfi_scores(items)
            .join(screener_scores(items, PHQ2_ITEMS, "phq2"), on="id")
            .join(screener_scores(items, GAD2_ITEMS, "gad2"), on="id")
            .with_columns(
                pl.lit(wave).alias("wave"),
                pl.lit(None, dtype=pl.String).alias("priority_top"),
                pl.lit(None, dtype=pl.Int16).alias("money_minus_relationships"),
            )
        )
        parts.append(combined.collect())

    midyear_ids = respondents.filter(pl.col("has_midyear")).select("id")
    my_items = midyear_ids.join(
        pivot_items(long, "MY", tuple(PRIORITY_ITEMS.values())), on="id", how="left"
    )
    my = (
        midyear_priorities(my_items)
        .with_columns(
            pl.lit("MY").alias("wave"),
            pl.lit(None, dtype=pl.Float64).alias("sfi"),
            pl.lit(None, dtype=pl.Int8).alias("sfi_n_items"),
            *[pl.lit(None, dtype=pl.Float64).alias(f"sfi_{d}") for d in SFI_DOMAINS],
            pl.lit(None, dtype=pl.Int8).alias("phq2_score"),
            pl.lit(None, dtype=pl.Boolean).alias("phq2_positive"),
            pl.lit(None, dtype=pl.Int8).alias("gad2_score"),
            pl.lit(None, dtype=pl.Boolean).alias("gad2_positive"),
        )
        .collect()
    )

    order = [
        "id",
        "wave",
        "sfi",
        "sfi_n_items",
        *[f"sfi_{d}" for d in SFI_DOMAINS],
        "phq2_score",
        "phq2_positive",
        "gad2_score",
        "gad2_positive",
        "priority_top",
        "money_minus_relationships",
    ]
    frame = pl.concat([p.select(order) for p in [*parts, my]])
    wave_rank = pl.col("wave").replace_strict({"Y1": 0, "MY": 1, "Y2": 2}, return_dtype=pl.Int8)
    return frame.sort([wave_rank, pl.col("id")])


def build_coverage(long: pl.LazyFrame, respondents: pl.LazyFrame) -> pl.DataFrame:
    joined = long.join(respondents.select("id", "country_code"), on="id")
    return (
        joined.group_by("variable", "wave", "country_code")
        .agg(
            pl.len().cast(pl.Int32).alias("n_present"),
            pl.col("value").is_not_null().sum().cast(pl.Int32).alias("n_valid"),
            (pl.col("nonresponse") == "skipped").sum().cast(pl.Int32).alias("n_skipped"),
            (pl.col("nonresponse") == "dk").sum().cast(pl.Int32).alias("n_dk"),
            (pl.col("nonresponse") == "refused").sum().cast(pl.Int32).alias("n_refused"),
        )
        .sort("variable", "wave", "country_code")
        .collect(engine="streaming")
    )


TABLES = (
    "respondents",
    "responses_long",
    "derived",
    "coverage",
    "variables",
    "value_labels",
    "countries",
)


def build_duckdb(out_dir: Path) -> None:
    """data/parquet/*.parquet → one DuckDB file + the oriented view."""
    db_path = out_dir / "flourish.duckdb"
    db_path.unlink(missing_ok=True)
    connection = duckdb.connect(str(db_path))
    try:
        for table in TABLES:
            parquet = out_dir / "parquet" / f"{table}.parquet"
            connection.execute(f"CREATE TABLE {table} AS FROM read_parquet('{parquet.as_posix()}')")
        # Flips lower-is-better items so that higher always means better,
        # without materialising a second copy of 35M rows.
        connection.execute(
            """
            CREATE VIEW responses_oriented AS
            SELECT r.id, r.wave, r.variable,
                   CASE WHEN v.direction = 'lower_better'
                        THEN v."min" + v."max" - r.value
                        ELSE r.value END AS value,
                   r.nonresponse
            FROM responses_long r
            JOIN variables v ON v.name = r.variable
            """
        )
    finally:
        connection.close()


def run_derive(out_dir: Path) -> int:
    parquet_dir = out_dir / "parquet"
    for required in (parquet_dir / "respondents.parquet", parquet_dir / "responses_long.parquet"):
        if not required.exists():
            print(f"derive: missing {required} (run reshape first)", file=sys.stderr)
            return 1
    long = pl.scan_parquet(parquet_dir / "responses_long.parquet")
    respondents = pl.read_parquet(parquet_dir / "respondents.parquet")

    quintiles = income_quintiles(respondents)
    respondents = (
        respondents.join(quintiles, on="id", how="left")
        .with_columns(age_band_expr(pl.col("age")).alias("age_band"))
        .sort("id")
    )
    respondents.write_parquet(parquet_dir / "respondents.parquet", compression="zstd")

    derived = build_derived(long, respondents.lazy())
    derived.write_parquet(parquet_dir / "derived.parquet", compression="zstd")

    coverage = build_coverage(long, respondents.lazy())
    coverage.write_parquet(parquet_dir / "coverage.parquet", compression="zstd")

    build_duckdb(out_dir)
    print(
        f"derive: {derived.height:,} derived rows "
        f"({derived.filter(pl.col('sfi').is_not_null()).height:,} with SFI), "
        f"{coverage.height:,} coverage rows; DuckDB written"
    )
    return 0
