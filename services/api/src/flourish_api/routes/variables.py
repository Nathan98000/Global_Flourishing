"""GET /v1/variables and /v1/variables/{name} — the searchable codebook.

Chart-rendering metadata (direction, value labels, min/max) lives here,
not in aggregate responses — Phase 4 reads it once per variable.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from typing import Annotated

import polars as pl
from fastapi import APIRouter, Depends, HTTPException, Query

from flourish_api.data import DERIVED_OUTCOMES, DataStore, require_data
from flourish_api.schemas import (
    MissingnessRow,
    ValueLabelModel,
    VariableDetail,
    VariableList,
    VariableSummary,
)

router = APIRouter()

#: Catalog scale types that are bookkeeping, not survey content.
_NON_SUBSTANTIVE = ("design", "date", "id", "string", "weight")


def _substantive(store: DataStore) -> pl.DataFrame:
    assert store.catalog is not None
    return store.catalog.variables.filter(~pl.col("scale_type").is_in(list(_NON_SUBSTANTIVE)))


def _catalog_summary(store: DataStore, row: dict[str, object]) -> VariableSummary:
    assert store.catalog is not None
    name = str(row["name"])
    return VariableSummary(
        name=name,
        display_name=str(row["display_name"]),
        label=None if row["label"] is None else str(row["label"]),
        family=str(row["family"]),
        scale_type=str(row["scale_type"]),
        direction=str(row["direction"]),
        min=row["min"],  # type: ignore[arg-type]
        max=row["max"],  # type: ignore[arg-type]
        waves_available=list(row["waves_available"]),  # type: ignore[call-overload]
        is_country_specific=bool(row["is_country_specific"]),
        is_derived=False,
        servable=store.catalog.outcome(name) is not None,
    )


def _derived_summary(name: str) -> VariableSummary:
    derived = DERIVED_OUTCOMES[name]
    return VariableSummary(
        name=name,
        display_name=derived.display_name,
        label=derived.description,
        family="derived",
        scale_type=derived.scale_type,
        direction=derived.direction,
        min=derived.min,
        max=derived.max,
        waves_available=["Y1", "Y2"],
        is_country_specific=False,
        is_derived=True,
        servable=True,
    )


@router.get("/variables", summary="Search the variable catalog")
def list_variables(
    store: Annotated[DataStore, Depends(require_data)],
    q: Annotated[str | None, Query(description="substring of name/display name/wording")] = None,
    family: Annotated[str | None, Query(description="filter to one family")] = None,
) -> VariableList:
    assert store.catalog is not None
    frame = _substantive(store)
    if family == "derived":
        frame = frame.clear()  # derived outcomes only
    elif family is not None:
        families = store.catalog.families
        if family not in families:
            raise HTTPException(
                422, detail=f"unknown family {family!r}; one of {[*families, 'derived']}"
            )
        frame = frame.filter(pl.col("family") == family)
    if q:
        needle = q.strip().lower()
        frame = frame.filter(
            pl.col("name").str.to_lowercase().str.contains(needle, literal=True)
            | pl.col("display_name").str.to_lowercase().str.contains(needle, literal=True)
            | pl.col("wording").fill_null("").str.to_lowercase().str.contains(needle, literal=True)
        )
    summaries = [_catalog_summary(store, row) for row in frame.sort("name").iter_rows(named=True)]
    if family in (None, "derived"):
        derived = [
            _derived_summary(name)
            for name in sorted(DERIVED_OUTCOMES)
            if not q
            or q.strip().lower() in name.lower()
            or q.strip().lower() in DERIVED_OUTCOMES[name].display_name.lower()
        ]
        summaries.extend(derived)
    return VariableList(variables=summaries)


@router.get("/variables/{name}", summary="One variable: wording, labels, missingness")
def variable_detail(
    name: str, store: Annotated[DataStore, Depends(require_data)]
) -> VariableDetail:
    assert store.catalog is not None
    if name in DERIVED_OUTCOMES:
        summary = _derived_summary(name)
        return VariableDetail(**summary.model_dump(), wording=None, value_labels=[], missingness=[])
    rows = _substantive(store).filter(pl.col("name") == name)
    if rows.height == 0:
        raise HTTPException(404, detail=f"no variable named {name!r} — see /v1/variables")
    row = rows.row(0, named=True)
    labels = [
        ValueLabelModel(
            code=int(label["code"]),
            label=str(label["label"]),
            wave=label["wave"],
            country_code=label["country_code"],
            is_nonresponse=bool(label["is_nonresponse"]),
        )
        for label in store.catalog.value_labels.filter(pl.col("variable") == name)
        .sort("code", "country_code", "wave", nulls_last=True)
        .iter_rows(named=True)
    ]
    missingness = [
        MissingnessRow(**coverage)
        for coverage in store.catalog.coverage.filter(pl.col("variable") == name)
        .drop("variable")
        .sort("wave", "country_code")
        .iter_rows(named=True)
    ]
    return VariableDetail(
        **_catalog_summary(store, row).model_dump(),
        wording=None if row["wording"] is None else str(row["wording"]),
        value_labels=labels,
        missingness=missingness,
    )
