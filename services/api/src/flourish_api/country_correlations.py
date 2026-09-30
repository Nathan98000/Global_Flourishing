"""Every country's correlations, precomputed when the API image is built (ADR-0020).

"All countries" (``pooled=average``) is the plain average of the
countries' own correlations, and Find related's and Compare two's
country-by-country views show each country's. On demand, Find related's
sweep of some 100 questions in all 23 countries takes seconds on one
local thread, and Cloud Run's instance is one CPU, where a single
country's sweep already takes about 2 s. So each country's correlation
of every pair of questions the views can ask for is computed once, from
the staged data, when the image is built (``infra/Dockerfile`` runs
``python -m flourish_api.country_correlations``; locally, ``make
country-correlations``), and served from memory.

The file holds, for each frame a correlation can take (the wave, and at
the midyear survey the wave the other questions' answers come from) and
each method, every pair's unsuppressed estimate, n and sum of weights in
each country with people behind it, taken by the **same frames and the
same estimator** as the on-demand path (``assemble_matrix_frame`` on
every country's rows, ``weighted_correlations`` by country); the serving
policy is applied at serve time exactly as ``finalize`` applies it. A
file for another data build is ignored, and a request it does not cover
— a demographic domain, a breakdown, a pair it does not hold — is
estimated on demand, as are Compare two's grids (two questions, one
small frame).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict, cast

import polars as pl
from flourish_stats import NO_SUPPRESSION, SuppressionPolicy, weighted_correlations
from flourish_stats.averaging import COUNTRY

from flourish_api.config import Settings
from flourish_api.data import DataStore, VariableInfo
from flourish_api.frames import assemble_matrix_frame
from flourish_api.queries import (
    CORRELATION_METHODS,
    ORDERED_SCALE_TYPES,
    MatrixQuery,
    shares_answers,
)

#: Bumped whenever what the file holds changes shape or meaning.
FORMAT = 1
#: The Parquet key-value metadata key the file's facts ride under.
_META_KEY = "flourish_country_correlations"

#: The frames a correlation can take: (wave, the other questions' answer
#: wave at the midyear survey — None elsewhere).
Config = tuple[str, str | None]
CONFIGS: tuple[Config, ...] = (("Y1", None), ("Y2", None), ("MY", "Y1"), ("MY", "Y2"))

#: The columns of a request's records: per predictor and country, the
#: estimate (null where the serving policy withholds it), n and Σw.
RECORD_SCHEMA: dict[str, type[pl.DataType] | pl.DataType] = {
    "predictor": pl.Utf8,
    COUNTRY: pl.Int64,
    "estimate": pl.Float64,
    "se": pl.Float64,
    "n": pl.Int64,
    "sum_w": pl.Float64,
}


class _FrameEntry(TypedDict):
    wave: str
    other_wave: str | None
    weight: str
    n_frame: int
    n_valid: dict[str, int]
    #: every country with rows in the frame, in order
    countries: list[int]
    #: the questions the file holds the pairs of
    questions: list[str]


class _Facts(TypedDict):
    """What the file says about itself, beside its pairs."""

    format: int
    data_version: str | None
    frames: list[_FrameEntry]


@dataclass(frozen=True)
class FrameFacts:
    """What a response from the file says about its frame: the weight, its
    eligible rows and, per question, how many of them answered; the
    frame's countries; and the questions the file holds."""

    weight: str
    n_frame: int
    n_valid: dict[str, int]
    countries: tuple[int, ...]
    questions: frozenset[str]


def universe(store: DataStore, config: Config) -> list[VariableInfo]:
    """Every question a correlation at ``config`` can name: the servable
    ordered items asked at the wave — at the midyear survey, its own
    questions and every question asked at the other wave — in the
    catalog's order."""
    assert store.catalog is not None
    wave, other = config
    items: list[VariableInfo] = []
    for name in store.catalog.outcome_names:
        info = store.catalog.outcome(name)
        if info is None or info.scale_type not in ORDERED_SCALE_TYPES:
            continue
        if wave in info.waves or (other is not None and other in info.waves):
            items.append(info)
    return items


