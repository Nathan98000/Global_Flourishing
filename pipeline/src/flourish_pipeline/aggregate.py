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
- for 0–10 scales, the full distribution by country — the histograms
  (a continuous derived score binned by ``flourish_stats.outcomes.
  score_bins``, the API's rule too).

Plus the catalog tier (Phase 4): ``meta.json`` (the ``/v1/meta`` payload
minus ``git_sha``), ``variables.json`` (the ``/v1/variables`` listing) and
``v1/<name>/variable.json`` (each ``/v1/variables/{name}`` detail), so
the app boots — countries, labels, wording, breakdown labels and all —
without the API ever answering.

Everything runs through ``flourish_stats`` with the weight resolved from
the wave→weight→eligibility table; the serving policy is
``NO_SUPPRESSION`` (ADR-0011: every cell is shown — pass a policy to
bake the 50/100 rule back in). Output bytes are deterministic (sorted
keys, index sorted by path).
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
    NO_SUPPRESSION,
    Design,
    SuppressionPolicy,
    WeightSpec,
    eligibility_expr,
    resolve,
    weight_table_json,
    weighted_distribution,
    weighted_mean,
    weighted_proportion,
)
from flourish_stats.breakdowns import BREAKDOWN_LEVELS, breakdown_labels
from flourish_stats.io import analysis_frame, binned_expr, derived_frame
from flourish_stats.outcomes import (
    DERIVED_OUTCOMES,
    DERIVED_WAVES,
    DISTRIBUTION_SCALE_TYPES,
    NON_SUBSTANTIVE_SCALE_TYPES,
    SERVABLE_SCALE_TYPES,
    default_stat,
    score_bins,
)
from flourish_stats.states import state_labels

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

#: The wave vocabulary (asserted equal to the API's in its contract test).
WAVES: tuple[str, ...] = ("Y1", "MY", "Y2")

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
    policy: SuppressionPolicy,
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
                "threshold": policy.threshold,
                "flag_below": policy.flag_below,
            },
            "n_frame": frame.height,
            "n_valid": frame["value"].drop_nulls().len(),
            "by": groups,
            "filters": {},
        },
        "rows": rows,
    }


