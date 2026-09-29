"""Pooled correlations, precomputed when the API image is built (ADR-0020).

A pooled request ("All countries", ``pooled=population``) correlates
every country's people at once — about 208,000 rows at Wave 1 against a
single country's 3,000 to 38,000. On demand, Find related's pooled sweep
of some 100 questions took 1.2 s (straight-line) and 1.9 s (by rank) on
one local thread and peaked near 500 MB; Cloud Run's instance is one CPU
and 512 MiB, where a single country's sweep already takes about 2 s. So
the pooled correlation of every pair of questions Find related and
Compare several can ask for is computed once, from the staged data, when
the image is built (``infra/Dockerfile`` runs ``python -m
flourish_api.pooled``; locally, ``make pooled``), and served from memory.

The file holds, for each frame a pooled request can take (the wave, and
at the midyear survey the wave the other questions' answers come from)
and each method, every pair's unsuppressed estimate, n, sum of weights
and coverage mask, taken by the **same frames and the same estimator** as
the on-demand path (``assemble_matrix_frame``, ``weighted_correlations``,
``coverage_masks``); the serving policy is applied at serve time exactly
as ``finalize`` applies it. A file for another data build or another
population table is ignored, and a pooled request it does not cover —
a demographic domain, a breakdown — is estimated on demand, as are
Compare two's grids (two questions, one small frame).
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

from flourish_api.config import Settings
from flourish_api.data import DataStore, VariableInfo
from flourish_api.frames import assemble_matrix_frame, coverage_masks
from flourish_api.queries import (
    CORRELATION_METHODS,
    ORDERED_SCALE_TYPES,
    MatrixQuery,
    shares_answers,
)
from flourish_api.schemas import EstimateRow

#: Bumped whenever what the file holds changes shape or meaning.
FORMAT = 1
#: The Parquet key-value metadata key the file's facts ride under.
_META_KEY = "flourish_pooled"

#: The frames a pooled request can take: (wave, the other questions'
#: answer wave at the midyear survey — None elsewhere).
Config = tuple[str, str | None]
CONFIGS: tuple[Config, ...] = (("Y1", None), ("MY", None), ("Y2", None))


@dataclass(frozen=True)
class PooledPair:
    """One pair's pooled correlation, before the serving policy."""

    estimate: float | None
    n: int
    sum_w: float
    #: the countries with people behind it (bit ``code`` set, ADR-0020)
    mask: int


class _FrameEntry(TypedDict):
    wave: str
    other_wave: str | None
    weight: str
    n_frame: int
    n_valid: dict[str, int]


class _Facts(TypedDict):
    """What the file says about itself, beside its pairs."""

    format: int
    data_version: str | None
    #: country code (as text) → the adult population it was pooled with
    populations: dict[str, float]
    frames: list[_FrameEntry]


@dataclass(frozen=True)
class FrameFacts:
    """What a pooled response says about its frame: its eligible rows and,
    per question, how many of them answered."""

    n_frame: int
    n_valid: dict[str, int]


def universe(store: DataStore, config: Config) -> list[VariableInfo]:
    """Every question a pooled request at ``config`` can name: the servable
    ordered items asked at the wave, in the catalog's order."""
    assert store.catalog is not None
    wave, _ = config
    items: list[VariableInfo] = []
    for name in store.catalog.outcome_names:
        info = store.catalog.outcome(name)
        if info is not None and info.scale_type in ORDERED_SCALE_TYPES and wave in info.waves:
            items.append(info)
    return items


def compute(store: DataStore, only: Sequence[str] | None = None) -> tuple[pl.DataFrame, _Facts]:
    """Every pair's pooled correlation at every config and method (``only``:
    just the pairs among these questions — the tests' slice), with the
    file's facts."""
    records: list[dict[str, object]] = []
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
            }
        )
        for method in CORRELATION_METHODS:
            for index, a in enumerate(items[:-1]):
                later = [b.name for b in items[index + 1 :] if not shares_answers(a, b)]
                if not later:
                    continue
                table = weighted_correlations(
                    frame, a.name, later, design, method=method, policy=NO_SUPPRESSION
                )
                masks = coverage_masks(frame, a.name, later)
                for record in table.to_pylist():
                    b = str(record["predictor"])
                    records.append(
                        {
                            "wave": wave,
                            "other_wave": other,
                            "method": method,
                            "a": a.name,
                            "b": b,
                            "estimate": record["estimate"],
                            "n": record["n"],
                            "sum_w": record["sum_w"],
                            "mask": masks[((), b)],
                        }
                    )
    schema = {
        "wave": pl.Utf8,
        "other_wave": pl.Utf8,
        "method": pl.Utf8,
        "a": pl.Utf8,
        "b": pl.Utf8,
        "estimate": pl.Float64,
        "n": pl.Int64,
        "sum_w": pl.Float64,
        "mask": pl.Int64,
    }
    facts: _Facts = {
        "format": FORMAT,
        "data_version": store.data_version,
        "populations": {str(code): value for code, value in (store.populations or {}).items()},
        "frames": frames,
    }
    return pl.DataFrame(records, schema=schema), facts