def _from_arrow(table: object) -> pl.DataFrame:
    frame = pl.from_arrow(table)  # type: ignore[arg-type]
    assert isinstance(frame, pl.DataFrame)
    return frame


def compute(store: DataStore, only: Sequence[str] | None = None) -> tuple[pl.DataFrame, _Facts]:
    """Every pair's correlation in every country at every config and method
    (``only``: just the pairs among these questions — the tests' slice),
    with the file's facts. A country with nobody behind a pair holds no
    row for it."""
    parts: list[pl.DataFrame] = []
    frames: list[_FrameEntry] = []
    for config in CONFIGS:
        items = [info for info in universe(store, config) if only is None or info.name in set(only)]
        if len(items) < 2:
            continue
        wave, other = config
        query = MatrixQuery(
            variables=tuple(items),
            wave=wave,
            method="pearson",
            countries=(),
            filters=(),
            pooled=True,
            other_wave=other,
        )
        assembled = assemble_matrix_frame(store, query)
        frame, design = assembled.frame, assembled.design
        frames.append(
            {
                "wave": wave,
                "other_wave": other,
                "weight": assembled.spec.weight,
                "n_frame": frame.height,
                "n_valid": {info.name: frame[info.name].drop_nulls().len() for info in items},
                "countries": sorted(int(code) for code in frame[COUNTRY].unique().to_list()),
                "questions": [info.name for info in items],
            }
        )
        for method in CORRELATION_METHODS:
            for index, a in enumerate(items[:-1]):
                later = [b.name for b in items[index + 1 :] if not shares_answers(a, b)]
                if not later:
                    continue
                table = weighted_correlations(
                    frame, a.name, later, design, method=method, by=[COUNTRY], policy=NO_SUPPRESSION
                )
                parts.append(
                    _from_arrow(table)
                    .filter(pl.col("n") > 0)
                    .select(
                        pl.lit(wave).alias("wave"),
                        pl.lit(other, dtype=pl.Utf8).alias("other_wave"),
                        pl.lit(method).alias("method"),
                        pl.lit(a.name).alias("a"),
                        pl.col("predictor").alias("b"),
                        pl.col(COUNTRY).cast(pl.Int16),
                        pl.col("estimate").cast(pl.Float64),
                        pl.col("n").cast(pl.Int32),
                        pl.col("sum_w").cast(pl.Float64),
                    )
                )
    schema = {
        "wave": pl.Utf8,
        "other_wave": pl.Utf8,
        "method": pl.Utf8,
        "a": pl.Utf8,
        "b": pl.Utf8,
        COUNTRY: pl.Int16,
        "estimate": pl.Float64,
        "n": pl.Int32,
        "sum_w": pl.Float64,
    }
    facts: _Facts = {"format": FORMAT, "data_version": store.data_version, "frames": frames}
    pairs = pl.concat(parts) if parts else pl.DataFrame(schema=schema)
    return pairs, facts


def write(store: DataStore, path: Path, only: Sequence[str] | None = None) -> int:
    """Compute and write the file; returns how many (pair, country) rows it holds."""
    pairs, facts = compute(store, only)
    path.parent.mkdir(parents=True, exist_ok=True)
    pairs.write_parquet(path, metadata={_META_KEY: json.dumps(facts)})
    return pairs.height


