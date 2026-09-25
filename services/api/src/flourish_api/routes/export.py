"""GET /v1/export.csv — the same aggregate, as a CSV download."""

from __future__ import annotations

import re
import unicodedata
from typing import Annotated

import polars as pl
from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from flourish_stats import SuppressionPolicy
from flourish_stats.breakdowns import breakdown_labels

from flourish_api.data import DataStore, require_data, suppression_policy
from flourish_api.queries import AggregateQuery
from flourish_api.routes.aggregate import aggregate_query_dependency, run_aggregate
from flourish_api.serialize import response_to_csv

router = APIRouter()


#: The waves in words, as the web client's controls name them (waves.ts
#: WAVE_CHIPS) — the one place the API restates that navigation copy, so
#: a server-named download matches a client-named one (ADR-0016).
WAVE_WORDS = {"Y1": "2023", "MY": "Midyear", "Y2": "2024"}


def _slug(text: str) -> str:
    """Lowercase ASCII, diacritics stripped (Türkiye → turkiye) — the
    web client's `slugify` (export/filename.ts), rule for rule."""
    decomposed = unicodedata.normalize("NFD", text)
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    plain = plain.replace("'", "").replace("\u2019", "").lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def _filename(query: AggregateQuery, store: DataStore) -> str:
    """flourish-atlas_<measure>_<view>_<waves>[_by-<breakdown>][_<country>].csv
    — the same string the web client builds (export/filename.ts) for the
    same view: the measure's display name, the view in words, the wave,
    then any breakdown's display name and, for a single-country query,
    the country's name. Never a code, never the data version."""
    assert store.catalog is not None
    groups = list(query.group_columns)
    view = (
        "By country"
        if "country_code" in groups
        else ("Overall" if not groups else "By " + groups[0])
    )
    labels = breakdown_labels(store.catalog.variables, store.catalog.value_labels)
    extras = [column for column in groups if column != "country_code"]
    breakdown = " and ".join(
        str(labels[column]["display_name"]) if column in labels else column.replace("_", " ")
        for column in extras
    )
    parts = [
        "flourish-atlas",
        _slug(query.outcome.display_name),
        _slug(view),
        _slug(WAVE_WORDS.get(query.wave, query.wave)),
    ]
    if breakdown:
        parts.append("by-" + _slug(breakdown))
    if len(query.countries) == 1:
        match = store.catalog.countries.filter(pl.col("code") == query.countries[0])
        if match.height:
            parts.append(_slug(str(match.row(0, named=True)["name"])))
    return "_".join(part for part in parts if part) + ".csv"


@router.get(
    "/export.csv",
    summary="Aggregate estimates as CSV",
    response_class=PlainTextResponse,
)
def export_csv(
    store: Annotated[DataStore, Depends(require_data)],
    query: Annotated[AggregateQuery, Depends(aggregate_query_dependency)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
) -> PlainTextResponse:
    """Same query model as /v1/aggregate; the response meta rides along
    as `#`-comment header lines, so a downloaded file still names its
    weight, data version and suppression rules."""
    response = run_aggregate(store, query, policy)
    return PlainTextResponse(
        content=response_to_csv(response),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{_filename(query, store)}"'},
    )