def write(store: DataStore, path: Path, only: Sequence[str] | None = None) -> int:
    """Compute and write the file; returns how many pairs it holds."""
    pairs, facts = compute(store, only)
    path.parent.mkdir(parents=True, exist_ok=True)
    pairs.write_parquet(path, metadata={_META_KEY: json.dumps(facts)})
    return pairs.height


class PooledTable:
    """The precomputed pooled correlations, in memory, looked up by pair."""

    def __init__(
        self,
        pairs: dict[tuple[str, str | None, str], dict[tuple[str, str], PooledPair]],
        frames: dict[Config, FrameFacts],
    ) -> None:
        self._pairs = pairs
        self._frames = frames

    @classmethod
    def from_frame(cls, table: pl.DataFrame, facts: _Facts) -> PooledTable:
        pairs: dict[tuple[str, str | None, str], dict[tuple[str, str], PooledPair]] = {}
        for row in table.iter_rows(named=True):
            key = (str(row["wave"]), row["other_wave"], str(row["method"]))
            pairs.setdefault(key, {})[(str(row["a"]), str(row["b"]))] = PooledPair(
                estimate=row["estimate"],
                n=int(row["n"]),
                sum_w=float(row["sum_w"]),
                mask=int(row["mask"]),
            )
        frames = {
            (entry["wave"], entry["other_wave"]): FrameFacts(
                n_frame=entry["n_frame"], n_valid=dict(entry["n_valid"])
            )
            for entry in facts["frames"]
        }
        return cls(pairs, frames)

    def frame(self, config: Config) -> FrameFacts | None:
        return self._frames.get(config)

    def pair(self, config: Config, method: str, a: str, b: str) -> PooledPair | None:
        table = self._pairs.get((*config, method))
        if table is None:
            return None
        return table.get((a, b)) or table.get((b, a))

    def row(
        self,
        config: Config,
        method: str,
        a: str,
        b: str,
        *,
        weight: str,
        policy: SuppressionPolicy,
    ) -> EstimateRow | None:
        """The correlation of ``a`` with ``b`` as the estimator's record
        (``predictor`` = b), the serving policy applied as ``finalize``
        applies it; None when the file does not hold the pair."""
        pair = self.pair(config, method, a, b)
        if pair is None:
            return None
        suppressed = pair.n < policy.threshold
        return EstimateRow(
            group={},
            predictor=b,
            stat=f"{method}_r",
            estimate=None if suppressed else pair.estimate,
            se=None,
            ci_lo=None,
            ci_hi=None,
            ci_level=0.95,
            ci_method="none",
            n=pair.n,
            sum_w=pair.sum_w,
            n_psu=None,
            n_strata=None,
            df=None,
            se_method="none",
            weight=weight,
            suppressed=suppressed,
            flagged=not suppressed and pair.n < policy.flag_below,
            n_countries=pair.mask.bit_count(),
        )

    def mask(self, config: Config, method: str, a: str, b: str) -> int:
        pair = self.pair(config, method, a, b)
        return pair.mask if pair is not None else 0


def load(path: Path, store: DataStore) -> PooledTable | None:
    """The file, when it was made from this data build and population
    table; None otherwise (every pooled request is then estimated on
    demand)."""
    if not store.present or not path.exists():
        return None
    raw = pl.read_parquet_metadata(path).get(_META_KEY)
    if raw is None:
        return None
    facts = cast(_Facts, json.loads(raw))
    expected = {str(code): value for code, value in (store.populations or {}).items()}
    if (
        facts.get("format") != FORMAT
        or facts.get("data_version") != store.data_version
        or facts.get("populations") != expected
    ):
        print(f"flourish_api.pooled: {path} is for another build; ignored", file=sys.stderr)
        return None
    return PooledTable.from_frame(pl.read_parquet(path), facts)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Precompute the pooled correlations (ADR-0020).")
    parser.add_argument("--out", type=Path, help="where to write (default: FA_POOLED_PATH)")
    args = parser.parse_args(argv)
    settings = Settings()
    store = DataStore(settings)
    if not store.present:
        print(f"flourish_api.pooled: no data at {settings.data_path}; nothing to precompute")
        return 0
    out: Path = args.out or settings.pooled_file
    started = time.perf_counter()
    count = write(store, out)
    print(f"flourish_api.pooled: {count} pairs → {out} in {time.perf_counter() - started:.1f}s")
    store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
