"""GET /v1/aggregate — estimates for one outcome × wave × breakdowns."""

from __future__ import annotations

from typing import Annotated

import pyarrow as pa
from fastapi import APIRouter, Depends, Query
from flourish_stats import (
    DEFAULT_POLICY,
    weighted_distribution,
    weighted_mean,
    weighted_proportion,
    weighted_quantile,
)

from flourish_api.data import DataStore, VariableInfo, require_data
from flourish_api.frames import AssembledFrame, assemble_aggregate_frame
from flourish_api.queries import AggregateQuery, parse_aggregate_query
from flourish_api.schemas import EstimateResponse, ResponseMeta, SuppressionModel
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: Above this many distinct codes the level grid falls back to observed
#: values (keeps count items with wide ranges from exploding the bins).
MAX_LEVEL_SPAN = 25


def catalog_levels(outcome: VariableInfo) -> list[int] | None:
    """The catalog's [min, max] as an explicit level grid, so empty bins
    ship (docs/METHODS.md); None → the engine uses observed values."""
    if outcome.min is None or outcome.max is None:
        return None
    if outcome.max - outcome.min > MAX_LEVEL_SPAN:
        return None
    return list(range(outcome.min, outcome.max + 1))


def estimate_table(assembled: AssembledFrame, query: AggregateQuery) -> pa.Table:
    frame, design, groups = assembled.frame, assembled.design, list(assembled.groups)
    if query.stat == "mean":
        return weighted_mean(frame, assembled.value, design, by=groups)
    if query.stat == "proportion":
        return weighted_proportion(
            frame, assembled.value, design, by=groups, levels=catalog_levels(query.outcome)
        )
    if query.stat == "distribution":
        return weighted_distribution(
            frame, assembled.value, design, by=groups, levels=catalog_levels(query.outcome)
        )
    assert query.stat == "quantile"
    return weighted_quantile(frame, assembled.value, design, by=groups, p=query.p)


def build_meta(
    store: DataStore, query: AggregateQuery, assembled: AssembledFrame, stat: str
) -> ResponseMeta:
    return ResponseMeta(
        data_version=store.data_version,
        outcome=query.outcome.name,
        scale_type=query.outcome.scale_type,
        direction=query.outcome.direction,
        stat=stat,
        waves=[query.wave],
        scope=query.scope,
        oriented=query.oriented,
        weight_key=assembled.spec.key,
        weight=assembled.spec.weight,
        se_method=assembled.design.se_method,
        ci_level=0.95,
        suppression=SuppressionModel(
            threshold=DEFAULT_POLICY.threshold, flag_below=DEFAULT_POLICY.flag_below
        ),
        n_frame=assembled.frame.height,
        n_valid=assembled.frame[assembled.value].drop_nulls().len(),
        by=list(assembled.groups),
        filters={
            "country_code": list(query.countries),
            **{item.column: list(item.values) for item in query.filters},
        }
        if query.countries
        else {item.column: list(item.values) for item in query.filters},
    )


def run_aggregate(store: DataStore, query: AggregateQuery) -> EstimateResponse:
    assembled = assemble_aggregate_frame(store, query)
    table = estimate_table(assembled, query)
    return EstimateResponse(
        meta=build_meta(store, query, assembled, query.stat),
        rows=rows_from_table(table, assembled.groups),
    )


def aggregate_query_dependency(
    store: Annotated[DataStore, Depends(require_data)],
    outcome: str,
    wave: str,
    stat: str = "mean",
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
    scope: str = "global",
    oriented: bool = False,
    p: Annotated[list[float] | None, Query()] = None,
) -> AggregateQuery:
    assert store.catalog is not None
    return parse_aggregate_query(
        store.catalog,
        outcome=outcome,
        stat=stat,
        wave=wave,
        by=by or [],
        filters=filter or [],
        scope=scope,
        oriented=oriented,
        p=p,
    )


@router.get("/aggregate", summary="Survey-weighted estimates with design-based CIs")
def aggregate(
    store: Annotated[DataStore, Depends(require_data)],
    query: Annotated[AggregateQuery, Depends(aggregate_query_dependency)],
) -> EstimateResponse:
    """One outcome at one wave, grouped and filtered. Every row carries
    the weight, SE method, unweighted n, CI and suppression flags; the
    weight itself is resolved from the wave→weight→eligibility table,
    never chosen here."""
    return run_aggregate(store, query)
