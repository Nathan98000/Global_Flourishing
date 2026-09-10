"""Validate: schemas, invariants, acceptance numbers, and the published
SFI ranking — written to ``data/validation_report.md``.

Every check is a :class:`CheckResult` so the pytest suite (marked ``raw``)
can assert the same list the stage writes. The stage exits non-zero if any
check fails.

The acceptance numbers are the facts verified against the raw files on
2026-09-10 (row counts, retention, midyear types, AGE top-codes, …); the
published-results checks reproduce the Wave 1 country ranking and age
profile from the GFS publications (proposal §3.6): tolerance ±0.03 on
country means, ordering exact for the top five and bottom three.
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import itertools
import json
import sys
from collections.abc import Callable, Generator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import duckdb
import polars as pl

from . import __version__
from .util import intermediate_dir, read_timings


@dataclass(slots=True)
class CheckResult:
    name: str
    passed: bool
    observed: str
    expected: str

    @property
    def status(self) -> str:
        return "pass" if self.passed else "FAIL"


Check = Callable[["ValidationContext"], list[CheckResult]]


@dataclass(slots=True)
class ValidationContext:
    out_dir: Path
    connection: duckdb.DuckDBPyConnection

    def one(self, sql: str) -> object:
        row = self.connection.execute(sql).fetchone()
        assert row is not None
        return row[0]

    def one_int(self, sql: str) -> int:
        value = self.one(sql)
        assert isinstance(value, int), f"expected int from {sql!r}, got {type(value)}"
        return value

    def one_float(self, sql: str) -> float:
        value = self.one(sql)
        assert isinstance(value, int | float), f"expected number from {sql!r}"
        return float(value)

    def frame(self, sql: str) -> pl.DataFrame:
        return self.connection.execute(sql).pl()


def _equals(name: str, observed: object, expected: object) -> CheckResult:
    return CheckResult(name, observed == expected, str(observed), str(expected))


def _close(name: str, observed: float, expected: float, tolerance: float) -> CheckResult:
    return CheckResult(
        name,
        abs(observed - expected) <= tolerance,
        f"{observed:.3f}",
        f"{expected:.2f} ± {tolerance:.2f}",
    )


def _zero(name: str, observed: int, what: str = "0") -> CheckResult:
    return CheckResult(name, observed == 0, str(observed), what)


# --------------------------------------------------------------- checks


def check_row_counts(ctx: ValidationContext) -> list[CheckResult]:
    ingest_report = json.loads((intermediate_dir(ctx.out_dir) / "ingest_report.json").read_text())
    respondents = ctx.one_int("SELECT count(*) FROM respondents")
    return [
        _equals("respondents rows", respondents, 207_919),
        _equals(
            "respondent ids unique",
            ctx.one("SELECT count(DISTINCT id) FROM respondents"),
            respondents,
        ),
        _equals("US file rows", ingest_report["rows_us"], 38_312),
        _equals("US IDs missing from global", ingest_report["us_ids_missing_from_global"], 0),
        _equals("US rows are the COUNTRY=22 rows", ingest_report["us_rows_equal_country_22"], True),
        _equals("US shared columns", ingest_report["shared_columns"], 242),
        _equals(
            "US shared columns with differing cells", ingest_report["shared_columns_differing"], 0
        ),
        _equals("countries", ctx.one("SELECT count(DISTINCT country_code) FROM respondents"), 23),
    ]


def check_waves_and_design(ctx: ValidationContext) -> list[CheckResult]:
    retained = ctx.one_int("SELECT count(*) FROM respondents WHERE retained_y2")
    midyear = ctx.one_int("SELECT count(*) FROM respondents WHERE has_midyear")
    return [
        _equals("retained at Wave 2", retained, 128_868),
        _close("retention share (%)", 100 * retained / 207_919, 61.98, 0.01),
        _equals("midyear respondents", midyear, 131_487),
        _close("midyear share (%)", 100 * midyear / 207_919, 63.24, 0.01),
        _equals(
            "midyear type 1 (separate)",
            ctx.one("SELECT count(*) FROM respondents WHERE midyear_type = 1"),
            54_358,
        ),
        _equals(
            "midyear type 2 (combined)",
            ctx.one("SELECT count(*) FROM respondents WHERE midyear_type = 2"),
            77_129,
        ),
        _equals(
            "full/partial Y1",
            tuple(
                ctx.frame(
                    "SELECT full_partial_y1 AS c, count(*) n FROM respondents GROUP BY 1 ORDER BY 1"
                )["n"].to_list()
            ),
            (205_906, 2_013),
        ),
        _equals(
            "full/partial Y2",
            tuple(
                ctx.frame(
                    "SELECT full_partial_y2 AS c, count(*) n FROM respondents "
                    "WHERE full_partial_y2 IS NOT NULL GROUP BY 1 ORDER BY 1"
                )["n"].to_list()
            ),
            (128_554, 314),
        ),
        _equals(
            "full/partial MY",
            tuple(
                ctx.frame(
                    "SELECT full_partial_my AS c, count(*) n FROM respondents "
                    "WHERE full_partial_my IS NOT NULL GROUP BY 1 ORDER BY 1"
                )["n"].to_list()
            ),
            (131_471, 16),
        ),
        _equals("strata", ctx.one("SELECT count(DISTINCT strata) FROM respondents"), 411),
        _equals("PSUs", ctx.one("SELECT count(DISTINCT psu) FROM respondents"), 136_781),
    ]


def check_demographics(ctx: ValidationContext) -> list[CheckResult]:
    gender = {
        int(code): int(n)
        for code, n in ctx.frame(
            "SELECT gender, count(*) n FROM respondents WHERE gender IS NOT NULL GROUP BY 1"
        ).iter_rows()
    }
    return [
        _equals("gender codes 1-4", gender, {1: 97_761, 2: 109_331, 3: 406, 4: 172}),
        _equals(
            "gender null (blank + DK + refused)",
            ctx.one("SELECT count(*) FROM respondents WHERE gender IS NULL"),
            147 + 92 + 10,
        ),
        _equals(
            "AGE keeps 99 as a valid top-code",
            ctx.one("SELECT count(*) FROM respondents WHERE age = 99"),
            28,
        ),
        _equals(
            "AGE keeps 98 as a real age",
            ctx.one("SELECT count(*) FROM respondents WHERE age = 98"),
            4,
        ),
        _equals(
            "age range",
            tuple(ctx.frame("SELECT min(age) a, max(age) b FROM respondents").row(0)),
            (18, 99),
        ),
        _equals(
            "US respondents with a state",
            ctx.one("SELECT count(*) FROM respondents WHERE state IS NOT NULL"),
            38_312 - 157,
        ),
        _equals(
            "state weight present iff state present",
            ctx.one(
                "SELECT count(*) FROM respondents WHERE (state IS NULL) != (w_state_c1 IS NULL)"
            ),
            0,
        ),
    ]


def check_responses_long(ctx: ValidationContext) -> list[CheckResult]:
    total = ctx.one_int("SELECT count(*) FROM responses_long")
    duplicate_keys = ctx.one_int(
        "SELECT count(*) FROM (SELECT id, wave, variable FROM responses_long "
        "GROUP BY 1, 2, 3 HAVING count(*) > 1)"
    )
    nonresponse_with_value = ctx.one_int(
        "SELECT count(*) FROM responses_long WHERE nonresponse IS NOT NULL AND value IS NOT NULL"
    )
    out_of_range = ctx.one_int(
        """
            SELECT count(*) FROM responses_long r
            JOIN variables v ON v.name = r.variable
            WHERE r.value IS NOT NULL
              AND v.scale_type IN ('scale_0_10', 'ordinal', 'binary', 'count')
              AND (r.value < v."min" OR r.value > v."max")
            """
    )
    unlabelled_nominal = ctx.one_int(
        """
            WITH valid AS (
                SELECT DISTINCT variable, code FROM value_labels WHERE NOT is_nonresponse
            )
            SELECT count(*) FROM responses_long r
            JOIN variables v ON v.name = r.variable
            LEFT JOIN valid ON valid.variable = r.variable AND valid.code = r.value
            WHERE r.value IS NOT NULL AND v.scale_type = 'nominal' AND valid.code IS NULL
            """
    )
    sentinel_values = ctx.one_int(
        """
            SELECT count(*) FROM responses_long r
            JOIN value_labels l
              ON l.variable = r.variable AND l.code = r.value AND l.is_nonresponse
            WHERE r.value IS NOT NULL
            """
    )
    wrong_country_prefix = ctx.one_int(
        """
            SELECT count(*) FROM responses_long r
            JOIN variables v ON v.name = r.variable
            JOIN respondents p ON p.id = r.id
            WHERE v.is_country_specific
              AND r.value IS NOT NULL AND r.value >= 100 AND r.value < 9900
              AND r.value // 100 != p.country_code
            """
    )
    coverage_total = ctx.one_int("SELECT sum(n_present) FROM coverage")
    return [
        CheckResult("responses_long rows", total > 30_000_000, f"{total:,}", "> 30,000,000"),
        _zero("duplicate (id, wave, variable) keys", duplicate_keys),
        _zero("non-response rows with a value", nonresponse_with_value),
        _zero("values outside catalog [min, max]", out_of_range),
        _zero("nominal values without a label", unlabelled_nominal),
        _zero("sentinel codes left in value", sentinel_values),
        _zero("country-specific codes with wrong country prefix", wrong_country_prefix),
        _equals("coverage rows sum to responses_long", coverage_total, total),
    ]


def check_schemas(ctx: ValidationContext) -> list[CheckResult]:
    from . import schemas

    results: list[CheckResult] = []
    for table, schema in schemas.TABLE_SCHEMAS.items():
        frame = pl.read_parquet(ctx.out_dir / "parquet" / f"{table}.parquet")
        try:
            schema.validate(frame)
            results.append(CheckResult(f"pandera schema: {table}", True, "valid", "valid"))
        except Exception as error:  # pandera raises SchemaError(s)
            message = str(error).splitlines()[0][:120]
            results.append(CheckResult(f"pandera schema: {table}", False, message, "valid"))
    return results


def check_derived(ctx: ValidationContext) -> list[CheckResult]:
    return [
        _zero(
            "sfi outside [0, 10]",
            ctx.one_int("SELECT count(*) FROM derived WHERE sfi < 0 OR sfi > 10"),
        ),
        _zero(
            "sfi with fewer than 10 items",
            ctx.one_int("SELECT count(*) FROM derived WHERE sfi IS NOT NULL AND sfi_n_items < 10"),
        ),
        _zero(
            "phq2/gad2 outside [0, 6]",
            ctx.one_int(
                "SELECT count(*) FROM derived WHERE phq2_score NOT BETWEEN 0 AND 6 "
                "OR gad2_score NOT BETWEEN 0 AND 6"
            ),
        ),
        _equals(
            "derived waves",
            tuple(
                ctx.frame(
                    "SELECT wave, count(*) n FROM derived GROUP BY 1 ORDER BY CASE wave "
                    "WHEN 'Y1' THEN 0 WHEN 'MY' THEN 1 ELSE 2 END"
                )["n"].to_list()
            ),
            (207_919, 131_487, 128_868),
        ),
        _equals(
            "priority_top only at MY",
            ctx.one("SELECT count(*) FROM derived WHERE priority_top IS NOT NULL AND wave != 'MY'"),
            0,
        ),
    ]


def check_catalog_coverage(ctx: ValidationContext) -> list[CheckResult]:
    coverage_md = (ctx.out_dir / "catalog_coverage.md").read_text(encoding="utf-8")
    sections = coverage_md.split("## ")
    empty = all(
        "(none)" in section
        for section in sections
        if section.startswith(("CSV columns", "Codebook headings"))
    )
    return [
        CheckResult(
            "catalog coverage lists empty",
            empty,
            "clean" if empty else "gaps listed in data/catalog_coverage.md",
            "clean",
        )
    ]


PUBLISHED_TOP = [
    ("Indonesia", 8.10),
    ("Israel", 7.88),
    ("Philippines", 7.70),
    ("Mexico", 7.64),
    ("Poland", 7.56),
]
PUBLISHED_BOTTOM = [
    ("United Kingdom", 6.79),
    ("Türkiye", 6.31),
    ("Japan", 5.89),
]
SFI_TOLERANCE = 0.03


def sfi_by_country(ctx: ValidationContext) -> pl.DataFrame:
    return ctx.frame(
        """
        SELECT p.country_name, sum(d.sfi * p.w_c1) / sum(p.w_c1) AS mean_sfi,
               count(*) AS n
        FROM derived d JOIN respondents p ON p.id = d.id
        WHERE d.wave = 'Y1' AND d.sfi IS NOT NULL
        GROUP BY 1 ORDER BY mean_sfi DESC
        """
    )


def check_published_ranking(ctx: ValidationContext) -> list[CheckResult]:
    table = sfi_by_country(ctx)
    names = table["country_name"].to_list()
    means = dict(zip(names, table["mean_sfi"].to_list(), strict=True))
    results: list[CheckResult] = [
        _equals("SFI top five order", names[:5], [c for c, _ in PUBLISHED_TOP]),
        _equals("SFI bottom three order", names[-3:], [c for c, _ in PUBLISHED_BOTTOM]),
    ]
    for country, published in [*PUBLISHED_TOP, *PUBLISHED_BOTTOM]:
        results.append(
            _close(f"SFI mean: {country}", float(means[country]), published, SFI_TOLERANCE)
        )
    pooled = ctx.one_float(
        "SELECT sum(d.sfi * p.w_c1) / sum(p.w_c1) FROM derived d "
        "JOIN respondents p ON p.id = d.id WHERE d.wave = 'Y1' AND d.sfi IS NOT NULL"
    )
    results.append(_close("SFI pooled mean (all respondents)", pooled, 7.07, SFI_TOLERANCE))
    return results


def sfi_by_age_band(ctx: ValidationContext) -> pl.DataFrame:
    return ctx.frame(
        """
        SELECT p.age_band, sum(d.sfi * p.w_c1) / sum(p.w_c1) AS mean_sfi, count(*) AS n
        FROM derived d JOIN respondents p ON p.id = d.id
        WHERE d.wave = 'Y1' AND d.sfi IS NOT NULL AND p.age_band IS NOT NULL
        GROUP BY 1 ORDER BY 1
        """
    )


def check_age_profile(ctx: ValidationContext) -> list[CheckResult]:
    table = sfi_by_age_band(ctx)
    means = dict(zip(table["age_band"].to_list(), table["mean_sfi"].to_list(), strict=True))
    results: list[CheckResult] = []
    for band in ("18-24", "25-29", "30-39", "40-49"):
        results.append(_close(f"SFI age {band} flat near 7.0", float(means[band]), 7.0, 0.15))
    older = [float(means[b]) for b in ("50-59", "60-69", "70-79", "80+")]
    non_decreasing = all(b >= a - 1e-9 for a, b in itertools.pairwise(older))
    results.append(
        CheckResult(
            "SFI non-decreasing from 50-59 upward",
            non_decreasing,
            " → ".join(f"{v:.2f}" for v in older),
            "non-decreasing",
        )
    )
    results.append(_close("SFI age 80+", float(means["80+"]), 7.66, 0.05))
    return results


CHECKS: tuple[Check, ...] = (
    check_row_counts,
    check_waves_and_design,
    check_demographics,
    check_responses_long,
    check_schemas,
    check_derived,
    check_catalog_coverage,
    check_published_ranking,
    check_age_profile,
)


@contextmanager
def open_database(out_dir: Path) -> Generator[ValidationContext]:
    connection = duckdb.connect(str(out_dir / "flourish.duckdb"), read_only=True)
    try:
        yield ValidationContext(out_dir=out_dir, connection=connection)
    finally:
        connection.close()


def run_checks(out_dir: Path) -> list[CheckResult]:
    with open_database(out_dir) as ctx:
        results: list[CheckResult] = []
        for check in CHECKS:
            results.extend(check(ctx))
        return results


# --------------------------------------------------------------- report


def _outputs_for_report(out_dir: Path) -> list[tuple[str, Path]]:
    paths = [
        ("catalog.json", out_dir / "catalog.json"),
        ("flourish.duckdb", out_dir / "flourish.duckdb"),
    ]
    for parquet in sorted((out_dir / "parquet").glob("*.parquet")):
        paths.append((f"parquet/{parquet.name}", parquet))
    return paths


def _markdown_table(frame: pl.DataFrame, headers: list[str], fmt: str = "{:.2f}") -> list[str]:
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    for row in frame.iter_rows():
        cells = [
            fmt.format(value)
            if isinstance(value, float)
            else (f"{value:,}" if isinstance(value, int) else str(value))
            for value in row
        ]
        lines.append("| " + " | ".join(cells) + " |")
    return lines


def write_report(out_dir: Path, results: list[CheckResult]) -> str:
    failed = [r for r in results if not r.passed]
    with open_database(out_dir) as ctx:
        country_table = sfi_by_country(ctx)
        age_table = sfi_by_age_band(ctx)
        retention = ctx.frame(
            """
            SELECT country_name,
                   count(*) AS n_y1,
                   round(100.0 * count(*) FILTER (retained_y2) / count(*), 1) AS retained_pct,
                   round(100.0 * count(*) FILTER (has_midyear) / count(*), 1) AS midyear_pct,
                   count(*) FILTER (midyear_type = 1) AS midyear_separate,
                   count(*) FILTER (midyear_type = 2) AS midyear_combined
            FROM respondents GROUP BY 1 ORDER BY retained_pct DESC
            """
        )
        row_counts = {
            table: ctx.one_int(f"SELECT count(*) FROM {table}")
            for table in (
                "respondents",
                "responses_long",
                "derived",
                "coverage",
                "variables",
                "value_labels",
                "countries",
            )
        }

    timings = read_timings(out_dir)
    lines: list[str] = [
        "# Validation report",
        "",
        f"Pipeline `flourish-pipeline {__version__}` — regenerate with `make data`.",
        f"**{len(results) - len(failed)} / {len(results)} checks passed.**"
        + ("" if not failed else f" **{len(failed)} FAILED.**"),
        "",
        "## Checks",
        "",
        "| Check | Status | Observed | Expected |",
        "|---|---|---|---|",
    ]
    lines += [f"| {r.name} | {r.status} | {r.observed} | {r.expected} |" for r in results]
    lines += [
        "",
        "## Wave 1 SFI by country (ANNUAL_WEIGHT_C1)",
        "",
        "Weighted means of the 12-item Secure Flourishing Index; unweighted n.",
        "",
        *_markdown_table(country_table, ["Country", "Mean SFI", "n (unweighted)"]),
        "",
        "## Wave 1 SFI by age band (ANNUAL_WEIGHT_C1)",
        "",
        *_markdown_table(age_table, ["Age band", "Mean SFI", "n (unweighted)"]),
        "",
        "## Retention and midyear coverage by country",
        "",
        *_markdown_table(
            retention,
            [
                "Country",
                "n (Y1)",
                "Retained Y2 %",
                "Midyear %",
                "Midyear separate",
                "Midyear combined",
            ],
            fmt="{:.1f}",
        ),
        "",
        "## Tables",
        "",
        "| Table | Rows |",
        "|---|---|",
        *[f"| {name} | {count:,} |" for name, count in row_counts.items()],
        "",
        "## Outputs",
        "",
        "| File | Size |",
        "|---|---|",
        *[
            f"| {name} | {path.stat().st_size / 1_048_576:.1f} MiB |"
            for name, path in _outputs_for_report(out_dir)
        ],
        "",
        "## Stage runtimes (this machine, seconds)",
        "",
        "| Stage | Seconds |",
        "|---|---|",
        *[f"| {stage} | {seconds:.1f} |" for stage, seconds in sorted(timings.items())],
        "",
        "All figures above are aggregates; no raw microdata appears in this report.",
    ]
    text = "\n".join(lines) + "\n"
    (out_dir / "validation_report.md").write_text(text, encoding="utf-8")
    return text


def run_validate(out_dir: Path) -> int:
    database = out_dir / "flourish.duckdb"
    if not database.exists():
        print(f"validate: missing {database} (run derive first)", file=sys.stderr)
        return 1
    results = run_checks(out_dir)
    write_report(out_dir, results)
    failed = [r for r in results if not r.passed]
    for result in failed:
        print(
            f"validate: FAIL {result.name}: observed {result.observed}, expected {result.expected}",
            file=sys.stderr,
        )
    print(
        f"validate: {len(results) - len(failed)}/{len(results)} checks passed; "
        f"report at {out_dir / 'validation_report.md'}"
    )
    return 1 if failed else 0
