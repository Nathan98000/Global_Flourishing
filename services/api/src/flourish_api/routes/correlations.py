"""GET /v1/correlations/pair and /v1/correlations — questions side by side (ADR-0018, ADR-0019).

The Correlates page's "Compare two" view: two ordered items in one
country as a weighted cross-tab. Each column is one of x's answers; each
cell is the weighted share of that column's people who gave the row's
answer to y, so every column adds to 1; beside them, the weighted share
of the people who answered both who gave each of x's answers, and the two
items' weighted correlation. An item's levels are its answers (up to
eleven) or, for a longer scale, equal-width bins between its weighted 1st
and 99th percentiles, on either axis; both run in the item's aligned
order (least to most of what its label names, ADR-0015). The shares are
the /v1/aggregate proportion estimator grouped by x — same design, weight
and SE — and only shares are served, never a respondent's answers. A cell
resting on few people is flagged, never dropped (ADR-0019).

The "Compare several" view's table: every pair among 2–10 ordered items
in one country, each row's correlations taken in one pass over the frame
(``weighted_correlations``); a pair built from the same answers is marked
and never estimated.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Annotated, Any

import polars as pl
from fastapi import APIRouter, Depends, Query
from flourish_stats import (
    Design,
    SuppressionPolicy,
    average_countries,
    weighted_correlation,
    weighted_correlations,
    weighted_proportion,
    weighted_quantile,
)
from flourish_stats.averaging import COUNTRY
from flourish_stats.outcomes import DERIVED_OUTCOMES

from flourish_api.country_correlations import CountryCorrelations
from flourish_api.data import (
    Catalog,
    DataStore,
    PairFlags,
    VariableInfo,
    correlates_min_n,
    country_correlations,
    pair_flags,
    require_data,
    suppression_policy,
)
from flourish_api.frames import (
    BINARY_EVENT_CODE,
    PAIR_X,
    PAIR_Y_ALIGNED,
    assemble_matrix_frame,
    assemble_pair_frame,
    correlation_spec,
)
from flourish_api.queries import (
    MatrixQuery,
    PairQuery,
    parse_matrix_query,
    parse_pair_query,
    shares_answers,
)
from flourish_api.routes.correlates import (
    averaged_meta,
    averaged_rows,
    correlation_records,
    midyear_meta,
)
from flourish_api.schemas import (
    CorrelationPairModel,
    CorrelationsMeta,
    CorrelationsResponse,
    EstimateResponse,
    EstimateRow,
    PairCellModel,
    PairColumnModel,
    PairLevelModel,
    PairResponse,
    ResponseMeta,
    SuppressionModel,
)
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: An item is grouped by its answers when it has at most this many.
MAX_ANSWER_GROUPS = 11
#: A longer scale is cut into this many equal-width bins.
BINS = 10
#: The percentiles the bins run between; the end bins take in the tails.
BIN_RANGE = (0.01, 0.99)
#: The cross-tab's group columns: x's level (the columns), y's (the rows).
COLUMN = "_column"
ROW = "_row"


@dataclass(frozen=True)
class Group:
    """One level of an item: the value of its group column, the answer's
    code (or the bin's index), its label, and what the shares rows carry
    for it (the code; a bin's label)."""

    key: int
    code: int
    label: str
    value: int | str


def is_continuous(info: VariableInfo) -> bool:
    """A derived 0–10 score is a mean of answers — not whole numbers."""
    return info.is_derived and DERIVED_OUTCOMES[info.name].scale_type == "scale_0_10"


def answer_levels(info: VariableInfo) -> list[int] | None:
    """An item's aligned levels, lowest first, when it is grouped by its
    answers; None when it is binned. A yes/no item is its indicator
    (0 = no, 1 = yes)."""
    if info.scale_type == "binary":
        return [0, 1]
    if is_continuous(info) or info.min is None or info.max is None:
        return None
    if info.max - info.min + 1 > MAX_ANSWER_GROUPS:
        return None
    return list(range(info.min, info.max + 1))


def code_of(info: VariableInfo, level: int) -> int:
    """The code an aligned level stands for, as the release codes it."""
    if info.scale_type == "binary":
        if info.is_derived:
            return level
        assert info.min is not None and info.max is not None
        other = info.min + info.max - BINARY_EVENT_CODE
        return BINARY_EVENT_CODE if level == 1 else other
    if info.polarity == "descending":
        assert info.min is not None and info.max is not None
        return info.min + info.max - level
    return level


def answer_labels(
    catalog: Catalog, info: VariableInfo, wave: str, country: int | None
) -> dict[int, str]:
    """Each code's short label (the curated one when set, else the
    codebook's), the wave's and the country's own where they differ — a
    pooled pair (no one country) reads the labels every country shares."""
    rows = catalog.value_labels.filter(
        (pl.col("variable") == info.name) & ~pl.col("is_nonresponse")
    )
    # (An all-null column can arrive typed as a number: compare as text.)
    in_country = (
        pl.col("country_code").is_null()
        if country is None
        else pl.col("country_code").is_null() | (pl.col("country_code") == country)
    )
    rows = rows.filter(
        (pl.col("wave").is_null() | (pl.col("wave").cast(pl.Utf8) == wave)) & in_country
    )
    labels: dict[int, str] = {}
    # General rows first, so a wave's or a country's own label wins.
    ranked = sorted(
        rows.iter_rows(named=True),
        key=lambda row: (row["country_code"] is not None, row["wave"] is not None),
    )
    for row in ranked:
        short = row.get("short_label")
        labels[int(row["code"])] = str(short or row["label"])
    return labels


def level_label(info: VariableInfo, code: int, labels: dict[int, str]) -> str:
    """How an answer is named on an axis: a number on a 0–10 or count
    scale, the answer's own words otherwise (No / Yes for a derived
    screen)."""
    if info.scale_type in ("scale_0_10", "count"):
        return str(code)
    if info.is_derived and info.scale_type == "binary":
        return "Yes" if code == 1 else "No"
    return labels.get(code, str(code))


def _number(value: float) -> str:
    return f"{value:.1f}"


def bin_groups(
    frame: pl.DataFrame, column: str, design: Design, integer: bool
) -> tuple[pl.Expr, list[Group]]:
    """Equal-width bins of ``column`` between its weighted 1st and 99th
    percentiles (R ``svyquantile``'s rule), the end bins taking in the
    tails. An item in whole numbers gets whole-number-wide bins — at most
    ten, so none is empty by construction; a derived score gets exactly
    ten. Each bin is labelled by its range; an end bin that took in a
    tail says so."""
    complete = frame.filter(pl.col(column).is_not_null())
    if complete.is_empty():
        return pl.lit(None, dtype=pl.Int64), []
    quantiles = weighted_quantile(complete, column, design, p=BIN_RANGE).to_pylist()
    lo, hi = (float(row["estimate"]) for row in quantiles)
    observed_lo = float(complete[column].min())  # type: ignore[arg-type]
    observed_hi = float(complete[column].max())  # type: ignore[arg-type]
    value = pl.col(column)
    if integer:
        start, stop = round(lo), round(hi)
        width = max(1, math.ceil((stop - start + 1) / BINS))
        count = math.ceil((stop - start + 1) / width)
        index = ((value - start) / width).floor().clip(0, count - 1)
        groups: list[Group] = []
        for k in range(count):
            first, last = start + k * width, start + (k + 1) * width - 1
            label = str(first) if width == 1 else f"{first}–{last}"
            if k == count - 1 and observed_hi > last:
                label = f"{first} or more"
            elif k == 0 and observed_lo < start:
                label = f"{last} or less"
            groups.append(Group(key=k, code=k, label=label, value=label))
        return pl.when(value.is_null()).then(None).otherwise(index).cast(pl.Int64), groups
    if hi <= lo:
        label = _number(lo)
        return pl.when(value.is_null()).then(None).otherwise(pl.lit(0)).cast(pl.Int64), [
            Group(key=0, code=0, label=label, value=label)
        ]
    width = (hi - lo) / BINS
    index = ((value - lo) / width).floor().clip(0, BINS - 1)
    edges = [lo + k * width for k in range(BINS + 1)]
    groups = []
    for k in range(BINS):
        label = f"{_number(edges[k])}–{_number(edges[k + 1])}"
        if k == 0 and observed_lo < lo:
            label = f"below {_number(edges[1])}"
        elif k == BINS - 1 and observed_hi > hi:
            label = f"{_number(edges[k])} and above"
        groups.append(Group(key=k, code=k, label=label, value=label))
    return pl.when(value.is_null()).then(None).otherwise(index).cast(pl.Int64), groups


def axis_groups(
    store: DataStore,
    query: PairQuery,
    info: VariableInfo,
    frame: pl.DataFrame,
    column: str,
    design: Design,
) -> tuple[pl.Expr, list[Group], str]:
    """One item's levels, least to most of what its label names: its
    answers, or bins of its aligned values in ``column``."""
    assert store.catalog is not None
    levels = answer_levels(info)
    if levels is None:
        expression, groups = bin_groups(frame, column, design, integer=not is_continuous(info))
        return expression, groups, "bins"
    labels = answer_labels(
        store.catalog, info, query.wave, query.countries[0] if query.countries else None
    )
    answers: list[Group] = []
    for level in levels:
        code = code_of(info, level)
        answers.append(
            Group(key=level, code=code, label=level_label(info, code, labels), value=code)
        )
    expression = pl.col(column).round(0).cast(pl.Int64)
    return expression, answers, "answers"


def empty_row(
    group: dict[str, int | str], stat: str, design: Design, policy: SuppressionPolicy
) -> EstimateRow:
    """A cell of a column nobody in the frame is in: shown, with n = 0
    and no share (ADR-0011)."""
    return EstimateRow(
        group={**group},
        stat=stat,
        estimate=None,
        se=None,
        ci_lo=None,
        ci_hi=None,
        ci_level=0.95,
        ci_method="normal",
        n=0,
        sum_w=0.0,
        n_psu=None,
        n_strata=None,
        df=None,
        se_method=design.se_method,
        weight=design.weight,
        suppressed=policy.threshold > 0,
        flagged=policy.threshold <= 0 < policy.flag_below,
    )


def averaged_share(
    average: dict[str, Any], *, design: Design, policy: SuppressionPolicy, level: int | None
) -> EstimateRow:
    """A share's plain average over the countries (ADR-0020) as an estimator
    row: the mean of the countries' shares, SE √(Σ se²) / K with its normal
    interval, ``n`` summed over the countries in it and ``n_countries`` of
    them (the serving policy applied to the summed n)."""
    n = int(average["n"])
    suppressed = n < policy.threshold
    shown = {
        key: None if suppressed else average[key] for key in ("estimate", "se", "ci_lo", "ci_hi")
    }
    return EstimateRow(
        group={},
        level=level,
        stat="proportion",
        **shown,
        ci_level=0.95,
        ci_method="normal",
        n=n,
        sum_w=float(average["sum_w"]),
        n_psu=None,
        n_strata=None,
        df=None,
        se_method=design.se_method,
        weight=design.weight,
        suppressed=suppressed,
        flagged=not suppressed and n < policy.flag_below,
        n_countries=int(average["n_countries"]),
    )


def _frame(table: object) -> pl.DataFrame:
    frame = pl.from_arrow(table)  # type: ignore[arg-type]
    assert isinstance(frame, pl.DataFrame)
    return frame


def _share_records(table: object, groups: list[str]) -> pl.DataFrame:
    """A proportion table's rows as averaging records (``average_countries``)."""
    return _frame(table).select(*groups, "level", "estimate", "se", "n", "sum_w")


def run_pair(
    store: DataStore,
    query: PairQuery,
    policy: SuppressionPolicy,
    flags: PairFlags,
    min_n: int,
) -> PairResponse:
    assembled = assemble_pair_frame(store, query)
    frame, design = assembled.frame, assembled.design
    x_expression, columns, x_grouping = axis_groups(store, query, query.x, frame, PAIR_X, design)
    y_expression, rows, y_grouping = axis_groups(
        store, query, query.y, frame, PAIR_Y_ALIGNED, design
    )
    frame = frame.with_columns(x_expression.alias(COLUMN), y_expression.alias(ROW))
    method = "spearman" if query.method == "spearman" else "pearson"
    x_levels = [group.key for group in columns]
    y_levels = [group.key for group in rows]
    countries: list[int] = []

    if not query.pooled:
        correlation = rows_from_table(
            weighted_correlation(
                frame, PAIR_X, PAIR_Y_ALIGNED, design, method=method, policy=policy
            ),
            [],
        )[0].model_copy(update={"predictor": query.x.name})
        # Who gave each of x's answers (among those who answered both) ...
        column_rows = {
            row.level: row
            for row in rows_from_table(
                weighted_proportion(frame, COLUMN, design, levels=x_levels, policy=policy), []
            )
        }
        # ... and, within each such column, each of y's.
        cell_rows = {
            (row.group[COLUMN], row.level): row
            for row in rows_from_table(
                weighted_proportion(
                    frame, ROW, design, by=[COLUMN], levels=y_levels, policy=policy
                ),
                [COLUMN],
            )
            if row.group[COLUMN] is not None
        }
    else:
        # All countries (ADR-0020): each country on its own, then the plain
        # mean — of the correlations; of the shares who gave each of x's
        # answers, over the countries with people who answered both; and of
        # each column's shares, over the countries with people in that
        # column (a country where nobody gave the column's answer drops
        # out of it, so every column still adds to 100%).
        correlations = _frame(
            weighted_correlation(
                frame, PAIR_X, PAIR_Y_ALIGNED, design, method=method, by=[COUNTRY], policy=policy
            )
        )
        averaged, _ = averaged_rows(
            correlations.select(
                pl.lit(query.x.name).alias("predictor"), COUNTRY, "estimate", "se", "n", "sum_w"
            ),
            [query.x.name],
            [],
            stat=f"{method}_r",
            weight=design.weight,
            policy=policy,
            min_n=min_n,
        )
        correlation = averaged[query.x.name][0]
        bars = average_countries(
            _share_records(
                weighted_proportion(
                    frame, COLUMN, design, by=[COUNTRY], levels=x_levels, policy=policy
                ),
                [COUNTRY],
            ),
            ["level"],
        )
        column_rows = {
            int(average["level"]): averaged_share(
                average, design=design, policy=policy, level=int(average["level"])
            )
            for average in bars.iter_rows(named=True)
        }
        countries = sorted(
            {int(code) for average in bars.iter_rows(named=True) for code in average["countries"]}
        )
        within = _share_records(
            weighted_proportion(
                frame, ROW, design, by=[COUNTRY, COLUMN], levels=y_levels, policy=policy
            ),
            [COUNTRY, COLUMN],
        ).filter(pl.col(COLUMN).is_not_null())
        cell_rows = {
            (average[COLUMN], int(average["level"])): averaged_share(
                average, design=design, policy=policy, level=int(average["level"])
            )
            for average in average_countries(within, [COLUMN, "level"]).iter_rows(named=True)
        }

    column_models: list[PairColumnModel] = []
    cells: list[PairCellModel] = []
    shares: list[EstimateRow] = []
    for column in columns:
        found = column_rows.get(column.key)
        column_n = found.n if found is not None else 0
        column_models.append(
            PairColumnModel(
                code=column.code,
                label=column.label,
                share=(found.estimate or 0.0) if found is not None else 0.0,
                ci_lo=found.ci_lo if found is not None else None,
                ci_hi=found.ci_hi if found is not None else None,
                n=column_n,
                flagged=column_n < flags.column,
            )
        )
        for row in rows:
            key = {query.x.name: column.value, query.y.name: row.value}
            cell = cell_rows.get((column.key, row.key))
            estimate = (
                cell.model_copy(update={"group": key, "level": None})
                if cell is not None
                else empty_row(key, "proportion", design, policy)
            )
            if query.pooled and cell is None:
                estimate = estimate.model_copy(update={"n_countries": 0})
            shares.append(estimate)
            cells.append(
                PairCellModel(
                    x=column.code,
                    y=row.code,
                    share=estimate.estimate,
                    n=estimate.n,
                    flagged=estimate.n < flags.cell or column_n < flags.column,
                )
            )

    meta = ResponseMeta(
        data_version=store.data_version,
        outcome=query.y.name,
        scale_type=query.y.scale_type,
        direction=query.y.direction,
        stat="proportion",
        waves=[query.wave],
        scope="global",
        oriented=False,
        weight_key=assembled.spec.key,
        weight=assembled.spec.weight,
        se_method=design.se_method,
        ci_level=0.95,
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=frame.height,
        # Everyone who answered both questions.
        n_valid=frame[ROW].drop_nulls().len(),
        by=[query.x.name, query.y.name],
        filters={
            **({"country_code": list(query.countries)} if query.countries else {}),
            **{item.column: list(item.values) for item in query.filters},
        },
        **averaged_meta(query.pooled, countries),
        **midyear_meta(
            query.wave,
            query.other_wave,
            [query.x.name, query.y.name],
            {query.x.name: query.x, query.y.name: query.y},
        ),
    )
    return PairResponse(
        x=query.x.name,
        y=query.y.name,
        x_grouping=x_grouping,
        y_grouping=y_grouping,
        correlation=correlation,
        min_n=min_n,
        columns=column_models,
        rows=[PairLevelModel(code=row.code, label=row.label) for row in rows],
        cells=cells,
        shares=EstimateResponse(meta=meta, rows=shares),
        cell_flag_below=flags.cell,
        column_flag_below=flags.column,
    )


@router.get(
    "/correlations/pair",
    summary="Two questions side by side: a weighted cross-tab and their correlation",
)
def correlation_pair(
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    flags: Annotated[PairFlags, Depends(pair_flags)],
    min_n: Annotated[int, Depends(correlates_min_n)],
    y: Annotated[str, Query(description="The question on the rows.")],
    x: Annotated[str, Query(description="The question on the columns.")],
    wave: str,
    filter: Annotated[
        list[str] | None,
        Query(
            description=(
                "Exactly one country_code:N (none when pooled), plus optional demographic domains."
            )
        ),
    ] = None,
    method: Annotated[str, Query(description="pearson (default) or spearman.")] = "pearson",
    pooled: Annotated[
        str | None,
        Query(
            description=(
                "average: each country's own cross-tab and correlation, and their plain "
                "average (ADR-0020), in place of the country filter."
            )
        ),
    ] = None,
    other_wave: Annotated[
        str | None,
        Query(description="At wave=MY: Y1 (default) or Y2 — as /v1/correlates (ADR-0020)."),
    ] = None,
) -> PairResponse:
    """Both items must be ordered (a 0–10 scale, an ordered or yes/no
    answer, a count), asked at the wave and not built from the same
    answers (a score and its own question go together by construction:
    422). ``columns`` are x's answers (its levels: up to eleven answers,
    else ten equal-width bins between its weighted 1st and 99th
    percentiles, the end bins taking in the tails), each with the weighted
    share of the people who answered both who gave it; ``rows`` are y's,
    levelled the same way; both run from least to most of what the item's
    label names. ``cells`` gives, column by column, the weighted share of
    the column's people who gave each row's answer — every column adds to
    1 — and ``shares`` the same cells as estimate rows with their
    design-based CIs (the /v1/aggregate proportion estimator grouped by
    x). A cell is ``flagged`` when fewer than ``cell_flag_below`` people
    gave that pair of answers or its column holds fewer than
    ``column_flag_below`` (flagged, never withheld). ``correlation`` is the
    weighted Pearson or Spearman coefficient over the people who answered
    both — the number /v1/correlates reports for the pair, with no
    interval. ``pooled=average`` takes each country on its own and their
    plain mean: of the correlations (``correlation.n_countries`` counts
    the countries in it; ``flagged`` when every one rests on fewer than
    ``min_n`` people), of the shares who gave each of x's answers, and of
    each column's shares over the countries with people in that column —
    so every column still adds to 1 — each with SE √(Σ se²) / K and a
    normal interval, and ``n`` summed over the countries (the flags read
    it); ``shares.meta.countries`` lists the countries with people who
    answered both. At ``wave=MY`` one question at least must be a midyear
    question; the other reads its midyear answers or the same people's
    ``other_wave`` answers (``shares.meta.answer_waves``)."""
    assert store.catalog is not None
    query = parse_pair_query(
        store.catalog,
        y=y,
        x=x,
        wave=wave,
        method=method,
        filters=filter or [],
        pooled=pooled,
        other_wave=other_wave,
    )
    return run_pair(store, query, policy, flags, min_n)


def similar_order(names: list[str], pairs: list[CorrelationPairModel]) -> list[str]:
    """The table's questions with the ones that go together side by side
    (ADR-0019): average-linkage (UPGMA) hierarchical clustering on the
    distance 1 − |r|. Two questions built from the same answers are at
    distance 0 (they go together by construction); a pair with no
    estimate at 1. Deterministic: of equally close clusters, the ones
    holding the earliest-asked questions merge first, and a merge keeps
    the cluster with the earlier question on the left — so with no
    structure at all, the order is the order asked."""
    index = {name: i for i, name in enumerate(names)}
    distance: dict[tuple[int, int], float] = {}
    for pair in pairs:
        i, j = sorted((index[pair.a], index[pair.b]))
        if pair.shares_answers:
            distance[(i, j)] = 0.0
        elif pair.correlation is None or pair.correlation.estimate is None:
            distance[(i, j)] = 1.0
        else:
            distance[(i, j)] = 1.0 - abs(pair.correlation.estimate)

    def between(left: list[int], right: list[int]) -> float:
        total = sum(distance[(min(i, j), max(i, j))] for i in left for j in right)
        return total / (len(left) * len(right))

    clusters: list[list[int]] = [[i] for i in range(len(names))]
    while len(clusters) > 1:
        best: tuple[float, int, int] | None = None
        for p in range(len(clusters)):
            for q in range(p + 1, len(clusters)):
                key = (round(between(clusters[p], clusters[q]), 12), p, q)
                if best is None or key < best:
                    best = key
        assert best is not None
        _, p, q = best
        merged = clusters[p] + clusters[q]
        clusters = [c for k, c in enumerate(clusters) if k not in (p, q)] + [merged]
        # Clusters stay in the order of their earliest question.
        clusters.sort(key=min)
    return [names[i] for i in clusters[0]] if clusters else []


def run_matrix(
    store: DataStore,
    query: MatrixQuery,
    policy: SuppressionPolicy,
    min_n: int,
    table: CountryCorrelations | None = None,
) -> CorrelationsResponse:
    """Every pair i < j: row i's correlations with the questions after it
    in one engine pass, the pairs built from the same answers left out
    of the pass and marked. All countries: each pair's correlation in each
    country — from the precomputed file when it holds them (ADR-0020) —
    and their plain average."""
    variables = list(query.variables)
    spec = correlation_spec(query.wave, query.other_wave)
    method = "spearman" if query.method == "spearman" else "pearson"
    config = (query.wave, query.other_wave)
    names = [v.name for v in variables]
    served = (
        table
        if table is not None and query.pooled and not query.filters and table.holds(config, names)
        else None
    )
    facts = served.frame(config) if served is not None else None
    assembled = assemble_matrix_frame(store, query) if facts is None else None
    n_frame = facts.n_frame if facts is not None else (assembled.frame.height if assembled else 0)
    estimated: dict[tuple[str, str], EstimateRow] = {}
    countries: set[int] = set()
    for i, a in enumerate(variables[:-1]):
        others = [b.name for b in variables[i + 1 :] if not shares_answers(a, b)]
        if not others:
            continue
        if served is not None:
            records = served.records(config, query.method, a.name, others, policy)
        else:
            assert assembled is not None
            result = weighted_correlations(
                assembled.frame,
                a.name,
                others,
                assembled.design,
                method=method,
                by=[COUNTRY] if query.pooled else [],
                policy=policy,
            )
            if not query.pooled:
                for row in rows_from_table(result, []):
                    assert row.predictor is not None
                    estimated[(a.name, row.predictor)] = row
                continue
            records = correlation_records(result, [])
        averaged, covered = averaged_rows(
            records,
            others,
            [],
            stat=f"{method}_r",
            weight=spec.weight,
            policy=policy,
            min_n=min_n,
        )
        countries.update(covered)
        for b in others:
            estimated[(a.name, b)] = averaged[b][0]
    spec = correlation_spec(query.wave, query.other_wave)
    pairs: list[CorrelationPairModel] = []
    for i, a in enumerate(variables[:-1]):
        for b in variables[i + 1 :]:
            row = estimated.get((a.name, b.name))
            pairs.append(
                CorrelationPairModel(
                    a=a.name,
                    b=b.name,
                    shares_answers=row is None,
                    # An average's asterisk: every country in it below the floor.
                    below_min_n=row is not None
                    and (row.flagged if query.pooled else row.n < min_n),
                    correlation=row,
                )
            )
    meta = CorrelationsMeta(
        data_version=store.data_version,
        vars=[v.name for v in variables],
        wave=query.wave,
        stat=f"{query.method}_r",
        weight_key=spec.key,
        weight=spec.weight,
        ci_level=0.95,
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=n_frame,
        filters={
            **({"country_code": list(query.countries)} if query.countries else {}),
            **{item.column: list(item.values) for item in query.filters},
        },
        min_n=min_n,
        **averaged_meta(query.pooled, sorted(countries)),
        **midyear_meta(
            query.wave,
            query.other_wave,
            [v.name for v in variables],
            {v.name: v for v in variables},
        ),
    )
    names = [v.name for v in variables]
    return CorrelationsResponse(meta=meta, pairs=pairs, similar_order=similar_order(names, pairs))


@router.get("/correlations", summary="A correlation table: every pair among 2–10 questions")
def correlations(
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    min_n: Annotated[int, Depends(correlates_min_n)],
    table: Annotated[CountryCorrelations | None, Depends(country_correlations)],
    names: Annotated[
        list[str],
        Query(
            alias="vars",
            description="2 to 10 ordered questions asked at the wave, repeatable, in table order.",
        ),
    ],
    wave: str,
    filter: Annotated[
        list[str] | None,
        Query(
            description=(
                "Exactly one country_code:N (none when pooled), plus optional demographic domains."
            )
        ),
    ] = None,
    method: Annotated[str, Query(description="pearson (default) or spearman.")] = "pearson",
    pooled: Annotated[
        str | None,
        Query(
            description=(
                "average: each country's own correlations, and their plain average "
                "(ADR-0020), in place of the country filter."
            )
        ),
    ] = None,
    other_wave: Annotated[
        str | None,
        Query(description="At wave=MY: Y1 (default) or Y2 — as /v1/correlates (ADR-0020)."),
    ] = None,
) -> CorrelationsResponse:
    """Associations, not causes. Every pair i < j of the questions named,
    in the order named: the weighted Pearson or Spearman correlation over
    the people who answered both (a point estimate with no interval; the
    number /v1/correlates reports for the pair), its n, and ``below_min_n``
    when fewer than ``meta.min_n`` people answered both. A pair built from
    the same answers (a score and its own question) is marked
    ``shares_answers`` and carries no correlation — it goes together by
    construction. Each row's correlations are taken in one pass over the
    frame. Both items of every pair are aligned to their labels, so the
    signs are the ranked list's. ``similar_order`` lists the questions
    with those that go together side by side: average-linkage clustering
    on 1 − |r| (a pair sharing answers at 0, one with no estimate at 1),
    ties broken toward the order asked. ``pooled=average`` takes each
    pair's correlation in each country and their plain mean: each
    correlation's ``n_countries`` counts the countries in it, ``n`` sums
    their people, ``below_min_n`` says every one rests on fewer than
    ``meta.min_n``, and ``meta.countries`` lists every country in at least
    one. At ``wave=MY`` the table
    holds one midyear question at least; the questions the midyear survey
    did not ask read the same people's ``other_wave`` answers, and every
    pair — two such questions included — is taken on the same people."""
    assert store.catalog is not None
    query = parse_matrix_query(
        store.catalog,
        names=names,
        wave=wave,
        method=method,
        filters=filter or [],
        pooled=pooled,
        other_wave=other_wave,
    )
    return run_matrix(store, query, policy, min_n, table)
