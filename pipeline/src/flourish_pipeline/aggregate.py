"""The static-aggregate exporter (pipeline stage 6, proposal §5.2).

Precomputes the hot views as compact JSON under ``data/static/v1/`` —
**shape-identical to the API's response envelope** (ADR-0008), so the
Phase 4 front end never cares which tier answered. The API test suite
runs this exporter against its synthetic database and validates every
file with the API's own pydantic models, which is what keeps the two
tiers from drifting without a pipeline→API dependency.

Per servable outcome × available wave:

- the default stat (mean for numeric scales, proportions for categorical)
  by country — the Atlas view;
- the same stat by country × each demographic — the Breakdowns view;
- for 0–10 scales, the full distribution by country — the histograms.

Everything runs through ``flourish_stats`` with the weight resolved from
the wave→weight→eligibility table; suppression is the engine default.
Output bytes are deterministic (sorted keys, index sorted by path).
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import duckdb
import polars as pl
import pyarrow as pa
from flourish_stats import (
    DEFAULT_POLICY,
    Design,
    WeightSpec,
    eligibility_expr,
    resolve,
    weighted_distribution,
    weighted_mean,
    weighted_proportion,
)
from flourish_stats.io import analysis_frame, derived_frame
from flourish_stats.outcomes import DERIVED_OUTCOMES, DERIVED_WAVES, SERVABLE_SCALE_TYPES

#: The Breakdowns view's demographics (mirrors the API's allow-list).
DEMOGRAPHICS: tuple[str, ...] = (
    "age_band",
    "gender",
    "education_3",
    "employment",
    "marital_status",
    "urban_rural",
    "income_quintile",
)

MEAN_SCALE_TYPES = frozenset({"scale_0_10", "count"})
DISTRIBUTION_SCALE_TYPES = frozenset({"scale_0_10"})

_RESULT_FIELDS = (
    "stat",
    "estimate",
    "se",
    "ci_lo",
    "ci_hi",
    "ci_level",
    "ci_method",
    "n",
    "sum_w",
    "n_psu",
    "n_strata",
    "df",
    "se_method",
    "weight",
    "suppressed",
    "flagged",
)


@dataclass(frozen=True)
class StaticOutcome:
    name: str
    scale_type: str
    direction: str
    min: int | None
    max: int | None
    waves: tuple[str, ...]
    is_derived: bool


def servable_outcomes(con: duckdb.DuckDBPyConnection) -> list[StaticOutcome]:
    variables = pl.from_arrow(con.execute("FROM variables").arrow())
    assert isinstance(variables, pl.DataFrame)
    rows = variables.filter(
        pl.col("scale_type").is_in(sorted(SERVABLE_SCALE_TYPES))
        & ~pl.col("is_country_specific")
        & ~pl.col("restricted")
    )
    outcomes = [
        StaticOutcome(
            name=str(row["name"]),
            scale_type=str(row["scale_type"]),
            direction=str(row["direction"]),
            min=row["min"],
            max=row["max"],
            waves=tuple(row["waves_available"]),
            is_derived=False,
        )
        for row in rows.iter_rows(named=True)
    ]
    outcomes.extend(
        StaticOutcome(
            name=name,
            scale_type=derived.scale_type,
            direction=derived.direction,
            min=derived.min,
            max=derived.max,
            waves=DERIVED_WAVES,
            is_derived=True,
        )
        for name, derived in DERIVED_OUTCOMES.items()
    )
    return sorted(outcomes, key=lambda outcome: outcome.name)


def _frame(
    con: duckdb.DuckDBPyConnection,
    outcome: StaticOutcome,
    wave: str,
    spec: WeightSpec,
    extra: tuple[str, ...],
) -> pl.DataFrame:
    if outcome.is_derived:
        frame = derived_frame(con, DERIVED_OUTCOMES[outcome.name].column, wave)
        if frame["value"].dtype == pl.Boolean:
            frame = frame.with_columns(pl.col("value").cast(pl.Int8))
    else:
        frame = analysis_frame(con, outcome.name, wave)
    if extra:
        columns = pl.from_arrow(
            con.execute(f"SELECT id, {', '.join(extra)} FROM respondents").arrow()
        )
        assert isinstance(columns, pl.DataFrame)
        frame = frame.join(columns, on="id", how="left")
    return frame.filter(eligibility_expr(spec))


def _levels(outcome: StaticOutcome) -> list[int] | None:
    if outcome.min is None or outcome.max is None or outcome.max - outcome.min > 25:
        return None
    return list(range(outcome.min, outcome.max + 1))


def _rows(table: pa.Table, groups: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for record in table.to_pylist():
        row: dict[str, Any] = {"group": {name: record[name] for name in groups}}
        if "level" in record:
            row["level"] = record["level"]
        for field in _RESULT_FIELDS:
            row[field] = record[field]
        rows.append(row)
    return rows


def _envelope(
    data_version: str | None,
    outcome: StaticOutcome,
    stat: str,
    wave: str,
    spec: WeightSpec,
    frame: pl.DataFrame,
    groups: list[str],
    rows: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "meta": {
            "data_version": data_version,
            "outcome": outcome.name,
            "scale_type": outcome.scale_type,
            "direction": outcome.direction,
            "stat": stat,
            "waves": [wave],
            "scope": "global",
            "oriented": False,
            "weight_key": spec.key,
            "weight": spec.weight,
            "se_method": "taylor",
            "ci_level": 0.95,
            "suppression": {
                "threshold": DEFAULT_POLICY.threshold,
                "flag_below": DEFAULT_POLICY.flag_below,
            },
            "n_frame": frame.height,
            "n_valid": frame["value"].drop_nulls().len(),
            "by": groups,
            "filters": {},
        },
        "rows": rows,
    }


def export_static(
    db_path: Path,
    static_dir: Path,
    *,
    data_version: str | None,
    only: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Write every hot view; returns the index (also written to disk).

    ``only`` restricts to named outcomes — used by the CI contract test,
    which needs every view *shape* but not every outcome.
    """
    con = duckdb.connect(str(db_path), read_only=True)
    files: list[dict[str, Any]] = []
    started = time.perf_counter()
    try:
        outcomes = servable_outcomes(con)
        if only is not None:
            outcomes = [outcome for outcome in outcomes if outcome.name in only]
        for outcome in outcomes:
            default_stat = "mean" if outcome.scale_type in MEAN_SCALE_TYPES else "proportion"
            levels = _levels(outcome)
            for wave in outcome.waves:
                spec = resolve((wave,))
                design = Design(weight=spec.weight, strata="strata", psu="psu")
                base = _frame(con, outcome, wave, spec, DEMOGRAPHICS)
                views: list[tuple[str, str, list[str]]] = [
                    (default_stat, f"{default_stat}_by-country_code", ["country_code"])
                ]
                views.extend(
                    (default_stat, f"{default_stat}_by-country_code-{demo}", ["country_code", demo])
                    for demo in DEMOGRAPHICS
                )
                if outcome.scale_type in DISTRIBUTION_SCALE_TYPES:
                    views.append(("distribution", "distribution_by-country_code", ["country_code"]))
                for stat, stem, groups in views:
                    if stat == "mean":
                        table = weighted_mean(base, "value", design, by=groups)
                    elif stat == "proportion":
                        table = weighted_proportion(base, "value", design, by=groups, levels=levels)
                    else:
                        table = weighted_distribution(
                            base, "value", design, by=groups, levels=levels
                        )
                    envelope = _envelope(
                        data_version,
                        outcome,
                        stat,
                        wave,
                        spec,
                        base,
                        groups,
                        _rows(table, groups),
                    )
                    relative = Path("v1") / outcome.name / wave / f"{stem}.json"
                    target = static_dir / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(
                        json.dumps(envelope, sort_keys=True, separators=(",", ":")) + "\n"
                    )
                    files.append(
                        {
                            "path": relative.as_posix(),
                            "outcome": outcome.name,
                            "wave": wave,
                            "stat": stat,
                            "by": groups,
                            "rows": len(envelope["rows"]),
                        }
                    )
    finally:
        con.close()
    index: dict[str, Any] = {
        "data_version": data_version,
        "file_count": len(files),
        "files": sorted(files, key=lambda item: item["path"]),
    }
    (static_dir / "index.json").write_text(
        json.dumps(index, sort_keys=True, separators=(",", ":")) + "\n"
    )
    index["seconds"] = round(time.perf_counter() - started, 1)
    return index


def run_aggregate(raw_dir: Path, out_dir: Path) -> int:
    from .manifest import data_version_for

    db_path = out_dir / "flourish.duckdb"
    if not db_path.exists():
        print(f"aggregate: missing {db_path} (run derive first)", file=sys.stderr)
        return 1
    # This stage runs before `manifest`, so the version is derived the
    # same way the manifest will derive it (shared helper), not read from
    # a possibly stale manifest.json.
    data_version = data_version_for(raw_dir)
    if data_version is None:
        print(
            f"aggregate: raw files absent under {raw_dir}; static views will "
            f"carry data_version null",
            file=sys.stderr,
        )
    index = export_static(db_path, out_dir / "static", data_version=data_version)
    print(
        f"aggregate: {index['file_count']:,} static views under "
        f"{out_dir / 'static'} in {index['seconds']}s (data {data_version})"
    )
    return 0
