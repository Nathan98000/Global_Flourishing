"""GET /v1/correlations/pair — two questions side by side (ADR-0018).

The Correlates page's "Compare two" view: the weighted correlation of
two ordered items in one country, and the outcome Y's weighted mean in
each group of the other item X — the /v1/aggregate estimator, grouped by
X, with the same design, weight and SE. X's groups are its answers (up
to eleven) or, for a long scale, equal-width bins between its weighted
1st and 99th percentiles; they run in X's aligned order, so a positive
correlation slopes up. Only group means are served — never a
respondent's answers — and a group resting on fewer than the ranking
floor's people is flagged, not dropped.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Annotated

import polars as pl
from fastapi import APIRouter, Depends, Query
from flourish_stats import (
    Design,
    SuppressionPolicy,
    weighted_correlation,
    weighted_mean,
    weighted_quantile,
)
from flourish_stats.outcomes import DERIVED_OUTCOMES

from flourish_api.data import (
    Catalog,
    DataStore,
    VariableInfo,
    correlates_min_n,
    require_data,
    suppression_policy,
)
from flourish_api.frames import (
    BINARY_EVENT_CODE,
    PAIR_X,
    PAIR_Y,
    PAIR_Y_ALIGNED,
    assemble_pair_frame,
)
from flourish_api.queries import PairQuery, parse_pair_query
from flourish_api.schemas import (
    EstimateResponse,
    EstimateRow,
    PairGroupModel,
    PairResponse,
    ResponseMeta,
    SuppressionModel,
)
from flourish_api.serialize import rows_from_table

router = APIRouter()

#: X is grouped by its answers when it has at most this many.
MAX_ANSWER_GROUPS = 11
#: A longer scale is cut into this many equal-width bins.
BINS = 10
#: The percentiles the bins run between; the end bins take in the tails.
BIN_RANGE = (0.01, 0.99)
GROUP_COLUMN = "_group"


@dataclass(frozen=True)
class Group:
    """One group of X: the value of the group column, the answer's code
    (or the bin's index), its label, and what the means rows carry."""

    key: int
    code: int
    label: str
    value: int | str


def is_continuous(info: VariableInfo) -> bool:
    """A derived 0–10 score is a mean of answers — not whole numbers."""
    return info.is_derived and DERIVED_OUTCOMES[info.name].scale_type == "scale_0_10"


def answer_levels(info: VariableInfo) -> list[int] | None:
    """X's aligned levels, lowest first, when it is grouped by its
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


def answer_labels(catalog: Catalog, info: VariableInfo, wave: str, country: int) -> dict[int, str]:
    """Each code's short label (the curated one when set, else the
    codebook's), the wave's and the country's own where they differ."""
    rows = catalog.value_labels.filter(
        (pl.col("variable") == info.name) & ~pl.col("is_nonresponse")
    )
    # (An all-null column can arrive typed as a number: compare as text.)
    rows = rows.filter(
        (pl.col("wave").is_null() | (pl.col("wave").cast(pl.Utf8) == wave))
        & (pl.col("country_code").is_null() | (pl.col("country_code") == country))
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
    """How an answer is named on the axis: a number on a 0–10 or count
    scale, the answer's own words otherwise (No / Yes for a derived
    screen)."""
    if info.scale_type in ("scale_0_10", "count"):
        return str(code)
    if info.is_derived and info.scale_type == "binary":
        return "Yes" if code == 1 else "No"
    return labels.get(code, str(code))


def _number(value: float) -> str:
    return f"{value:.1f}"


def bin_groups(frame: pl.DataFrame, design: Design, integer: bool) -> tuple[pl.Expr, list[Group]]:
    """Equal-width bins of X between its weighted 1st and 99th percentiles
    (R ``svyquantile``'s rule), the end bins taking in the tails. An item
    in whole numbers gets whole-number-wide bins — at most ten, so none is
    empty by construction; a derived score gets exactly ten. Each bin is
    labelled by its range; an end bin that took in a tail says so."""
    complete = frame.filter(pl.col(PAIR_X).is_not_null())
    if complete.is_empty():
        return pl.lit(None, dtype=pl.Int64), []
    quantiles = weighted_quantile(complete, PAIR_X, design, p=BIN_RANGE).to_pylist()
    lo, hi = (float(row["estimate"]) for row in quantiles)
    observed_lo = float(complete[PAIR_X].min())  # type: ignore[arg-type]
    observed_hi = float(complete[PAIR_X].max())  # type: ignore[arg-type]
    x = pl.col(PAIR_X)
    if integer:
        start, stop = round(lo), round(hi)
        width = max(1, math.ceil((stop - start + 1) / BINS))
        count = math.ceil((stop - start + 1) / width)
        index = ((x - start) / width).floor().clip(0, count - 1)
        groups: list[Group] = []
        for k in range(count):
            first, last = start + k * width, start + (k + 1) * width - 1
            label = str(first) if width == 1 else f"{first}–{last}"
            if k == count - 1 and observed_hi > last:
                label = f"{first} or more"
            elif k == 0 and observed_lo < start:
                label = f"{last} or less"
            groups.append(Group(key=k, code=k, label=label, value=label))
        return pl.when(x.is_null()).then(None).otherwise(index).cast(pl.Int64), groups
    if hi <= lo:
        label = _number(lo)
        return pl.when(x.is_null()).then(None).otherwise(pl.lit(0)).cast(pl.Int64), [
            Group(key=0, code=0, label=label, value=label)
        ]
    width = (hi - lo) / BINS
    index = ((x - lo) / width).floor().clip(0, BINS - 1)
    edges = [lo + k * width for k in range(BINS + 1)]
    groups = []
    for k in range(BINS):
        label = f"{_number(edges[k])}–{_number(edges[k + 1])}"
        if k == 0 and observed_lo < lo:
            label = f"below {_number(edges[1])}"
        elif k == BINS - 1 and observed_hi > hi:
            label = f"{_number(edges[k])} and above"
        groups.append(Group(key=k, code=k, label=label, value=label))
    return pl.when(x.is_null()).then(None).otherwise(index).cast(pl.Int64), groups


def x_groups(
    store: DataStore, query: PairQuery, frame: pl.DataFrame, design: Design
) -> tuple[pl.Expr, list[Group], str]:
    """X's groups, lowest aligned value first: its answers, or bins."""
    assert store.catalog is not None
    info = query.x
    levels = answer_levels(info)
    if levels is None:
        expression, groups = bin_groups(frame, design, integer=not is_continuous(info))
        return expression, groups, "bins"
    labels = answer_labels(store.catalog, info, query.wave, query.countries[0])
    answers: list[Group] = []
    for level in levels:
        code = code_of(info, level)
        answers.append(
            Group(key=level, code=code, label=level_label(info, code, labels), value=code)
        )
    expression = pl.col(PAIR_X).round(0).cast(pl.Int64)
    return expression, answers, "answers"


def empty_row(
    group: dict[str, int | str], stat: str, design: Design, policy: SuppressionPolicy
) -> EstimateRow:
    """A group nobody in the frame gave: shown, with n = 0 (ADR-0011)."""
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


def run_pair(
    store: DataStore, query: PairQuery, policy: SuppressionPolicy, min_n: int
) -> PairResponse:
    assembled = assemble_pair_frame(store, query)
    frame, design = assembled.frame, assembled.design
    expression, groups, grouping = x_groups(store, query, frame, design)
    frame = frame.with_columns(expression.alias(GROUP_COLUMN))

    correlation = rows_from_table(
        weighted_correlation(
            frame,
            PAIR_X,
            PAIR_Y_ALIGNED,
            design,
            method="spearman" if query.method == "spearman" else "pearson",
            policy=policy,
        ),
        [],
    )[0].model_copy(update={"predictor": query.x.name})

    # A yes/no Y's mean is the share answering yes: say so in the stat.
    stat = "proportion" if query.y.scale_type == "binary" else "mean"
    estimated = {
        row.group[GROUP_COLUMN]: row
        for row in rows_from_table(
            weighted_mean(frame, PAIR_Y, design, by=[GROUP_COLUMN], policy=policy),
            [GROUP_COLUMN],
        )
        if row.group[GROUP_COLUMN] is not None
    }
    rows: list[EstimateRow] = []
    for group in groups:
        key = {query.x.name: group.value}
        found = estimated.get(group.key)
        rows.append(
            found.model_copy(update={"group": key, "stat": stat})
            if found is not None
            else empty_row(key, stat, design, policy)
        )
    total = sum(row.sum_w for row in rows)
    meta = ResponseMeta(
        data_version=store.data_version,
        outcome=query.y.name,
        scale_type=query.y.scale_type,
        direction=query.y.direction,
        stat=stat,
        waves=[query.wave],
        scope="global",
        oriented=False,
        weight_key=assembled.spec.key,
        weight=assembled.spec.weight,
        se_method=design.se_method,
        ci_level=0.95,
        suppression=SuppressionModel(threshold=policy.threshold, flag_below=policy.flag_below),
        n_frame=frame.height,
        n_valid=frame[PAIR_Y].drop_nulls().len(),
        by=[query.x.name],
        filters={
            "country_code": list(query.countries),
            **{item.column: list(item.values) for item in query.filters},
        },
        min_n=min_n,
    )
    return PairResponse(
        x=query.x.name,
        grouping=grouping,
        correlation=correlation,
        means=EstimateResponse(meta=meta, rows=rows),
        groups=[
            PairGroupModel(
                code=group.code,
                label=group.label,
                share=row.sum_w / total if total > 0 else 0.0,
                below_min_n=row.n < min_n,
            )
            for group, row in zip(groups, rows, strict=True)
        ],
    )


@router.get(
    "/correlations/pair",
    summary="Two questions side by side: their correlation and Y's mean by X",
)
def correlation_pair(
    store: Annotated[DataStore, Depends(require_data)],
    policy: Annotated[SuppressionPolicy, Depends(suppression_policy)],
    min_n: Annotated[int, Depends(correlates_min_n)],
    y: Annotated[str, Query(description="The outcome: its weighted mean is taken per group of x.")],
    x: Annotated[
        str, Query(description="The question compared with: its answers (or bins) group y.")
    ],
    wave: str,
    filter: Annotated[
        list[str] | None,
        Query(description="Exactly one country_code:N, plus optional demographic domains."),
    ] = None,
    method: Annotated[str, Query(description="pearson (default) or spearman.")] = "pearson",
) -> PairResponse:
    """Associations, not causes. Both items must be ordered (a 0–10 scale,
    an ordered or yes/no answer, a count) and asked at the wave, and must
    not be built from the same answers (a score and its own question go
    together by construction: 422). ``correlation`` is the weighted
    Pearson or Spearman coefficient over the people who answered both —
    the same number /v1/correlates reports for the pair, with no interval.
    ``means`` is y's weighted mean in each group of x with its
    design-based CI (the /v1/aggregate estimator, ``by = [x]``); a yes/no
    y is its share answering yes. x's groups are its answers when it has
    at most eleven, else equal-width bins between its weighted 1st and
    99th percentiles (whole-number-wide for an item counted in whole
    numbers), the end bins taking in the tails; they run from least to
    most of what x's label names, so a positive correlation slopes up.
    ``groups`` carries each group's label, its weighted share of those
    people, and whether fewer than ``means.meta.min_n`` of them are in it
    (flagged, never dropped)."""
    assert store.catalog is not None
    query = parse_pair_query(
        store.catalog, y=y, x=x, wave=wave, method=method, filters=filter or []
    )
    return run_pair(store, query, policy, min_n)
