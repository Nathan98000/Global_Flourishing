"""GET /v1/change — the same people across waves.

Never the difference of two cross-sections: the weight is the
longitudinal one resolved from the wave→weight→eligibility table, and the
standalone-midyear restriction on MY→Y2 comparisons rides in on the
spec's eligibility — no code here re-states it.
"""

from __future__ import annotations

from typing import Annotated

import pyarrow as pa
from fastapi import APIRouter, Depends, Query
from flourish_stats import (
    DEFAULT_POLICY,
    paired_change,
    paired_change_distribution,
    three_point_panel,
    transition_matrix,
)

from flourish_api.data import DataStore, require_data
from flourish_api.frames import AssembledFrame, assemble_change_frame, wave_column
from flourish_api.queries import ChangeQuery, parse_change_query
from flourish_api.routes.aggregate import catalog_levels
from flourish_api.schemas import EstimateResponse, ResponseMeta, SuppressionModel
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: scale types that get a transition matrix alongside the mean change.
TRANSITION_SCALE_TYPES = frozenset({"ordinal", "nominal", "binary"})


def change_tables(assembled: AssembledFrame, query: ChangeQuery) -> list[pa.Table]:
    frame, design, groups = assembled.frame, assembled.design, list(query.by)
    if query.is_three_point:
        y1, my, y2 = (wave_column(w) for w in query.waves)
        return [three_point_panel(frame, y1, my, y2, design, scope=query.scope, by=groups)]
    earlier, later = (wave_column(w) for w in query.waves)
    tables = [paired_change(frame, earlier, later, design, by=groups)]
    levels = catalog_levels(query.outcome)
    if levels is not None and frame[earlier].dtype.is_integer():
        span = levels[-1] - levels[0]
        tables.append(
            paired_change_distribution(
                frame, earlier, later, design, by=groups, levels=range(-span, span + 1)
            )
        )
        if query.outcome.scale_type in TRANSITION_SCALE_TYPES:
            tables.append(
                transition_matrix(frame, earlier, later, design, by=groups, levels=levels)
            )
    return tables


@router.get("/change", summary="Within-person change across waves")
def change(
    store: Annotated[DataStore, Depends(require_data)],
    outcome: str,
    to: str,
    via: str | None = None,
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
    scope: str = "global",
    rect: bool = False,
    from_wave: Annotated[str, Query(alias="from")] = "Y1",
) -> EstimateResponse:
    """Mean within-person change with a design-based CI, plus (for
    integer-coded items) the distribution of individual change and (for
    categorical items) the transition matrix. ``from=Y1&via=MY&to=Y2``
    returns the three panel legs under the three-point weight."""
    assert store.catalog is not None
    query = parse_change_query(
        store.catalog,
        outcome=outcome,
        from_wave=from_wave,
        to_wave=to,
        via=via,
        by=by or [],
        filters=filter or [],
        scope=scope,
        rect=rect,
    )
    assembled = assemble_change_frame(store, query)
    rows = [
        row for table in change_tables(assembled, query) for row in rows_from_table(table, query.by)
    ]
    meta = ResponseMeta(
        data_version=store.data_version,
        outcome=query.outcome.name,
        scale_type=query.outcome.scale_type,
        direction=query.outcome.direction,
        stat="change",
        waves=list(query.waves),
        scope=query.scope,
        oriented=False,
        weight_key=query.spec.key,
        weight=query.spec.weight,
        se_method=assembled.design.se_method,
        ci_level=0.95,
        suppression=SuppressionModel(
            threshold=DEFAULT_POLICY.threshold, flag_below=DEFAULT_POLICY.flag_below
        ),
        n_frame=assembled.frame.height,
        n_valid=assembled.frame[assembled.value].drop_nulls().len(),
        by=list(query.by),
        filters={
            **({"country_code": list(query.countries)} if query.countries else {}),
            **{item.column: list(item.values) for item in query.filters},
        },
    )
    return EstimateResponse(meta=meta, rows=rows)