class CountryCorrelations:
    """The precomputed correlations, in memory: per config and method, one
    frame of (a, b, country) rows, looked up by question."""

    def __init__(
        self,
        pairs: dict[tuple[str, str | None, str], pl.DataFrame],
        frames: dict[Config, FrameFacts],
    ) -> None:
        self._pairs = pairs
        self._frames = frames

    @classmethod
    def from_frame(cls, table: pl.DataFrame, facts: _Facts) -> CountryCorrelations:
        # The questions as categories: two small integer columns in place of
        # some 800,000 strings each.
        slim = table.with_columns(
            pl.col("a").cast(pl.Categorical), pl.col("b").cast(pl.Categorical)
        )
        pairs: dict[tuple[str, str | None, str], pl.DataFrame] = {}
        for key, part in slim.partition_by(
            ["wave", "other_wave", "method"], as_dict=True, maintain_order=True
        ).items():
            wave, other, method = cast(tuple[str, str | None, str], key)
            pairs[(wave, other, method)] = part.drop("wave", "other_wave", "method")
        frames = {
            (entry["wave"], entry["other_wave"]): FrameFacts(
                weight=entry["weight"],
                n_frame=entry["n_frame"],
                n_valid=dict(entry["n_valid"]),
                countries=tuple(entry["countries"]),
                questions=frozenset(entry["questions"]),
            )
            for entry in facts["frames"]
        }
        return cls(pairs, frames)

    def frame(self, config: Config) -> FrameFacts | None:
        return self._frames.get(config)

    def holds(self, config: Config, names: Sequence[str]) -> bool:
        """Whether the file holds every pair among ``names`` at ``config``."""
        facts = self._frames.get(config)
        return facts is not None and all(name in facts.questions for name in names)

    def records(
        self,
        config: Config,
        method: str,
        x: str,
        ys: Sequence[str],
        policy: SuppressionPolicy,
    ) -> pl.DataFrame:
        """``x``'s correlation with each of ``ys`` in each country with people
        behind it (``RECORD_SCHEMA``), the serving policy's suppression
        applied as ``finalize`` applies it; a pair the file does not hold
        (none, when the two share answers) has no rows."""
        table = self._pairs.get((*config, method))
        if table is None or not ys:
            return pl.DataFrame(schema=RECORD_SCHEMA)
        wanted = list(ys)
        values = [
            pl.col(COUNTRY).cast(pl.Int64),
            pl.when(pl.col("n") < policy.threshold)
            .then(None)
            .otherwise(pl.col("estimate"))
            .alias("estimate"),
            pl.lit(None, dtype=pl.Float64).alias("se"),
            pl.col("n").cast(pl.Int64),
            pl.col("sum_w"),
        ]
        forward = table.filter((pl.col("a") == x) & pl.col("b").is_in(wanted)).select(
            pl.col("b").cast(pl.Utf8).alias("predictor"), *values
        )
        backward = table.filter((pl.col("b") == x) & pl.col("a").is_in(wanted)).select(
            pl.col("a").cast(pl.Utf8).alias("predictor"), *values
        )
        return pl.concat([forward, backward])


def load(path: Path, store: DataStore) -> CountryCorrelations | None:
    """The file, when it was made from this data build; None otherwise
    (every request is then estimated on demand)."""
    if not store.present or not path.exists():
        return None
    raw = pl.read_parquet_metadata(path).get(_META_KEY)
    if raw is None:
        return None
    facts = cast(_Facts, json.loads(raw))
    if facts.get("format") != FORMAT or facts.get("data_version") != store.data_version:
        print(
            f"flourish_api.country_correlations: {path} is for another build; ignored",
            file=sys.stderr,
        )
        return None
    return CountryCorrelations.from_frame(pl.read_parquet(path), facts)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Precompute every country's correlations (ADR-0020)."
    )
    parser.add_argument(
        "--out", type=Path, help="where to write (default: FA_COUNTRY_CORRELATIONS_PATH)"
    )
    args = parser.parse_args(argv)
    settings = Settings()
    store = DataStore(settings)
    if not store.present:
        print(
            f"flourish_api.country_correlations: no data at {settings.data_path}; "
            "nothing to precompute"
        )
        return 0
    out: Path = args.out or settings.country_correlations_file
    started = time.perf_counter()
    count = write(store, out)
    print(
        f"flourish_api.country_correlations: {count} rows → {out} "
        f"in {time.perf_counter() - started:.1f}s"
    )
    store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
