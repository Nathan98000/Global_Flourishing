"""Engine records → response models → CSV.

The engine's ``pyarrow.Table`` carries the group-key columns plus the
common record (``flourish_stats.RESULT_COLUMNS``) and, per estimator, one
of the sub-row keys (``level``, ``p``, ``leg``, ``from_level``/
``to_level``/``measure``). This module maps them 1:1 into
:class:`~flourish_api.schemas.EstimateRow` — no numbers are altered or
dropped on the way through.
"""

from __future__ import annotations

import csv
import io
from collections.abc import Sequence
from typing import Any

import pyarrow as pa

from flourish_api.schemas import EstimateResponse, EstimateRow

_SUBROW_KEYS = ("level", "p", "leg", "from_level", "to_level", "measure")


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


def response_to_csv(response: EstimateResponse) -> str:
    """The same rows as CSV: meta as `# key: value` comment lines, group
    keys and sub-row keys flattened into columns."""
    buffer = io.StringIO()
    meta = response.meta.model_dump()
    filters = meta.pop("filters")
    suppression = meta.pop("suppression")
    for key, value in meta.items():
        if isinstance(value, list):
            items: list[object] = list(value)  # pyright: ignore[reportUnknownArgumentType]
            rendered = ",".join(str(item) for item in items)
        else:
            rendered = str(value)
        buffer.write(f"# {key}: {rendered}\n")
    threshold, flag_below = suppression["threshold"], suppression["flag_below"]
    buffer.write(f"# suppression: n<{threshold} suppressed, n<{flag_below} flagged\n")
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
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([*group_columns, *subrow_keys, *record_fields])
    for row in response.rows:
        writer.writerow(
            [
                *[row.group.get(name) for name in group_columns],
                *[getattr(row, key) for key in subrow_keys],
                *[getattr(row, field) for field in record_fields],
            ]
        )
    return buffer.getvalue()
