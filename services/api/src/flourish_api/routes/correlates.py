"""GET /v1/correlates — what travels with an outcome (ADR-0014).

Two estimators behind one envelope: the unadjusted weighted correlation
(point estimate only, ``ci_method = "none"`` — no interval is claimed) and
the adjusted association (the predictor's coefficient under the fixed
control set, with the design-based sandwich SE — off unless the server
enables it, ADR-0018). Either runs against the named predictors
(``against``, repeatable — a view asks for its ranked list's items across
countries this way) or, when none is named, against every other servable
ordered item at the wave in a single pass over one frame, ranked, cut to
``limit`` and kept free of overlap: of two kept predictors built from the
same answers, only the one built from more of them stays.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from statistics import median
from typing import Annotated, Any

import polars as pl
from fastapi import APIRouter, Depends, HTTPException, Query
from flourish_stats import (
    SuppressionPolicy,
    adjusted_association,
    average_countries,
    weighted_correlations,
)
from flourish_stats.averaging import COUNTRY
from flourish_stats.correlations import CORRELATES_MIN_N, DEFAULT_CONTROLS

from flourish_api.country_correlations import CountryCorrelations, FrameFacts
from flourish_api.data import (
    Catalog,
    DataStore,
    VariableInfo,
    adjusted_gate,
    correlates_min_n,
    country_correlations,
    require_data,
    suppression_policy,
)
from flourish_api.frames import (
    AssembledFrame,
    assemble_correlates_frame,
    correlation_spec,
)
from flourish_api.queries import (
    CORRELATES_DEFAULT_LIMIT,
    ORDERED_SCALE_TYPES,
    CorrelatesQuery,
    answer_wave,
    answers_of,
    is_midyear,
    parse_correlates_query,
    shares_answers,
)
from flourish_api.schemas import (
    EstimateResponse,
    EstimateRow,
    GroupValue,
    ResponseMeta,
    SuppressionModel,
)
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: The row an adjusted predictor is ranked on: per-SD coefficients are
#: comparable across predictors with different scales; raw ones are not.
RANKING_MEASURE = "beta_per_sd"


def stands_in_for(a: VariableInfo, b: VariableInfo) -> bool:
    """Whether ``a`` replaces ``b`` when the two share answers: the one
    built from more answers wins (a score over its own questions); on a
    tie, the non-binary one (a score over its screen-positive flag). A
    full tie keeps the one already in the list."""
    size_a, size_b = len(answers_of(a)), len(answers_of(b))
    if size_a != size_b:
        return size_a > size_b
    return a.scale_type != "binary" and b.scale_type == "binary"


Ranked = list[tuple[str, list[EstimateRow]]]


def drop_overlaps(
    ranked: Ranked, infos: dict[str, VariableInfo], limit: int
) -> tuple[Ranked, dict[str, str]]:
    """The first ``limit`` predictors of ``ranked`` with no two built from
    the same answers (ADR-0018), and what was left out for it.

    Walks the ranking in order, keeping predictors until ``limit`` are
    kept. A predictor that shares answers with kept ones replaces them
    when it stands in for every one of them (they leave the list and the
    walk backfills from further down), and is itself left out otherwise.
    Only kept predictors compete: a score ranked below the cut never
    displaces its question. The map sends each dropped name to the kept
    predictor that stands in for it.
    """
    kept: Ranked = []
    dropped: dict[str, str] = {}
    for name, rows in ranked:
        if len(kept) >= limit:
            break
        info = infos[name]
        rivals = [item for item in kept if shares_answers(infos[item[0]], info)]
        if not rivals:
            kept.append((name, rows))
            continue
        losing = [item for item in rivals if not stands_in_for(info, infos[item[0]])]
        if losing:
            dropped[name] = losing[0][0]
            continue
        replaced = {item[0] for item in rivals}
        kept = [item for item in kept if item[0] not in replaced]
        kept.append((name, rows))
        for loser in replaced:
            dropped[loser] = name
        # Whatever the replaced ones stood in for, this one now does.
        for loser, winner in dropped.items():
            if winner in replaced:
                dropped[loser] = name
    return kept, dropped


def candidate_predictors(catalog: Catalog, query: CorrelatesQuery) -> list[VariableInfo]:
    """Every other servable ordered item asked at the wave, minus those
    built from the same answers as the outcome. At the midyear survey
    (ADR-0020): for a midyear question, every midyear question and every
    question asked at ``other_wave`` (read there); for any other question,
    the midyear questions only."""
    candidates: list[VariableInfo] = []
    for name in catalog.outcome_names:
        info = catalog.outcome(name)
        if (
            info is not None
            and info.name != query.outcome.name
            and info.scale_type in ORDERED_SCALE_TYPES
            and asked_beside(info, query)
            and not shares_answers(info, query.outcome)
        ):
            candidates.append(info)
    return candidates


def asked_beside(info: VariableInfo, query: CorrelatesQuery) -> bool:
    """Whether ``info`` can be correlated with the query's outcome at its
    wave — at the midyear survey, a midyear question always, another one
    at ``other_wave`` beside a midyear outcome only."""
    if query.wave != "MY":
        return query.wave in info.waves
    if is_midyear(info):
        return True
    return is_midyear(query.outcome) and query.other_wave in info.waves


def midyear_meta(
    wave: str, other_wave: str | None, names: list[str], infos: dict[str, VariableInfo]
) -> dict[str, Any]:
    """What a correlation at the midyear survey says about its answers
    (ADR-0020): the other questions' wave and each question's own."""
    if wave != "MY":
        return {}
    return {
        "other_wave": other_wave,
        "answer_waves": {name: answer_wave(infos[name], wave, other_wave) for name in names},
    }


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


def correlation_records(table: object, groups: Sequence[str]) -> pl.DataFrame:
    """An estimator table's rows as averaging records: the group columns,
    the predictor, the country and the estimate, SE, n and Σw."""
    frame = pl.from_arrow(table)  # type: ignore[arg-type]
    assert isinstance(frame, pl.DataFrame)
    return frame.select(*groups, "predictor", COUNTRY, "estimate", "se", "n", "sum_w")


def file_records(
    table: CountryCorrelations | None,
    query: CorrelatesQuery,
    predictors: list[VariableInfo],
    policy: SuppressionPolicy,
) -> tuple[pl.DataFrame, FrameFacts] | None:
    """The query's correlations in every country, from the precomputed file
    (ADR-0020), and the file's facts about the frame — for an average over
    the countries or a view country by country; None when the file cannot
    serve the request whole (a domain, a breakdown, an adjusted model, a
    pair it does not hold)."""
    country_by_country = not query.pooled and query.by == (COUNTRY,)
    averaged = query.pooled and not query.by
    if (
        table is None
        or not (country_by_country or averaged)
        or query.filters
        or query.adjusted
        or any(shares_answers(query.outcome, p) for p in predictors)
    ):
        return None
    config = (query.wave, query.other_wave)
    facts = table.frame(config)
    names = [query.outcome.name, *(p.name for p in predictors)]
    if facts is None or not table.holds(config, names):
        return None
    records = table.records(
        config, query.method, query.outcome.name, [p.name for p in predictors], policy
    )
    return records, facts


def country_rows(
    records: pl.DataFrame,
    predictors: list[VariableInfo],
    countries: Sequence[int],
    *,
    stat: str,
    weight: str,
    policy: SuppressionPolicy,
) -> dict[str, list[EstimateRow]]:
    """Per predictor, a row per country of the frame — as the on-demand
    estimator gives them, a country with nobody behind the pair at n = 0
    with no estimate — the serving policy applied as ``finalize`` applies
    it."""
    found = {
        (str(row["predictor"]), int(row[COUNTRY])): row for row in records.iter_rows(named=True)
    }
    rows: dict[str, list[EstimateRow]] = {}
    for predictor in predictors:
        rows[predictor.name] = []
        for code in countries:
            record = found.get((predictor.name, code))
            n = int(record["n"]) if record else 0
            suppressed = n < policy.threshold
            rows[predictor.name].append(
                EstimateRow(
                    group={COUNTRY: code},
                    predictor=predictor.name,
                    stat=stat,
                    estimate=None if suppressed or not record else record["estimate"],
                    se=None,
                    ci_lo=None,
                    ci_hi=None,
                    ci_level=0.95,
                    ci_method="none",
                    n=n,
                    sum_w=float(record["sum_w"]) if record else 0.0,
                    n_psu=None,
                    n_strata=None,
                    df=None,
                    se_method="none",
                    weight=weight,
                    suppressed=suppressed,
                    flagged=not suppressed and n < policy.flag_below,
                )
            )
    return rows


def averaged_correlation(
    average: dict[str, Any] | None,
    *,
    group: dict[str, GroupValue],
    predictor: str,
    stat: str,
    weight: str,
    policy: SuppressionPolicy,
    min_n: int,
) -> EstimateRow:
    """A correlation's plain average over the countries (ADR-0020) as an
    estimator row: no interval (a country's has none), ``n`` and ``sum_w``
    summed over the countries in it and ``n_countries`` of them. It is
    ``flagged`` — shown with an asterisk — only when every country in it
    rests on fewer than ``min_n`` people. With no country behind it: no
    estimate, n = 0."""
    n = int(average["n"]) if average else 0
    estimate = average["estimate"] if average else None
    largest = int(average["n_largest"]) if average else 0
    suppressed = n < policy.threshold
    return EstimateRow(
        group=group,
        predictor=predictor,
        stat=stat,
        estimate=None if suppressed else estimate,
        se=None,
        ci_lo=None,
        ci_hi=None,
        ci_level=0.95,
        ci_method="none",
        n=n,
        sum_w=float(average["sum_w"]) if average else 0.0,
        n_psu=None,
        n_strata=None,
        df=None,
        se_method="none",
        weight=weight,
        suppressed=suppressed,
        flagged=(
            not suppressed and estimate is not None and (n < policy.flag_below or largest < min_n)
        ),
        n_countries=int(average["n_countries"]) if average else 0,
    )


def averaged_rows(
    records: pl.DataFrame,
    predictors: Sequence[str],
    by: Sequence[str],
    *,
    stat: str,
    weight: str,
    policy: SuppressionPolicy,
    min_n: int,
) -> tuple[dict[str, list[EstimateRow]], list[int]]:
    """Per predictor, its correlation averaged over the countries — one row
    per breakdown group, in order — and every country in any of the
    averages (ADR-0020). A predictor no country has an estimate for keeps
    one row with none."""
    # (The records arrive in the estimator's order: breakdown groups sorted.)
    averages = average_countries(records, [*by, "predictor"])
    found: dict[str, list[dict[str, Any]]] = {}
    countries: set[int] = set()
    for average in averages.iter_rows(named=True):
        found.setdefault(str(average["predictor"]), []).append(average)
        countries.update(int(code) for code in average["countries"])
    rows: dict[str, list[EstimateRow]] = {}
    for name in predictors:
        kept = found.get(name) or [None]
        rows[name] = [
            averaged_correlation(
                average,
                group={column: average[column] for column in by} if average else {},
                predictor=name,
                stat=stat,
                weight=weight,
                policy=policy,
                min_n=min_n,
            )
            for average in kept
        ]
    return rows, sorted(countries)


def rankable(rows: list[EstimateRow], adjusted: bool, min_n: int) -> list[EstimateRow]:
    """The rows a predictor is ranked on: its per-SD coefficient when
    adjusted, and only the groups with at least ``min_n`` complete cases
    (ADR-0015 — the ranked list is an ordering, and an ordering of noise
    misleads; the cells themselves are still served)."""
    return [
        row for row in rows if row.n >= min_n and (not adjusted or row.measure == RANKING_MEASURE)
    ]


def rank_key(rows: list[EstimateRow], adjusted: bool, min_n: int = 0) -> float:
    """Strength of a predictor across its groups: the median absolute
    estimate (per-SD coefficient when adjusted) over the rankable groups.
    Predictors with no defined estimate anywhere sort last."""
    values = [
        abs(row.estimate) for row in rankable(rows, adjusted, min_n) if row.estimate is not None
    ]
    return median(values) if values else -math.inf


def run_correlates(
    store: DataStore,
    query: CorrelatesQuery,
    policy: SuppressionPolicy,
    min_n: int = CORRELATES_MIN_N,
    table: CountryCorrelations | None = None,
) -> EstimateResponse:
    assert store.catalog is not None
    predictors = list(query.against) or candidate_predictors(store.catalog, query)
    spec = correlation_spec(query.wave, query.other_wave)
    stat = "beta" if query.adjusted else f"{query.method}_r"
    countries: list[int] = []
    served = file_records(table, query, predictors, policy)
    records: pl.DataFrame | None = None
    if served is not None:
        records, facts = served
        n_frame, n_valid = facts.n_frame, facts.n_valid.get(query.outcome.name, 0)
        se_method = "none"
        by_predictor = (
            {}
            if query.pooled
            else country_rows(
                records, predictors, facts.countries, stat=stat, weight=spec.weight, policy=policy
            )
        )
    else:
        assembled = assemble_correlates_frame(store, query, predictors)
        n_frame = assembled.frame.height
        n_valid = assembled.frame[assembled.value].drop_nulls().len()
        se_method = assembled.design.se_method if query.adjusted else "none"
        if query.pooled:
            # Each country on its own, then their plain average (ADR-0020).
            groups = [*assembled.groups, COUNTRY]
            records = correlation_records(
                weighted_correlations(
                    assembled.frame,
                    assembled.value,
                    [p.name for p in predictors],
                    assembled.design,
                    method="spearman" if query.method == "spearman" else "pearson",
                    by=groups,
                    policy=policy,
                ),
                list(assembled.groups),
            )
            by_predictor = {}
        else:
            by_predictor = estimate_rows(assembled, query, predictors, policy)
    if query.pooled:
        assert records is not None
        by_predictor, countries = averaged_rows(
            records,
            [p.name for p in predictors],
            query.by,
            stat=stat,
            weight=spec.weight,
            policy=policy,
            min_n=min_n,
        )
    estimated = list(by_predictor.items())
    n_excluded = 0
    dropped: dict[str, str] = {}
    if not query.against:
        # A candidate with too few complete cases in every group is not
        # ranked at all; the rest rank on their qualifying groups.
        ranked = [item for item in estimated if rankable(item[1], query.adjusted, min_n)]
        n_excluded = len(estimated) - len(ranked)
        ranked.sort(key=lambda item: (-rank_key(item[1], query.adjusted, min_n), item[0]))
        infos = {p.name: p for p in predictors}
        estimated, dropped = drop_overlaps(ranked, infos, query.limit)
    rows = [row for _, predictor_rows in estimated for row in predictor_rows]
    meta = ResponseMeta(
        data_version=store.data_version,
        outcome=query.outcome.name,
        scale_type=query.outcome.scale_type,
        direction=query.outcome.direction,
        stat=stat,
        waves=[query.wave],
        scope="global",
        oriented=False,
        weight_key=spec.key,
        weight=spec.weight,
        se_method=se_method,
        ci_level=0.95,
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=n_frame,
        n_valid=n_valid,
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
        min_n=min_n,
        n_excluded=n_excluded,
        dropped_overlap=dropped,
        **averaged_meta(query.pooled, countries),
        **midyear_meta(
            query.wave,
            query.other_wave,
            [query.outcome.name, *(name for name, _ in estimated)],
            {query.outcome.name: query.outcome, **{p.name: p for p in predictors}},
        ),
    )
    return EstimateResponse(meta=meta, rows=rows)


def averaged_meta(pooled: bool, countries: list[int]) -> dict[str, Any]:
    """What an average over the countries says about itself (ADR-0020):
    ``average``, and every country in at least one of its averages;
    nothing for any other response."""
    if not pooled:
        return {}
    return {"pooled": "average", "countries": countries}


@router.get("/correlates", summary="What travels with an outcome: ranked associations")
def correlates(
    # First, so a refused adjusted request costs nothing (ADR-0018).
    adjusted: Annotated[bool, Depends(adjusted_gate)],
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    min_n: Annotated[int, Depends(correlates_min_n)],
    table: Annotated[CountryCorrelations | None, Depends(country_correlations)],
    outcome: str,
    wave: str,
    against: Annotated[list[str] | None, Query()] = None,
    method: str = "pearson",
    by: Annotated[list[str] | None, Query()] = None,
    filter: Annotated[list[str] | None, Query()] = None,
    limit: int = CORRELATES_DEFAULT_LIMIT,
    pooled: Annotated[
        str | None,
        Query(
            description=(
                "average: each country's own estimate, and their plain average — every "
                "country counts the same (ADR-0020) — in place of a country filter."
            )
        ),
    ] = None,
    other_wave: Annotated[
        str | None,
        Query(
            description=(
                "At wave=MY: Y1 (default) or Y2 — the wave every question the midyear "
                "survey did not ask reads the same people's answers from (ADR-0020)."
            )
        ),
    ] = None,
) -> EstimateResponse:
    """Associations, not causes. Rows are weighted Pearson or Spearman
    coefficients with no interval (``ci_method = "none"``). Omit
    ``against`` for the ranked sweep over every other servable ordered
    item at the wave, cut to ``limit`` predictors (ranked by the median
    absolute association across the groups with at least ``meta.min_n``
    complete cases; ``meta.n_excluded`` candidates fell below it and are
    not ranked). Of two kept predictors built from the same answers only
    the one built from more of them stays (a score over its questions; on
    a tie, a score over its screen-positive flag); the list backfills to
    ``limit`` and ``meta.dropped_overlap`` names what was left out, and
    what stands in for it. Binary items enter as indicators of code 1
    (Yes / screen positive). Global scope only.

    ``pooled=average`` — in place of a country filter — takes each
    country's own correlation and their plain mean: every country counts
    the same, and one with no estimate (it did not ask a question) drops
    out. Each row's ``n`` is the complete cases summed over the countries
    in its average (the ranking floor reads it), ``n_countries`` counts
    them, and ``flagged`` says every one of them rests on fewer than
    ``meta.min_n`` people; ``meta.countries`` lists every country in at
    least one average. The dedupe is unchanged.

    At ``wave=MY`` a midyear question reads its midyear answers and any
    other question the same respondents' ``other_wave`` answers (Y1 by
    default: every midyear respondent, ``w_l1m``; Y2: those who also did
    Wave 2, ``w_l1m2``); ``meta.answer_waves`` says which. A midyear
    outcome is ranked against every midyear question and every question
    asked at ``other_wave``; any other outcome against the midyear
    questions only. Two questions neither of which the midyear survey
    asked belong at their own wave: 422.

    ``adjusted=true`` — the predictor's coefficient in a survey-weighted
    regression under the fixed control set (``stat = "beta"``, plus a
    ``beta_per_sd`` row) with a design-based CI — is disabled unless the
    server enables it (``FA_ADJUSTED_ENABLED``); otherwise it is a 422."""
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
        pooled=pooled,
        other_wave=other_wave,
    )
    if query.adjusted and query.pooled:
        raise HTTPException(
            status_code=422,
            detail=["pooled=average serves plain correlations; drop adjusted=true"],
        )
    return run_correlates(store, query, policy, min_n, table)