def _write_json(target: Path, payload: dict[str, Any]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n")


def _catalog_table(con: duckdb.DuckDBPyConnection, name: str) -> pl.DataFrame:
    frame = pl.from_arrow(con.execute(f"FROM {name}").arrow())
    assert isinstance(frame, pl.DataFrame)
    return frame


def _component_payload(
    name: str, variables: pl.DataFrame, value_labels: pl.DataFrame
) -> dict[str, Any]:
    """One question a derived score is built from — field for field the
    API's ComponentModel (a component missing from this build's catalog
    still appears by name, exactly as the route behaves)."""
    rows = variables.filter(pl.col("name") == name)
    if rows.height == 0:
        return {"name": name, "display_name": name, "wording": None, "value_labels": []}
    row = rows.row(0, named=True)
    return {
        "name": name,
        "display_name": str(row["display_name"]),
        "wording": None if row["wording"] is None else str(row["wording"]),
        "value_labels": [
            {
                "code": int(label["code"]),
                "label": str(label["label"]),
                "wave": label["wave"],
                "country_code": label["country_code"],
                "is_nonresponse": bool(label["is_nonresponse"]),
            }
            for label in value_labels.filter(pl.col("variable") == name)
            .sort("code", "country_code", "wave", nulls_last=True)
            .iter_rows(named=True)
        ],
    }


def _summary_payload(row: dict[str, Any], servable: bool) -> dict[str, Any]:
    """One /v1/variables summary, field for field (the contract test
    compares this against the live route on the synthetic database)."""
    return {
        "name": str(row["name"]),
        "display_name": str(row["display_name"]),
        "label": None if row["label"] is None else str(row["label"]),
        "wording": None if row["wording"] is None else str(row["wording"]),
        "family": str(row["family"]),
        "scale_type": str(row["scale_type"]),
        "direction": str(row["direction"]),
        "polarity": str(row.get("polarity") or "ascending"),
        "min": row["min"],
        "max": row["max"],
        "waves_available": list(row["waves_available"]),
        "is_country_specific": bool(row["is_country_specific"]),
        "is_derived": False,
        "servable": servable,
        "default_stat": default_stat(str(row["scale_type"])),
    }


def _derived_summary_payload(name: str) -> dict[str, Any]:
    derived = DERIVED_OUTCOMES[name]
    return {
        "name": name,
        "display_name": derived.display_name,
        "label": derived.description,
        "wording": None,
        "family": "derived",
        "scale_type": derived.scale_type,
        "direction": derived.direction,
        "polarity": "ascending",
        "min": derived.min,
        "max": derived.max,
        "waves_available": list(DERIVED_WAVES),
        "is_country_specific": False,
        "is_derived": True,
        "servable": True,
        "default_stat": default_stat(derived.scale_type),
    }


def export_catalog(
    con: duckdb.DuckDBPyConnection,
    static_dir: Path,
    data_version: str | None,
    files: list[dict[str, Any]],
    policy: SuppressionPolicy = NO_SUPPRESSION,
) -> None:
    """Write meta.json, variables.json and every v1/<name>/variable.json.

    Small, estimation-free files; always complete (``only`` never trims
    them) so the app can boot and search the codebook from the static
    tier alone.
    """
    variables = _catalog_table(con, "variables")
    value_labels = _catalog_table(con, "value_labels")
    countries = _catalog_table(con, "countries")
    coverage = _catalog_table(con, "coverage")

    servable = {
        str(row["name"])
        for row in variables.filter(
            pl.col("scale_type").is_in(sorted(SERVABLE_SCALE_TYPES))
            & ~pl.col("is_country_specific")
            & ~pl.col("restricted")
        ).iter_rows(named=True)
    }
    substantive = variables.filter(
        ~pl.col("scale_type").is_in(sorted(NON_SUBSTANTIVE_SCALE_TYPES))
    ).sort("name")

    _write_json(
        static_dir / "meta.json",
        {
            "data_version": data_version,
            "countries": [
                {"code": row["code"], "name": str(row["name"]), "iso3": str(row["iso3"])}
                for row in countries.sort("code").iter_rows(named=True)
            ],
            "waves": list(WAVES),
            "weight_table": json.loads(weight_table_json()),
            "suppression": {
                "threshold": policy.threshold,
                "flag_below": policy.flag_below,
            },
            "ci_level": 0.95,
            "breakdowns": sorted(BREAKDOWN_LEVELS),
            "breakdown_labels": breakdown_labels(variables, value_labels),
            "families": sorted(variables["family"].unique().to_list()),
            "state_labels": state_labels(),
        },
    )

    summaries = [
        _summary_payload(row, str(row["name"]) in servable)
        for row in substantive.iter_rows(named=True)
    ]
    summaries.extend(_derived_summary_payload(name) for name in sorted(DERIVED_OUTCOMES))
    _write_json(static_dir / "variables.json", {"variables": summaries})

    for summary in summaries:
        name = str(summary["name"])
        detail: dict[str, Any]
        if summary["is_derived"]:
            derived = DERIVED_OUTCOMES[name]
            detail = {
                **summary,
                "value_labels": [
                    {
                        "code": level,
                        "label": label,
                        "wave": None,
                        "country_code": None,
                        "is_nonresponse": False,
                    }
                    for level, label in score_bins(derived)
                ],
                "missingness": [],
                "scoring": derived.scoring,
                "components": [
                    _component_payload(item, variables, value_labels) for item in derived.components
                ],
            }
        else:
            detail = {
                **summary,
                "scoring": None,
                "components": [],
                "value_labels": [
                    {
                        "code": int(label["code"]),
                        "label": str(label["label"]),
                        "wave": label["wave"],
                        "country_code": label["country_code"],
                        "is_nonresponse": bool(label["is_nonresponse"]),
                    }
                    for label in value_labels.filter(pl.col("variable") == name)
                    .sort("code", "country_code", "wave", nulls_last=True)
                    .iter_rows(named=True)
                ],
                "missingness": [
                    dict(row)
                    for row in coverage.filter(pl.col("variable") == name)
                    .drop("variable")
                    .sort("wave", "country_code")
                    .iter_rows(named=True)
                ],
            }
        relative = Path("v1") / name / "variable.json"
        _write_json(static_dir / relative, detail)
        files.append({"path": relative.as_posix(), "outcome": name, "kind": "variable"})


def export_static(
    db_path: Path,
    static_dir: Path,
    *,
    data_version: str | None,
    only: tuple[str, ...] | None = None,
    policy: SuppressionPolicy = NO_SUPPRESSION,
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
            stat_default = default_stat(outcome.scale_type)
            levels = _levels(outcome)
            for wave in outcome.waves:
                spec = resolve((wave,))
                design = Design(weight=spec.weight, strata="strata", psu="psu")
                base = _frame(con, outcome, wave, spec, DEMOGRAPHICS)
                views: list[tuple[str, str, list[str]]] = [
                    (stat_default, f"{stat_default}_by-country_code", ["country_code"])
                ]
                views.extend(
                    (stat_default, f"{stat_default}_by-country_code-{demo}", ["country_code", demo])
                    for demo in DEMOGRAPHICS
                )
                if outcome.scale_type in DISTRIBUTION_SCALE_TYPES:
                    views.append(("distribution", "distribution_by-country_code", ["country_code"]))
                for stat, stem, groups in views:
                    if stat == "mean":
                        table = weighted_mean(base, "value", design, by=groups, policy=policy)
                    elif stat == "proportion":
                        table = weighted_proportion(
                            base, "value", design, by=groups, levels=levels, policy=policy
                        )
                    else:
                        binned, bin_levels = base, levels
                        if outcome.is_derived:
                            bins = score_bins(DERIVED_OUTCOMES[outcome.name])
                            if bins:
                                assert outcome.min is not None and outcome.max is not None
                                binned = base.with_columns(
                                    binned_expr("value", lo=outcome.min, hi=outcome.max)
                                )
                                bin_levels = [level for level, _ in bins]
                        table = weighted_distribution(
                            binned, "value", design, by=groups, levels=bin_levels, policy=policy
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
                        policy,
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
        export_catalog(con, static_dir, data_version, files, policy)
    finally:
        con.close()
    index: dict[str, Any] = {
        "data_version": data_version,
        "file_count": len(files),
        "catalog_files": ["meta.json", "variables.json"],
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
