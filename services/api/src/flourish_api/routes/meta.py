"""GET /v1/meta — the facts a client needs before its first query."""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from flourish_stats import DEFAULT_POLICY, weight_table_json

from flourish_api.data import DataStore, require_data
from flourish_api.queries import BREAKDOWNS, WAVES
from flourish_api.schemas import (
    CountryModel,
    MetaResponse,
    SuppressionModel,
    WeightSpecModel,
)

router = APIRouter()


@router.get("/meta", summary="Data version, countries, waves, weight table")
def meta(request: Request, store: Annotated[DataStore, Depends(require_data)]) -> MetaResponse:
    """Everything static a client needs: the data version behind every
    number, the countries, and the wave → weight → eligibility table
    verbatim from the engine (the only home of those rules)."""
    assert store.catalog is not None
    countries = [
        CountryModel(code=row["code"], name=row["name"], iso3=row["iso3"])
        for row in store.catalog.countries.sort("code").iter_rows(named=True)
    ]
    weight_table = [WeightSpecModel(**row) for row in json.loads(weight_table_json())]
    return MetaResponse(
        data_version=store.data_version,
        git_sha=request.app.state.settings.git_sha,
        countries=countries,
        waves=list(WAVES),
        weight_table=weight_table,
        suppression=SuppressionModel(
            threshold=DEFAULT_POLICY.threshold, flag_below=DEFAULT_POLICY.flag_below
        ),
        ci_level=0.95,
        breakdowns=sorted(BREAKDOWNS),
        families=store.catalog.families,
    )
