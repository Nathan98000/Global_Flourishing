"""Pydantic response models — the OpenAPI contract the TS client is built from.

The estimate-row model mirrors the engine's common record
(``flourish_stats.RESULT_COLUMNS``) verbatim: every number ships with its
weight, ``se_method``, unweighted n, CI bounds and suppression flags
(CLAUDE.md — numbers never appear without them). The same envelope is
reused by the Phase 3 static exporter so the front end never cares which
tier answered (ADR-0008).
"""

from __future__ import annotations

from pydantic import BaseModel


class HealthResponse(BaseModel):
    """Liveness + build + data identity (`data` is honest: absent in CI images)."""

    status: str
    service: str
    version: str
    git_sha: str | None
    data: str
    data_version: str | None


class CountryModel(BaseModel):
    code: int
    name: str
    iso3: str


class WeightSpecModel(BaseModel):
    """One row of the wave→weight→eligibility table, verbatim."""

    key: str
    scope: str
    waves: list[str]
    weight: str
    kind: str
    requires_retained_y2: bool
    requires_has_midyear: bool
    requires_midyear_type_1: bool
    is_default: bool
    rationale: str
    #: state scopes: the respondents column this weight is calibrated to
    #: (``state`` for Wave 1, ``state_y2`` after it); null globally
    state_column: str | None = None


class SuppressionModel(BaseModel):
    threshold: int
    flag_below: int


class BreakdownLevelModel(BaseModel):
    value: int | str
    label: str


class BreakdownLabelsModel(BaseModel):
    """Display name + ordered levels for one demographic breakdown column
    (from ``flourish_stats.breakdowns`` — the front end owns no copy)."""

    display_name: str
    levels: list[BreakdownLevelModel]


class StateLabelModel(BaseModel):
    """A US state code's display name and member states (a pooled group
    of small states lists several; ``flourish_stats.states``)."""

    name: str
    members: list[str]


class MetaResponse(BaseModel):
    data_version: str | None
    #: Absent from the static tier's meta.json (a build artefact has no
    #: single serving process to identify).
    git_sha: str | None = None
    countries: list[CountryModel]
    waves: list[str]
    weight_table: list[WeightSpecModel]
    suppression: SuppressionModel
    ci_level: float
    breakdowns: list[str]
    breakdown_labels: dict[str, BreakdownLabelsModel]
    families: list[str]
    #: US state codes → display names (the US States view owns no
    #: state name); pooled groups read "A, B & C (pooled)"
    state_labels: dict[str, StateLabelModel]


class VariableSummary(BaseModel):
    name: str
    display_name: str
    label: str | None
    #: exact question wording (None for derived scores) — in the summary
    #: so the codebook searches it over one fetch, offline included
    wording: str | None
    family: str
    #: the family's subtopic code (the picker's second step — ADR-0016);
    #: None where a family has none. Codes only: the display names are
    #: navigation copy in the client, like the topic names.
    subfamily: str | None
    scale_type: str
    direction: str
    #: which end of the coded scale is the most of what ``display_name``
    #: names: ``ascending`` (the highest code) or ``descending`` (the
    #: lowest). Signed statistics — change, correlations, adjusted
    #: coefficients — are computed on values aligned so higher = more of
    #: the named thing (ADR-0015); means and shares are as coded.
    polarity: str
    min: int | None
    max: int | None
    waves_available: list[str]
    is_country_specific: bool
    is_derived: bool
    #: whether /v1/aggregate accepts it as an outcome
    servable: bool
    #: the stat a view shows unprompted (``flourish_stats.outcomes.default_stat``)
    default_stat: str


class ValueLabelModel(BaseModel):
    code: int
    label: str
    wave: str | None
    country_code: int | None
    is_nonresponse: bool


class MissingnessRow(BaseModel):
    """Response coverage per wave × country (from the pipeline's `coverage`)."""

    wave: str
    country_code: int
    n_present: int
    n_valid: int
    n_skipped: int
    n_dk: int
    n_refused: int


class ComponentModel(BaseModel):
    """One question a derived score is computed from (its own catalog
    entry, sliced to what the Codebook renders under the score)."""

    name: str
    display_name: str
    wording: str | None
    value_labels: list[ValueLabelModel]


class VariableDetail(VariableSummary):
    value_labels: list[ValueLabelModel]
    missingness: list[MissingnessRow]
    #: derived scores: the rule in words (from the registry); None otherwise
    scoring: str | None = None
    #: derived scores: the questions the score is computed from, in
    #: scoring order; empty for ordinary catalog items
    components: list[ComponentModel] = []


class VariableList(BaseModel):
    variables: list[VariableSummary]


GroupValue = str | int | float | bool | None


class EstimateRow(BaseModel):
    """One estimator record, verbatim from the engine's common record.

    Every number ships with its weight, ``se_method``, unweighted ``n``,
    CI bounds and suppression flags; suppressed rows keep ``n``/``sum_w``
    and null the estimates. The optional key fields identify sub-rows:
    ``level`` (proportions/distributions), ``p`` (quantiles), ``leg``
    (three-point panels), ``from_level``/``to_level``/``measure``
    (transition matrices; also the ``beta``/``beta_per_sd`` rows of an
    adjusted association) and ``predictor`` (the item an association is
    taken against, /v1/correlates).
    """

    group: dict[str, GroupValue]
    predictor: str | None = None
    level: int | None = None
    p: float | None = None
    leg: str | None = None
    from_level: int | None = None
    to_level: int | None = None
    measure: str | None = None

    stat: str
    estimate: float | None
    se: float | None
    ci_lo: float | None
    ci_hi: float | None
    ci_level: float
    ci_method: str
    n: int
    sum_w: float
    n_psu: int | None
    n_strata: int | None
    df: int | None
    se_method: str
    weight: str
    suppressed: bool
    flagged: bool


