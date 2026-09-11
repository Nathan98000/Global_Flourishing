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


class SuppressionModel(BaseModel):
    threshold: int
    flag_below: int


class MetaResponse(BaseModel):
    data_version: str | None
    git_sha: str | None
    countries: list[CountryModel]
    waves: list[str]
    weight_table: list[WeightSpecModel]
    suppression: SuppressionModel
    ci_level: float
    breakdowns: list[str]
    families: list[str]


class VariableSummary(BaseModel):
    name: str
    display_name: str
    label: str | None
    family: str
    scale_type: str
    direction: str
    min: int | None
    max: int | None
    waves_available: list[str]
    is_country_specific: bool
    is_derived: bool
    #: whether /v1/aggregate accepts it as an outcome
    servable: bool


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


class VariableDetail(VariableSummary):
    wording: str | None
    value_labels: list[ValueLabelModel]
    missingness: list[MissingnessRow]


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
    (transition matrices).
    """

    group: dict[str, GroupValue]
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


class EstimateResponse(BaseModel):
    meta: ResponseMeta
    rows: list[EstimateRow]
