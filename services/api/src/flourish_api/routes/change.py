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
    SuppressionPolicy,
    paired_change,
    paired_change_distribution,
    paired_share_change,
    three_point_panel,
    transition_matrix,
)

from flourish_api.data import DataStore, require_data, suppression_policy
from flourish_api.frames import AssembledFrame, assemble_change_frame, wave_column
from flourish_api.queries import ChangeQuery, parse_change_query
from flourish_api.routes.aggregate import catalog_levels
from flourish_api.schemas import EstimateResponse, ResponseMeta, SuppressionModel
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: Categorical scale types: their change is the change in share at each
#: code (``change_share``) plus the transition matrix — never a mean of
#: codes (ADR-0015). Numeric scales (``MEAN_SCALE_TYPES``) get the mean
#: change on aligned values and the histogram of individual change.
CATEGORICAL_SCALE_TYPES = frozenset({"ordinal", "nominal", "binary"})


def change_tables(
    assembled: AssembledFrame, query: ChangeQuery, policy: SuppressionPolicy
) -> list[pa.Table]:
    frame, design, groups = assembled.frame, assembled.design, list(query.by)
    if query.is_three_point:
        y1, my, y2 = (wave_column(w) for w in query.waves)
        return [
            three_point_panel(
                frame, y1, my, y2, design, scope=query.scope, by=groups, policy=policy
            )
        ]
    earlier, later = (wave_column(w) for w in query.waves)
    levels = catalog_levels(query.outcome)
    if query.outcome.scale_type in CATEGORICAL_SCALE_TYPES:
        if levels is None:
            observed = set(frame[earlier].drop_nulls().to_list())
            observed |= set(frame[later].drop_nulls().to_list())
            levels = sorted(observed)
        return [
            paired_share_change(
                frame, earlier, later, design, levels=levels, by=groups, policy=policy
            ),
            transition_matrix(
                frame, earlier, later, design, by=groups, levels=levels, policy=policy
            ),
        ]
    tables = [paired_change(frame, earlier, later, design, by=groups, policy=policy)]
    if levels is not None and frame[earlier].dtype.is_integer():
        span = levels[-1] - levels[0]
        tables.append(
            paired_change_distribution(
                frame,
                earlier,
                later,
                design,
                by=groups,
                levels=range(-span, span + 1),
                policy=policy,
            )
        )
    return tables


@router.get("/change", summary="Within-person change across waves")
def change(
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    outcome: str,
    to: str,
    via: str | None = None,
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
    scope: str = "global",
    rect: bool = False,
    from_wave: Annotated[str, Query(alias="from")] = "Y1",
) -> EstimateResponse:
    """Within-person change with a design-based CI. Numeric scales (0–10,
    counts) report the mean change on values aligned so higher means more
    of what the measure names (``stat = "change"``), plus the distribution
    of individual change; categorical items report the change in the
    share answering each level (``stat = "change_share"``, a fraction —
    × 100 for percentage points) plus the transition matrix.
    ``from=Y1&via=MY&to=Y2`` returns the three panel legs under the
    three-point weight (numeric scales only)."""
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
        row
        for table in change_tables(assembled, query, policy)
        for row in rows_from_table(table, query.by)
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
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=assembled.frame.height,
        n_valid=assembled.frame[assembled.value].drop_nulls().len(),
        by=list(query.by),
        filters={
            **({"country_code": list(query.countries)} if query.countries else {}),
            **{item.column: list(item.values) for item in query.filters},
        },
    )
    return EstimateResponse(meta=meta, rows=rows)