class ResponseMeta(BaseModel):
    """What every estimate response says about itself (ADR-0008: the same
    envelope is emitted by the static exporter, so the front end never
    cares which tier answered)."""

    data_version: str | None
    outcome: str
    scale_type: str
    direction: str
    stat: str
    waves: list[str]
    scope: str
    oriented: bool
    weight_key: str
    weight: str
    se_method: str
    ci_level: float
    suppression: SuppressionModel
    #: respondents in the eligible design frame / with a valid outcome
    n_frame: int
    n_valid: int
    by: list[str]
    filters: dict[str, list[GroupValue]]
    #: /v1/correlates only (absent from every other response and from the
    #: static tier): whether the rows are adjusted-model coefficients
    #: (``stat = "beta"``) rather than plain correlations; the control set
    #: actually in the model (country fixed effects only when several
    #: countries share the frame); and which model card applies
    #: (``continuous`` | ``binary``).
    adjusted: bool | None = None
    controls: list[str] | None = None
    model: str | None = None
    #: /v1/correlates only: the complete-case n a predictor needs in a
    #: group to be ranked (``FA_CORRELATES_MIN_N``, ADR-0015), and how
    #: many candidates the ranked sweep left out for falling below it in
    #: every group (0 when the predictors were named).
    min_n: int | None = None
    n_excluded: int | None = None
    #: /v1/correlates ranked sweeps only: the predictors left out because
    #: they share answers with a predictor kept in the list (a score and
    #: its own questions, or a score and its screen-positive flag — ADR-0018),
    #: each mapped to the one that stands in for it; empty when nothing
    #: overlapped, null on every other response.
    dropped_overlap: dict[str, str] | None = None


class EstimateResponse(BaseModel):
    meta: ResponseMeta
    rows: list[EstimateRow]


class PairGroupModel(BaseModel):
    """One group of the compared question X (/v1/correlations/pair): one
    of its answers, or an equal-width bin of a long scale."""

    #: the answer's code as the release codes it (or, binned, the bin's index)
    code: int
    #: the answer's short label, or the bin's range ("2.5–3.2")
    label: str
    #: the group's weighted share of the people who answered both questions
    share: float
    #: fewer than ``means.meta.min_n`` people answered both: the chart draws
    #: the group hollow and names it (ADR-0015's floor, applied to a group)
    below_min_n: bool


class PairResponse(BaseModel):
    """Two questions side by side (/v1/correlations/pair): their weighted
    correlation, and the outcome Y's weighted mean in each group of X —
    the /v1/aggregate estimator, grouped by X. Groups run in X's aligned
    order (from least to most of what its label names), so a positive
    correlation slopes up; respondent-level points are never served."""

    #: the compared question (``means.meta.outcome`` is Y)
    x: str
    #: ``answers`` (one group per answer, up to 11) or ``bins`` (ten
    #: equal-width bins between X's weighted 1st and 99th percentiles)
    grouping: str
    #: the weighted correlation over the people who answered both (a
    #: point estimate, ``ci_method = "none"``; ``predictor`` = x)
    correlation: EstimateRow
    #: Y's weighted mean per group of X (a yes/no Y: its share answering
    #: yes, ``stat = "proportion"``); ``by = [x]``, one row per entry of
    #: ``groups`` and in its order
    means: EstimateResponse
    groups: list[PairGroupModel]


class CorrelationPairModel(BaseModel):
    """One cell of a correlation table (/v1/correlations): the questions
    ``a`` and ``b``, ``a`` before ``b`` in the order they were asked for."""

    a: str
    b: str
    #: built from the same answers (a score and its own question):
    #: associated by construction, so no correlation is taken
    shares_answers: bool
    #: fewer than ``meta.min_n`` people answered both
    below_min_n: bool
    #: the weighted correlation over the people who answered both (a
    #: point estimate, ``ci_method = "none"``, ``predictor`` = b); null
    #: when the two share answers
    correlation: EstimateRow | None


class CorrelationsMeta(BaseModel):
    """What a correlation table says about itself."""

    data_version: str | None
    #: the questions, in the order asked (the table's rows and columns)
    vars: list[str]
    wave: str
    #: ``pearson_r`` or ``spearman_r``
    stat: str
    weight_key: str
    weight: str
    ci_level: float
    suppression: SuppressionModel
    #: respondents in the eligible design frame
    n_frame: int
    filters: dict[str, list[GroupValue]]
    #: the floor below which a pair is flagged (``FA_CORRELATES_MIN_N``)
    min_n: int


class CorrelationsResponse(BaseModel):
    """Every pair of 2–10 questions in one country (/v1/correlations)."""

    meta: CorrelationsMeta
    #: every pair i < j, row by row: (1, 2), (1, 3), … (2, 3), …
    pairs: list[CorrelationPairModel]
