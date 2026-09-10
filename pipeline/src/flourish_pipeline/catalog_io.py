"""Read the catalog written by the codebook stage, for the later stages."""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import polars as pl

SUBSTANTIVE_SCALES = frozenset(
    {"scale_0_10", "ordinal", "nominal", "binary", "count", "continuous"}
)


@dataclass(frozen=True, slots=True)
class CatalogVariable:
    name: str
    scale_type: str
    direction: str
    min: int | None
    max: int | None
    waves_available: tuple[str, ...]
    is_country_specific: bool
    is_us_only: bool
    nonresponse: dict[int, str]  # code -> skipped | dk | refused

    @property
    def is_substantive(self) -> bool:
        return self.scale_type in SUBSTANTIVE_SCALES


def load_variables(out_dir: Path) -> dict[str, CatalogVariable]:
    payload: Any = json.loads((out_dir / "catalog.json").read_text(encoding="utf-8"))
    variables: dict[str, CatalogVariable] = {}
    for raw in payload["variables"]:
        nonresponse: dict[int, str] = {}
        for kind, codes in raw["nonresponse_codes"].items():
            for code in codes:
                nonresponse[int(code)] = str(kind)
        variables[str(raw["name"])] = CatalogVariable(
            name=str(raw["name"]),
            scale_type=str(raw["scale_type"]),
            direction=str(raw["direction"]),
            min=raw["min"],
            max=raw["max"],
            waves_available=tuple(str(w) for w in raw["waves_available"]),
            is_country_specific=bool(raw["is_country_specific"]),
            is_us_only=bool(raw["is_us_only"]),
            nonresponse=nonresponse,
        )
    return variables


def load_countries(out_dir: Path) -> dict[int, str]:
    payload: Any = json.loads((out_dir / "catalog.json").read_text(encoding="utf-8"))
    return {int(c["code"]): str(c["name"]) for c in payload["countries"]}


def countries_frame(out_dir: Path) -> pl.DataFrame:
    payload: Any = json.loads((out_dir / "catalog.json").read_text(encoding="utf-8"))
    return pl.DataFrame(
        payload["countries"],
        schema={"code": pl.Int16, "name": pl.String, "iso3": pl.String},
    )


def nonresponse_frame(variables: dict[str, CatalogVariable]) -> pl.DataFrame:
    """(variable, value, nonresponse) rows for joining onto the long table."""
    rows = [
        {"variable": v.name, "value": code, "nonresponse": kind}
        for v in variables.values()
        for code, kind in sorted(v.nonresponse.items())
    ]
    return pl.DataFrame(
        rows, schema={"variable": pl.String, "value": pl.Int16, "nonresponse": pl.String}
    )
