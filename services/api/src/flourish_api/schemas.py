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
