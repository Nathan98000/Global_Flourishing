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
from collections.abc import Sequence
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
#: Catalog item names (``responses_long.variable``) are upper-case codes.
_ITEM_NAME = re.compile(r"^[A-Z][A-Z0-9_]*$")

#: The catalog's ``polarity``: which end of the CODED scale is the most of
#: what the item's display name names — ``ascending`` when the highest
#: code is, ``descending`` when the lowest code is (``DEPRESSED`` 1 =
#: Nearly every day; every 1 = Yes / 2 = No item). Every signed statistic
#: (a within-person change, a correlation, an adjusted coefficient) is
#: computed on *aligned* values, so that higher always means more of the
#: named thing (ADR-0015); means and shares are never re-coded.
POLARITIES: frozenset[str] = frozenset({"ascending", "descending"})


def aligned_expr(column: str, *, polarity: str, lo: int | None, hi: int | None) -> pl.Expr:
    """The load-time alignment transform: ``value' = lo + hi − value`` for
    a ``descending`` item, the value itself for an ``ascending`` one.

    A reflection about the scale's midpoint: it keeps the range, the
    integer grid and the null pattern (non-response stays null), so every
    estimator downstream is unchanged — only the sign of what it says
    follows the label. A descending item without catalog bounds cannot be
    aligned; that is raised, never guessed.
    """
    if polarity not in POLARITIES:
        raise ValueError(f"polarity must be one of {sorted(POLARITIES)}, got {polarity!r}")
    if polarity == "ascending":
        return pl.col(column)
    if lo is None or hi is None:
        raise ValueError(f"cannot align {column!r}: a descending item needs catalog min and max")
    return (pl.lit(lo + hi) - pl.col(column)).cast(pl.Int32).alias(column)


def binned_expr(column: str, *, lo: int, hi: int, width: int = 1) -> pl.Expr:
    """A continuous score → the lower edge of its bin (``flourish_stats.
    outcomes.score_bins``): ``floor(value)`` stepped by ``width``, with
    the top bin closed so ``hi`` itself lands in ``[hi − width, hi]``.
    Nulls stay null; the result is an integer column the distribution
    estimator bins exactly like an integer-coded item."""
    if width <= 0 or hi <= lo:
        raise ValueError(f"bins need width > 0 and hi > lo, got {width}, {lo}, {hi}")
    value = pl.col(column).cast(pl.Float64)
    edge = (((value - lo) / width).floor() * width + lo).clip(lo, hi - width)
    return pl.when(value.is_null()).then(None).otherwise(edge).cast(pl.Int32).alias(column)


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


#: Items per pivot query. A conditional aggregation keeps one state per
#: respondent per column; 104 columns over 208k respondents needs ~330 MB
#: of hash table, past the 256 MB the API grants DuckDB (ADR-0007), while
#: 16 columns need ~50 MB and cost ~0.25 s each on the release.
PIVOT_CHUNK = 16


def wide_frame(
    con: duckdb.DuckDBPyConnection,
    items: Sequence[str],
    wave: str,
    *,
    derived: Sequence[str] = (),
    columns: tuple[str, ...] = DEFAULT_COLUMNS,
    country_codes: Sequence[int] | None = None,
) -> pl.DataFrame:
    """One row per respondent, one column per item and derived score at ``wave``.

    The correlates sweep runs one outcome against every other servable
    item, so it needs them all on one frame. Each item column is a
    conditional aggregation over ``responses_long`` (``PIVOT_CHUNK`` items
    per query, joined back on ``id`` here — one wide hash table would not
    fit the serving memory limit), the derived scores come from one query
    on ``derived``, and the long table is never materialised wide in
    Python. Items appear under their catalog names, derived scores under
    their column names; a respondent without a row for an item is null
    there. Every respondent — of ``country_codes`` when given — is kept,
    whether or not they answered anything at the wave: the eligible rows
    for a weight spec are the design (ADR-0006), and the caller filters to
    them.
    """
    for name in items:
        if not _ITEM_NAME.match(name):
            raise ValueError(f"invalid item name {name!r}")
    for name in derived:
        if not _IDENTIFIER.match(name):
            raise ValueError(f"invalid column name {name!r}")
    if not items and not derived:
        raise ValueError("wide_frame needs at least one item or derived score")

    pool_filter = ""
    if country_codes is not None:
        codes = ", ".join(str(int(code)) for code in country_codes)
        pool_filter = f" WHERE r.country_code IN ({codes})" if codes else " WHERE FALSE"
    pool = f"SELECT r.id{_column_list(columns)} FROM respondents r{pool_filter}"
    frame = _fetch(con, pool, [])
    for start in range(0, len(items), PIVOT_CHUNK):
        chunk = items[start : start + PIVOT_CHUNK]
        pivots = "".join(
            f", MAX(CASE WHEN s.variable = '{name}' THEN s.value END) AS \"{name}\""
            for name in chunk
        )
        placeholders = ", ".join("?" for _ in chunk)
        query = (
            f"WITH pool AS ({pool}) SELECT s.id{pivots} FROM responses_long s "
            f"WHERE s.wave = ? AND s.variable IN ({placeholders}) "
            f"AND s.id IN (SELECT id FROM pool) GROUP BY s.id"
        )
        frame = frame.join(_fetch(con, query, [wave, *chunk]), on="id", how="left")
    if derived:
        scores = "".join(f", d.{name}" for name in derived)
        query = f"SELECT d.id{scores} FROM derived d WHERE d.wave = ?"
        frame = frame.join(_fetch(con, query, [wave]), on="id", how="left")
    return frame


def _fetch(con: duckdb.DuckDBPyConnection, query: str, params: list[object]) -> pl.DataFrame:
    result = con.execute(query, params)
    frame = pl.from_arrow(result.to_arrow_table())
    assert isinstance(frame, pl.DataFrame)
    return frame
