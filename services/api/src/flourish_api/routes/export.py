"""GET /v1/export.csv — the same aggregate, as a CSV download."""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from flourish_api.data import DataStore, require_data
from flourish_api.queries import AggregateQuery
from flourish_api.routes.aggregate import aggregate_query_dependency, run_aggregate
from flourish_api.serialize import response_to_csv

router = APIRouter()


def _filename(query: AggregateQuery, data_version: str | None) -> str:
    raw = f"flourish_{query.outcome.name}_{query.wave}_{query.stat}_{data_version or 'nodata'}"
    return re.sub(r"[^A-Za-z0-9._-]", "-", raw) + ".csv"


@router.get(
    "/export.csv",
    summary="Aggregate estimates as CSV",
    response_class=PlainTextResponse,
)
def export_csv(
    store: Annotated[DataStore, Depends(require_data)],
    query: Annotated[AggregateQuery, Depends(aggregate_query_dependency)],
) -> PlainTextResponse:
    """Same query model as /v1/aggregate; the response meta rides along
    as `#`-comment header lines, so a downloaded file still names its
    weight, data version and suppression rules."""
    response = run_aggregate(store, query)
    return PlainTextResponse(
        content=response_to_csv(response),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(query, store.data_version)}"'
        },
    )
