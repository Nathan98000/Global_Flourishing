"""All countries as the plain average of the countries (ADR-0020).

Weights are normalised within each country, so no estimate is taken over
every country's people at once. "All countries" is instead the plain
mean of the countries' own estimates: every country counts the same,
whatever its size, and a country with no estimate — it did not ask the
question, or (a cross-tab's column) nobody there gave that answer —
drops out of that average. The mean is of the unrounded estimates, on
their own scale (a correlation is not Fisher-transformed first), so it
is exactly what a reader gets by averaging the countries' dots.

The countries are independent samples, so the mean of K estimates has
standard error √(Σ se_c²) / K, and the interval is the normal one every
estimator here takes (estimate ± z·se). An estimator that claims no
interval (a correlation) gives the average none either.

An average is shown whatever it covers; a *ranked list* of averages holds
only those covering at least half the release's countries
(:func:`ranking_min_countries`), so a question a few countries asked
cannot crowd a list that speaks for all of them.
"""

from __future__ import annotations

from collections.abc import Sequence
from statistics import NormalDist

import polars as pl

#: The column the countries are told apart by.
COUNTRY = "country_code"

#: What :func:`average_countries` returns per key, after the keys.
AVERAGE_COLUMNS = (
    "estimate",
    "se",
    "ci_lo",
    "ci_hi",
    "n",
    "sum_w",
    "n_countries",
    "n_largest",
    "countries",
)


def ranking_min_countries(total: int) -> int:
    """How many countries an average must cover to be ranked in an All
    countries list (ADR-0020): at least half of the release's ``total``,
    rounded up — 12 of 23. The owner's rule, for ranked lists only: an
    average a reader asks for by name is served whatever it covers."""
    return (total + 1) // 2


def average_countries(
    records: pl.DataFrame,
    keys: Sequence[str] = (),
    *,
    country: str = COUNTRY,
    ci_level: float = 0.95,
) -> pl.DataFrame:
    """The plain mean over countries of ``records``' estimates, per ``keys``.

    ``records`` holds one row per (key, country) with ``estimate``, ``se``
    (null where the estimator claims no interval), ``n`` and ``sum_w``.
    Rows with a null estimate drop out. Per key: ``estimate``, the mean of
    the countries' estimates; ``se`` = √(Σ se²) / K when every country in
    it has one, else null; ``ci_lo``/``ci_hi``, the normal interval;
    ``n`` and ``sum_w`` summed over the countries in it; ``n_countries``
    = K; ``n_largest``, the largest country's ``n`` (a rule about every
    country — "each rests on few people" — reads it); and ``countries``,
    their codes in order. A key no country has an estimate for is absent.
    """
    z = NormalDist().inv_cdf((1.0 + ci_level) / 2.0)
    kept = records.filter(pl.col("estimate").is_not_null())
    aggregations = [
        pl.col("estimate").mean().alias("estimate"),
        pl.col("se").pow(2).sum().alias("_se2"),
        pl.col("se").null_count().alias("_se_missing"),
        pl.col("n").sum().cast(pl.Int64).alias("n"),
        pl.col("sum_w").sum().cast(pl.Float64).alias("sum_w"),
        pl.len().cast(pl.Int64).alias("n_countries"),
        pl.col("n").max().cast(pl.Int64).alias("n_largest"),
        pl.col(country).sort().alias("countries"),
    ]
    # No keys: one average over every row (none when no row has an estimate).
    by = list(keys) or ["_all"]
    grouped = (
        (kept.with_columns(pl.lit(0).alias("_all")) if not keys else kept)
        .group_by(by, maintain_order=True)
        .agg(aggregations)
    )
    se = (
        pl.when(pl.col("_se_missing") == 0)
        .then(pl.col("_se2").sqrt() / pl.col("n_countries"))
        .otherwise(None)
        .cast(pl.Float64)
    )
    return (
        grouped.with_columns(se.alias("se"))
        .with_columns(
            (pl.col("estimate") - z * pl.col("se")).alias("ci_lo"),
            (pl.col("estimate") + z * pl.col("se")).alias("ci_hi"),
        )
        .select([*keys, *AVERAGE_COLUMNS])
    )
