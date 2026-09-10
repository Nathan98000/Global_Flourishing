"""DuckDB loaders for the built data (optional ``flourish-stats[duckdb]``).

The pure estimators never touch DuckDB; these helpers exist so the verify
script, the built-data tests and (from Phase 3) the API's data layer all
assemble analysis frames the same way: one ``(variable, wave)`` slice of
``responses_long`` (or the ``responses_oriented`` view) joined to
``respondents`` on ``id``.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import polars as pl

if TYPE_CHECKING:  # duckdb is an optional extra; import only for types
    import duckdb

#: Respondent columns attached by default: enough to resolve any global
#: weight spec (flourish_stats.weights), validate eligibility and estimate
#: with the full design.
DEFAULT_COLUMNS: tuple[str, ...] = (
    "country_code",
    "strata",
    "psu",
    "retained_y2",
    "has_midyear",
    "midyear_type",
    "w_c1",
    "w_c2",
    "w_l2",
    "w_r2",
    "w_l1m",
    "w_l1m2",
)

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]*$")


def _column_list(columns: tuple[str, ...]) -> str:
    """Trailing SELECT-list fragment: empty for no extra columns.

    (DuckDB happens to accept a trailing comma, but nothing here should
    depend on that dialect nicety.)
    """
    for column in columns:
        if not _IDENTIFIER.match(column):
            raise ValueError(f"invalid column name {column!r}")
    return "".join(f", r.{column}" for column in columns)


def analysis_frame(
    con: duckdb.DuckDBPyConnection,
    variable: str,
    wave: str,
    *,
    oriented: bool = False,
    columns: tuple[str, ...] = DEFAULT_COLUMNS,
) -> pl.DataFrame:
    """One ``(variable, wave)`` slice of responses joined to respondents.

    ``value`` is null for non-response (complete-case exclusion happens in
    the estimators). ``oriented=True`` reads the ``responses_oriented``
    view, which flips ``lower_better`` items at the data layer — the
    engine itself is direction-agnostic.
    """
    source = "responses_oriented" if oriented else "responses_long"
    query = (
        f"SELECT s.id, s.value, s.nonresponse{_column_list(columns)} "
        f"FROM {source} s JOIN respondents r ON r.id = s.id "
        f"WHERE s.variable = ? AND s.wave = ?"
    )
    frame = pl.from_arrow(con.execute(query, [variable, wave]).arrow())
    assert isinstance(frame, pl.DataFrame)
    return frame


def derived_frame(
    con: duckdb.DuckDBPyConnection,
    column: str,
    wave: str,
    *,
    columns: tuple[str, ...] = DEFAULT_COLUMNS,
) -> pl.DataFrame:
    """One derived score (``sfi``, ``phq2_score``, …) as an analysis frame.

    Same shape as :func:`analysis_frame` with the derived column as
    ``value`` (and no ``nonresponse``: derived scores are computed, not
    asked).
    """
    if not _IDENTIFIER.match(column):
        raise ValueError(f"invalid column name {column!r}")
    query = (
        f"SELECT d.id, d.{column} AS value{_column_list(columns)} "
        f"FROM derived d JOIN respondents r ON r.id = d.id "
        f"WHERE d.wave = ?"
    )
    frame = pl.from_arrow(con.execute(query, [wave]).arrow())
    assert isinstance(frame, pl.DataFrame)
    return frame
