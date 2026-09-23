"""GET /v1/correlates — what travels with an outcome (ADR-0014).

Two estimators behind one envelope: the unadjusted weighted correlation
(point estimate only, ``ci_method = "none"`` — no interval is claimed) and
the adjusted association (the predictor's coefficient under the fixed
control set, with the design-based sandwich SE). Either runs against the
named predictors (``against``, repeatable — a view asks for its ranked
list's items across countries this way) or, when none is named, against
every other servable ordered item at the wave in a single pass over one
frame, ranked and cut to ``limit``.
"""

from __future__ import annotations

import math
from statistics import median
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from flourish_stats import SuppressionPolicy, adjusted_association, weighted_correlations
from flourish_stats.correlations import DEFAULT_CONTROLS
from flourish_stats.outcomes import DERIVED_OUTCOMES

from flourish_api.data import Catalog, DataStore, VariableInfo, require_data, suppression_policy
from flourish_api.frames import AssembledFrame, assemble_correlates_frame
from flourish_api.queries import (
    CORRELATES_DEFAULT_LIMIT,
    ORDERED_SCALE_TYPES,
    CorrelatesQuery,
    parse_correlates_query,
)
from flourish_api.schemas import EstimateResponse, EstimateRow, ResponseMeta, SuppressionModel
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: The row an adjusted predictor is ranked on: per-SD coefficients are
#: comparable across predictors with different scales; raw ones are not.
RANKING_MEASURE = "beta_per_sd"


def _answers(info: VariableInfo) -> set[str]:
    """The questions a variable is made of (itself, plus the components of
    a derived score)."""
    if info.is_derived:
        return {info.name, *DERIVED_OUTCOMES[info.name].components}
    return {info.name}


def shares_answers(a: VariableInfo, b: VariableInfo) -> bool:
    """A score and one of its components (or two scores sharing a
    question) are associated by construction, not by anything in the
    world — the sweep leaves them out."""
    return bool(_answers(a) & _answers(b))


def candidate_predictors(catalog: Catalog, query: CorrelatesQuery) -> list[VariableInfo]:
    """Every other servable ordered item asked at the wave, minus those
    built from the same answers as the outcome."""
    candidates: list[VariableInfo] = []
    for name in catalog.outcome_names:
        info = catalog.outcome(name)
        if (
            info is not None
            and info.name != query.outcome.name
            and info.scale_type in ORDERED_SCALE_TYPES
            and query.wave in info.waves
            and not shares_answers(info, query.outcome)
        ):
            candidates.append(info)
    return candidates


def effective_controls(query: CorrelatesQuery) -> list[str]:
    """The control set actually in the model: a `by` column is a domain,
    not a regressor, and a one-country frame has no country fixed effect
    (the engine drops both; this is the honest list for the caption)."""
    if not query.adjusted:
        return []
    return [
        c
        for c in DEFAULT_CONTROLS
        if c not in query.by and not (c == "country_code" and len(query.countries) == 1)
    ]


def estimate_rows(
    assembled: AssembledFrame,
    query: CorrelatesQuery,
    predictors: list[VariableInfo],
    policy: SuppressionPolicy,
) -> dict[str, list[EstimateRow]]:
    """Rows per predictor. Unadjusted: every predictor in one engine pass
    over the frame; adjusted: one model fit per predictor."""
    frame, design, groups = assembled.frame, assembled.design, list(assembled.groups)
    if not query.adjusted:
        table = weighted_correlations(
            frame,
            assembled.value,
            [p.name for p in predictors],
            design,
            method="spearman" if query.method == "spearman" else "pearson",
            by=groups,
            policy=policy,
        )
        by_predictor: dict[str, list[EstimateRow]] = {p.name: [] for p in predictors}
        for row in rows_from_table(table, groups):
            assert row.predictor is not None
            by_predictor[row.predictor].append(row)
        return by_predictor
    return {
        p.name: [
            row.model_copy(update={"predictor": p.name})
            for row in rows_from_table(
                adjusted_association(
                    frame,
                    assembled.value,
                    p.name,
                    design,
                    family="binomial" if query.family == "binomial" else "gaussian",
                    controls=DEFAULT_CONTROLS,
                    by=groups,
                    policy=policy,
                ),
                groups,
            )
        ]
        for p in predictors
    }


def rank_key(rows: list[EstimateRow], adjusted: bool) -> float:
    """Strength of a predictor across its groups: the median absolute
    estimate (per-SD coefficient when adjusted). Predictors with no
    defined estimate anywhere sort last."""
    values = [
        abs(row.estimate)
        for row in rows
        if row.estimate is not None and (not adjusted or row.measure == RANKING_MEASURE)
    ]
    return median(values) if values else -math.inf


def run_correlates(
    store: DataStore, query: CorrelatesQuery, policy: SuppressionPolicy
) -> EstimateResponse:
    assert store.catalog is not None
    predictors = list(query.against) or candidate_predictors(store.catalog, query)
    assembled = assemble_correlates_frame(store, query, predictors)
    estimated = list(estimate_rows(assembled, query, predictors, policy).items())
    if not query.against:
        estimated.sort(key=lambda item: (-rank_key(item[1], query.adjusted), item[0]))
        estimated = estimated[: query.limit]
    rows = [row for _, predictor_rows in estimated for row in predictor_rows]
    stat = "beta" if query.adjusted else f"{query.method}_r"
    meta = ResponseMeta(
        data_version=store.data_version,
        outcome=query.outcome.name,
        scale_type=query.outcome.scale_type,
        direction=query.outcome.direction,
        stat=stat,
        waves=[query.wave],
        scope="global",
        oriented=False,
        weight_key=assembled.spec.key,
        weight=assembled.spec.weight,
        se_method=assembled.design.se_method if query.adjusted else "none",
        ci_level=0.95,
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=assembled.frame.height,
        n_valid=assembled.frame[assembled.value].drop_nulls().len(),
        by=list(query.by),
        filters={
            **({"country_code": list(query.countries)} if query.countries else {}),
            **{item.column: list(item.values) for item in query.filters},
        },
        adjusted=query.adjusted,
        controls=effective_controls(query),
        model=(
            ("binary" if query.family == "binomial" else "continuous") if query.adjusted else None
        ),
    )
    return EstimateResponse(meta=meta, rows=rows)


@router.get("/correlates", summary="What travels with an outcome: ranked associations")
def correlates(
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    outcome: str,
    wave: str,
    against: Annotated[list[str] | None, Query()] = None,
    method: str = "pearson",
    adjusted: bool = False,
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
    limit: int = CORRELATES_DEFAULT_LIMIT,
) -> EstimateResponse:
    """Associations, not causes. Unadjusted rows are weighted Pearson or
    Spearman coefficients with no interval (``ci_method = "none"``);
    ``adjusted=true`` returns the predictor's coefficient in a
    survey-weighted regression under the fixed control set (``stat =
    "beta"``, plus a ``beta_per_sd`` row) with a design-based CI. Omit
    ``against`` for the ranked sweep over every other servable ordered
    item at the wave, cut to ``limit`` predictors (ranked by the median
    absolute association across the groups). Binary items enter as
    indicators of code 1 (Yes / screen positive). Global scope only."""
    assert store.catalog is not None
    query = parse_correlates_query(
        store.catalog,
        outcome=outcome,
        wave=wave,
        against=against or [],
        method=method,
        adjusted=adjusted,
        by=by or [],
        filters=filter or [],
        limit=limit,
    )
    return run_correlates(store, query, policy)
