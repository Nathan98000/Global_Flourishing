"""Engine records → response models → CSV.

The engine's ``pyarrow.Table`` carries the group-key columns plus the
common record (``flourish_stats.RESULT_COLUMNS``) and, per estimator, one
of the sub-row keys (``level``, ``p``, ``leg``, ``from_level``/
``to_level``/``measure``; the correlates route adds ``predictor`` after
the fact). This module maps them 1:1 into
:class:`~flourish_api.schemas.EstimateRow` — no numbers are altered or
dropped on the way through.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Mapping, Sequence
from typing import Any

import pyarrow as pa

from flourish_api.schemas import EstimateResponse, EstimateRow

_SUBROW_KEYS = ("predictor", "level", "p", "leg", "from_level", "to_level", "measure")
_CORRELATES_META = (
    "adjusted",
    "controls",
    "model",
    "min_n",
    "n_excluded",
    "dropped_overlap",
    "pooled",
    "countries",
    "min_countries",
    "n_excluded_coverage",
    "other_wave",
    "answer_waves",
)


def suppression_line(suppression: dict[str, int]) -> str:
    """The CSV's suppression line — byte-identical in the client's export
    (``export/csv.ts suppressionLine``)."""
    threshold, flag_below = suppression["threshold"], suppression["flag_below"]
    if threshold == 0:
        # ADR-0011: every cell is shown; ADR-0031 flags the thin ones.
        if flag_below == 0:
            return "none (all cells shown)"
        return f"none (all cells shown); n<{flag_below} flagged"
    return f"n<{threshold} suppressed, n<{flag_below} flagged"


def rows_from_table(table: pa.Table, group_columns: Sequence[str]) -> list[EstimateRow]:
    rows: list[EstimateRow] = []
    for record in table.to_pylist():
        payload: dict[str, Any] = {
            "group": {name: record[name] for name in group_columns},
        }
        for key in _SUBROW_KEYS:
            if key in record:
                payload[key] = record[key]
        for key, value in record.items():
            if key in group_columns or key in _SUBROW_KEYS:
                continue
            payload[key] = value
        rows.append(EstimateRow(**payload))
    return rows


def label_column(column: str) -> str:
    """The column a code's words go in, right after it (G8): "country" for
    the country code, "<column>_label" for any other — the client's
    `export/csv.ts labelColumn`."""
    return "country" if column == "country_code" else f"{column}_label"


def response_to_csv(
    response: EstimateResponse, labels: Mapping[str, Mapping[object, str]] | None = None
) -> str:
    """The same rows as CSV: meta as `# key: value` comment lines, group
    keys and sub-row keys flattened into columns; each group code followed
    by its words when ``labels`` has them (a country's name, a level's
    label), so the file reads without the page."""
    buffer = io.StringIO()
    meta = response.meta.model_dump()
    filters = meta.pop("filters")
    suppression = meta.pop("suppression")
    for key, value in meta.items():
        # The correlates-only fields are absent (None) on every other
        # response; an aggregate export should not print them.
        if key in _CORRELATES_META and value is None:
            continue
        if isinstance(value, list):
            items: list[object] = list(value)  # pyright: ignore[reportUnknownArgumentType]
            rendered = ",".join(str(item) for item in items)
        elif isinstance(value, dict):
            pairs: dict[object, object] = dict(value)  # pyright: ignore[reportUnknownArgumentType]
            rendered = ",".join(f"{key}:{item}" for key, item in pairs.items())
        else:
            rendered = str(value)
        buffer.write(f"# {key}: {rendered}\n")
    buffer.write(f"# suppression: {suppression_line(suppression)}\n")
    for column, values in filters.items():
        buffer.write(f"# filter {column}: {','.join(map(str, values))}\n")

    group_columns = list(response.meta.by)
    subrow_keys = [
        key for key in _SUBROW_KEYS if any(getattr(row, key) is not None for row in response.rows)
    ]
    record_fields = [
        "stat",
        "estimate",
        "se",
        "ci_lo",
        "ci_hi",
        "ci_level",
        "ci_method",
        "n",
        "sum_w",
        "n_psu",
        "n_strata",
        "df",
        "se_method",
        "weight",
        "suppressed",
        "flagged",
    ]
    words = labels or {}
    heads = [
        head
        for name in group_columns
        for head in ([name, label_column(name)] if name in words else [name])
    ]

    def group_cells(row: EstimateRow) -> list[object]:
        cells: list[object] = []
        for name in group_columns:
            value = row.group.get(name)
            cells.append(value)
            if name in words:
                cells.append("" if value is None else words[name].get(value, ""))
        return cells

    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([*heads, *subrow_keys, *record_fields])
    for row in response.rows:
        writer.writerow(
            [
                *group_cells(row),
                *[getattr(row, key) for key in subrow_keys],
                *[getattr(row, field) for field in record_fields],
            ]
        )
    return buffer.getvalue()
