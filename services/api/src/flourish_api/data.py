"""The API's data tier: one read-only DuckDB file, opened at startup.

The store owns the connection, the in-memory catalog (the small tables:
``variables``, ``value_labels``, ``countries``, ``coverage``) and the data
version from ``manifest.json``. The big tables (``responses_long``,
``derived``) are sliced per request through ``flourish_stats.io`` only.

**Absent data is a supported state, not an error** (ADR-0007): when the
file does not exist the app still boots, ``/health`` reports
``data: absent`` and every ``/v1/*`` endpoint returns 503 via
:func:`require_data`. That is what keeps CI's docker job — which builds
the image without any data — honestly green.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

import duckdb
import polars as pl
from fastapi import HTTPException, Request
from flourish_stats.io import DEFAULT_COLUMNS, analysis_frame, derived_frame

from flourish_api.config import Settings

#: scale types an outcome may have to be servable (catalog `variables`).
SERVABLE_SCALE_TYPES = frozenset({"scale_0_10", "ordinal", "binary", "nominal", "count"})


@dataclass(frozen=True)
class DerivedOutcome:
    """A score computed by the pipeline, served like any catalog item."""

    column: str  # column of the `derived` table
    scale_type: str  # kind used by query validation
    min: int
    max: int
    direction: str
    display_name: str
    description: str


#: Derived outcomes served from the `derived` table (proposal §5.2 step 4).
#: The screeners run higher = more symptomatic → lower_better.
DERIVED_OUTCOMES: dict[str, DerivedOutcome] = {
    "sfi": DerivedOutcome(
        "sfi",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "Secure Flourishing Index",
        "Mean of the 12 SFI items (≥ 10 answered), 0–10.",
    ),
    "sfi_happiness": DerivedOutcome(
        "sfi_happiness",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: happiness & life satisfaction",
        "Mean of HAPPY and LIFE_SAT, 0–10.",
    ),
    "sfi_health": DerivedOutcome(
        "sfi_health",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: mental & physical health",
        "Mean of PHYSICAL_HLTH and MENTAL_HEALTH, 0–10.",
    ),
    "sfi_meaning": DerivedOutcome(
        "sfi_meaning",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: meaning & purpose",
        "Mean of WORTHWHILE and LIFE_PURPOSE, 0–10.",
    ),
    "sfi_character": DerivedOutcome(
        "sfi_character",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: character & virtue",
        "Mean of PROMOTE_GOOD and GIVE_UP, 0–10.",
    ),
    "sfi_relationships": DerivedOutcome(
        "sfi_relationships",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: close social relationships",
        "Mean of CONTENT and SAT_RELATNSHP, 0–10.",
    ),
    "sfi_financial": DerivedOutcome(
        "sfi_financial",
        "scale_0_10",
        0,
        10,
        "higher_better",
        "SFI: financial & material stability",
        "Mean of EXPENSES and WORRY_SAFETY, 0–10.",
    ),
    "phq2_score": DerivedOutcome(
        "phq2_score",
        "count",
        0,
        6,
        "lower_better",
        "PHQ-2 depression score",
        "Sum of the two PHQ-2 items rescored 0–3 each; 0–6.",
    ),
    "phq2_positive": DerivedOutcome(
        "phq2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "PHQ-2 screen positive",
        "PHQ-2 score ≥ 3; served as the weighted share screening positive.",
    ),
    "gad2_score": DerivedOutcome(
        "gad2_score",
        "count",
        0,
        6,
        "lower_better",
        "GAD-2 anxiety score",
        "Sum of the two GAD-2 items rescored 0–3 each; 0–6.",
    ),
    "gad2_positive": DerivedOutcome(
        "gad2_positive",
        "binary",
        0,
        1,
        "lower_better",
        "GAD-2 screen positive",
        "GAD-2 score ≥ 3; served as the weighted share screening positive.",
    ),
}

#: Waves the derived outcomes exist at (derive.py builds Y1 + Y2; the MY
#: rows carry only the midyear priorities, which ship in Phase 5).
DERIVED_WAVES: tuple[str, ...] = ("Y1", "Y2")


@dataclass(frozen=True)
class VariableInfo:
    """The slice of a catalog row the query layer needs."""

    name: str
    scale_type: str
    direction: str
    min: int | None
    max: int | None
    waves: tuple[str, ...]
    is_derived: bool


@dataclass
class Catalog:
    variables: pl.DataFrame
    value_labels: pl.DataFrame
    countries: pl.DataFrame
    coverage: pl.DataFrame
    _servable: dict[str, VariableInfo] = field(init=False)

    def __post_init__(self) -> None:
        servable = self.variables.filter(
            pl.col("scale_type").is_in(sorted(SERVABLE_SCALE_TYPES))
            & ~pl.col("is_country_specific")
            & ~pl.col("restricted")
        )
        self._servable = {
            str(row["name"]): VariableInfo(
                name=str(row["name"]),
                scale_type=str(row["scale_type"]),
                direction=str(row["direction"]),
                min=row["min"],
                max=row["max"],
                waves=tuple(row["waves_available"]),
                is_derived=False,
            )
            for row in servable.iter_rows(named=True)
        }
        for name, derived in DERIVED_OUTCOMES.items():
            self._servable[name] = VariableInfo(
                name=name,
                scale_type=derived.scale_type,
                direction=derived.direction,
                min=derived.min,
                max=derived.max,
                waves=DERIVED_WAVES,
                is_derived=True,
            )

    def outcome(self, name: str) -> VariableInfo | None:
        return self._servable.get(name)

    @property
    def outcome_names(self) -> list[str]:
        return sorted(self._servable)

    @property
    def families(self) -> list[str]:
        return sorted(self.variables["family"].unique().to_list())

    def country_codes(self) -> set[int]:
        return set(self.countries["code"].to_list())


class DataStore:
    """Read-only DuckDB + catalog + data version; ``present`` is honest."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.present = settings.data_path.exists()
        self.data_version: str | None = None
        self.con: duckdb.DuckDBPyConnection | None = None
        self.catalog: Catalog | None = None
        if not self.present:
            return
        self.con = duckdb.connect(str(settings.data_path), read_only=True)
        # Cloud Run shape (512 MiB / 1 CPU): bounded threads and memory,
        # tunable via FA_* env without a code change (ADR-0007).
        self.con.execute(f"SET threads = {int(settings.duckdb_threads)}")
        self.con.execute(f"SET memory_limit = '{settings.duckdb_memory_limit}'")
        self.catalog = Catalog(
            variables=self._table("variables"),
            value_labels=self._table("value_labels"),
            countries=self._table("countries"),
            coverage=self._table("coverage"),
        )
        if settings.manifest_path.exists():
            manifest: dict[str, Any] = json.loads(settings.manifest_path.read_text())
            version = manifest.get("data_version")
            self.data_version = str(version) if version is not None else None

    def _table(self, name: str) -> pl.DataFrame:
        assert self.con is not None
        frame = pl.from_arrow(self.con.execute(f"FROM {name}").arrow())
        assert isinstance(frame, pl.DataFrame)
        return frame

    def close(self) -> None:
        if self.con is not None:
            self.con.close()
            self.con = None

    # -- frame assembly (delegates to flourish_stats.io) ------------------

    def outcome_frame(
        self,
        outcome: VariableInfo,
        wave: str,
        *,
        oriented: bool = False,
        extra_columns: tuple[str, ...] = (),
    ) -> pl.DataFrame:
        """One (outcome, wave) analysis frame with the requested columns.

        Derived outcomes come from ``derived`` (no orientation — scores are
        already higher-is-better); items come from ``responses_long`` or the
        ``responses_oriented`` view.
        """
        assert self.con is not None
        columns = tuple(dict.fromkeys((*DEFAULT_COLUMNS, *extra_columns)))
        if outcome.is_derived:
            column = DERIVED_OUTCOMES[outcome.name].column
            frame = derived_frame(self.con, column, wave, columns=columns)
            # Booleans (screener positives) estimate as indicator means.
            if frame["value"].dtype == pl.Boolean:
                frame = frame.with_columns(pl.col("value").cast(pl.Int8))
            return frame
        return analysis_frame(self.con, outcome.name, wave, oriented=oriented, columns=columns)


def require_data(request: Request) -> DataStore:
    """FastAPI dependency: the store, or an honest 503 when data is absent."""
    store: DataStore = request.app.state.store
    if not store.present:
        raise HTTPException(
            status_code=503,
            detail=(
                "No data is baked into this deployment: the API is running "
                "without data/flourish.duckdb (see /health). Aggregate "
                "endpoints are unavailable until an image with data is deployed."
            ),
        )
    return store
