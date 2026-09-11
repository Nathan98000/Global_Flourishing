"""GET /v1/states — US state aggregates on the state-calibrated weights.

A thin variant of /v1/aggregate: scope ``us_state`` (or ``us_state_adj``
with ``adj=true``), grouped by state, same envelope. The eligibility
(country 22, state present) and weight columns come from the weight
table's ``us_state:*`` rows.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from flourish_api.data import DataStore, require_data
from flourish_api.queries import parse_aggregate_query
from flourish_api.routes.aggregate import run_aggregate
from flourish_api.schemas import EstimateResponse

router = APIRouter()


@router.get("/states", summary="US state-level aggregates with state weights")
def states(
    store: Annotated[DataStore, Depends(require_data)],
    outcome: str,
    wave: str,
    stat: str = "mean",
    adj: bool = False,
    oriented: bool = False,
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
) -> EstimateResponse:
    """State-by-state estimates for US respondents with a state (157 US
    rows have none). ``adj=true`` uses the ``_ADJ_`` weight variants
    (unavailable for Wave 1, which needed no adjustment)."""
    assert store.catalog is not None
    query = parse_aggregate_query(
        store.catalog,
        outcome=outcome,
        stat=stat,
        wave=wave,
        by=["state", *(by or [])],
        filters=filter or [],
        scope="us_state_adj" if adj else "us_state",
        oriented=oriented,
        p=None,
    )
    return run_aggregate(store, query)
