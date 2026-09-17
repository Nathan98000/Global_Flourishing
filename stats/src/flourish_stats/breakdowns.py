"""The demographic-breakdown registry: columns, levels, display labels.

Shared data semantics for the engine's two consumers, exactly like the
weight table and the derived-score registry (CLAUDE.md): the API validates
``by=``/``filter=`` against :data:`BREAKDOWN_LEVELS` and serves
:func:`breakdown_labels` at ``/v1/meta``, and the pipeline's static
exporter emits the same labels into ``meta.json`` — so the front end never
owns a code→label map of its own.

Labels come from the catalog wherever the release defines them (the
respondent columns are recodes of the uppercase catalog variables in
:data:`CATALOG_SOURCES`); the two purely-derived columns carry their
literal definitions: ``age_band``'s bands, and ``income_quintile``'s
within-country quintiles (pipeline ``derive.income_quintiles``).
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

from typing import Any

import polars as pl

#: Respondent columns a request may group or filter by, with their level
#: values in display order. ``country_code`` has no fixed set — it is
#: validated against the catalog's countries table, which also carries
#: the display names, so it does not appear in ``breakdown_labels``.
BREAKDOWN_LEVELS: dict[str, tuple[str | int, ...]] = {
    "country_code": (),
    "age_band": ("18-24", "25-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"),
    "gender": (1, 2, 3, 4),
    "education_3": (1, 2, 3),
    "employment": (1, 2, 3, 4, 5, 6, 7, 8),
    "marital_status": (1, 2, 3, 4, 5, 6),
    "urban_rural": (1, 2, 3, 4),
    "income_quintile": (1, 2, 3, 4, 5),
}

#: Which catalog variable each recode column descends from (None = the
#: column is pipeline-derived and its labels are literal).
CATALOG_SOURCES: dict[str, str | None] = {
    "age_band": None,
    "gender": "GENDER",
    "education_3": "EDUCATION_3",
    "employment": "EMPLOYMENT",
    "marital_status": "MARITAL_STATUS",
    "urban_rural": "URBAN_RURAL",
    "income_quintile": None,
}

#: Display names for the derived columns (the catalog-sourced ones use the
#: catalog's own display_name).
_DERIVED_DISPLAY = {"age_band": "Age band", "income_quintile": "Income quintile"}

_QUINTILE_LABELS = ("Q1 (lowest)", "Q2", "Q3", "Q4", "Q5 (highest)")


def _literal_levels(column: str) -> list[dict[str, Any]]:
    if column == "age_band":
        return [
            {"value": band, "label": band.replace("-", "–")}
            for band in BREAKDOWN_LEVELS["age_band"]
            if isinstance(band, str)
        ]
    assert column == "income_quintile"
    return [
        {"value": value, "label": label}
        for value, label in zip(BREAKDOWN_LEVELS["income_quintile"], _QUINTILE_LABELS, strict=True)
    ]


def breakdown_labels(
    variables: pl.DataFrame, value_labels: pl.DataFrame
) -> dict[str, dict[str, Any]]:
    """Display name + ordered ``(value, label)`` pairs per breakdown column.

    ``variables``/``value_labels`` are the catalog tables. Catalog-sourced
    columns read the source variable's labels (non-nonresponse codes, in
    level order); a column whose source is missing from the catalog falls
    back to stringified codes so the payload is always complete — honest,
    never invented.
    """
    labels: dict[str, dict[str, Any]] = {}
    for column, source in CATALOG_SOURCES.items():
        if source is None:
            labels[column] = {
                "display_name": _DERIVED_DISPLAY[column],
                "levels": _literal_levels(column),
            }
            continue
        display = variables.filter(pl.col("name") == source)
        display_name = (
            str(display.row(0, named=True)["display_name"])
            if display.height
            else column.replace("_", " ").capitalize()
        )
        by_code = {
            int(row["code"]): str(row["label"])
            for row in value_labels.filter(
                (pl.col("variable") == source) & ~pl.col("is_nonresponse")
            ).iter_rows(named=True)
        }
        labels[column] = {
            "display_name": display_name,
            "levels": [
                {"value": value, "label": by_code.get(int(value), str(value))}
                for value in BREAKDOWN_LEVELS[column]
                if isinstance(value, int)
            ],
        }
    return labels
