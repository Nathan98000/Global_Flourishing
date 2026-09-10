"""The ``codebook`` pipeline stage: orchestration and file output.

Reads the PDF + the two CSV headers (never a data row), builds the catalog,
and writes::

    data/catalog.json               the catalog
    data/catalog.schema.json        its JSON Schema
    data/catalog/variables.parquet  the variables table
    data/catalog/value_labels.parquet
    data/catalog_coverage.md        column ↔ codebook coverage report

Fails (exit 1) unless every CSV column maps to a catalog entry and every
codebook heading maps to a column, or the exception is allow-listed in the
overrides.
"""

from __future__ import annotations

import dataclasses
import json
import sys
from pathlib import Path

import polars as pl

from .. import __version__
from ..columns import CODEBOOK_PDF, GLOBAL_CSV, US_CSV, base_name, read_header
from ..overrides import Overrides, load_overrides
from .catalog import Catalog, CatalogError, CoverageReport, build_catalog
from .extract import extract_lines
from .model import WAVES, Line, RawEntry
from .parse import VALUE_LABEL_RE, parse_entries
from .schema import catalog_json_schema

# The ten real entries committed as the parse fixture
# (pipeline/tests/fixtures/codebook_lines_sample.json), chosen to cover the
# layout quirks; INCOME_Y1 and SELFID1 & SELFID2 are truncated to two
# countries (a ten-entry excerpt is documentation, not microdata).
FIXTURE_HEADINGS: tuple[str, ...] = (
    "ABUSED",  # simple item
    "CNTRY_REL_BUD",  # multi-line label AND wording, 0-10 endpoints
    "HAPPY",  # 0-10 endpoint-only scale
    "MODE_ANNUAL",  # en-dash separators, labels under Question Wording
    "WAVE_MY",  # glued "1=" separator
    "DOI_ANNUAL_Y2",  # duplicated heading (both occurrences; 2nd is DOI_MY)
    "ID",  # empty system variable
    "SELFID1 & SELFID2",  # joint heading
    "INCOME_Y1",  # page-spanning country-specific list
)
_TRUNCATED_HEADINGS = frozenset({"SELFID1 & SELFID2", "INCOME_Y1"})


def _keep_fixture_line(heading: str, line: Line) -> bool:
    if heading not in _TRUNCATED_HEADINGS or line.column != "content":
        return True
    match = VALUE_LABEL_RE.match(line.text)
    if match is None:
        return True
    code = abs(int(match.group(1) or match.group(3)))
    return code < 300 or code >= 9000  # Argentina/Australia bands + sentinels/specials


def select_fixture_lines(lines: list[Line]) -> list[Line]:
    """The committed fixture: section lines + the ten chosen entries."""
    wanted = set(FIXTURE_HEADINGS)
    picked: list[Line] = []
    section_buffer: list[Line] = []
    section_flushed = False
    current: str | None = None
    for line in lines:
        if line.column == "section":
            if not section_buffer or section_buffer[-1].page == line.page:
                section_buffer.append(line)
            else:
                section_buffer = [line]
            section_flushed = False
            current = None
            continue
        if line.column == "heading":
            current = line.text if line.text in wanted else None
            if current is not None:
                if not section_flushed:
                    picked.extend(section_buffer)
                    section_flushed = True
                picked.append(line)
            continue
        if current is not None and _keep_fixture_line(current, line):
            picked.append(line)
    return picked


def lines_to_json(lines: list[Line]) -> str:
    payload = {
        "source": CODEBOOK_PDF,
        "regenerate_with": "flourish-pipeline codebook --dump-lines <path>",
        "note": (
            "Ten real codebook entries covering the layout quirks; "
            "INCOME_Y1 and SELFID1 & SELFID2 truncated to two countries."
        ),
        "lines": [[line.page, line.y, line.column, line.text] for line in lines],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def lines_from_json(text: str) -> list[Line]:
    payload = json.loads(text)
    return [Line(int(page), float(y), column, text_) for page, y, column, text_ in payload["lines"]]


def draft_overrides_yaml(entries: list[RawEntry], overrides: Overrides) -> str:
    """A review-ready YAML skeleton for entries missing from the overrides.

    Meant for the next codebook (Wave 3): endpoint labels are embedded so
    direction can be judged from evidence, and everything is marked draft.
    """
    known = set(overrides.variables)
    blocks: list[str] = [
        "# DRAFT overrides — review every entry by hand, then merge into",
        "# variables.yaml (drop the endpoints comments, set review_status).",
        "variables:",
    ]
    for entry in entries:
        base = base_name(entry.heading)
        if base in known or entry.heading in known or entry.heading in overrides.aliases:
            continue
        label = (entry.variable_label or entry.heading).replace("\n", " ")
        valid = [v for v in entry.value_labels if not v.label.startswith("(")]
        blocks.append(f"  {entry.heading}:")
        blocks.append(f"    display_name: {json.dumps(label[:60])}")
        blocks.append("    family: TODO")
        blocks.append("    review_status: draft")
        if valid:
            lo, hi = min(valid, key=lambda v: v.code), max(valid, key=lambda v: v.code)
            blocks.append(
                f"    # endpoints: {lo.code} = {lo.label[:40]!r} … {hi.code} = {hi.label[:40]!r}"
            )
    if blocks[-1] == "variables:":
        blocks.append("  {}  # nothing missing — all entries covered")
    return "\n".join(blocks) + "\n"


def _coverage_markdown(report: CoverageReport, catalog: Catalog) -> str:
    lines = [
        "# Catalog coverage",
        "",
        "Written by `flourish-pipeline codebook`; regenerate with `make data`.",
        "",
        f"- variables in catalog: **{len(catalog.variables)}** "
        f"({sum(1 for v in catalog.variables if not v.is_us_only)} global base names, "
        f"{sum(1 for v in catalog.variables if v.is_us_only)} US-file-only)",
        f"- value labels: **{len(catalog.value_labels)}**",
        f"- codebook entries mapped: **{len(catalog.aliases)}**",
        "",
        "## CSV columns without a catalog entry",
        "",
    ]
    lines += [f"- `{c}`" for c in report.undocumented_columns] or ["(none)"]
    lines += ["", "## Codebook headings without a CSV column", ""]
    lines += [f"- `{h}`" for h in report.unmatched_headings] or ["(none)"]
    lines += ["", "## Variables still marked draft (need review)", ""]
    lines += [f"- `{d}`" for d in report.drafts] or ["(none)"]
    return "\n".join(lines) + "\n"


def _catalog_json(catalog: Catalog) -> str:
    payload = {
        "meta": {
            "generated_by": f"flourish-pipeline {__version__}",
            "source_pdf": CODEBOOK_PDF,
            "waves": list(WAVES),
        },
        "variables": [dataclasses.asdict(v) for v in catalog.variables],
        "value_labels": [dataclasses.asdict(v) for v in catalog.value_labels],
        "countries": [dataclasses.asdict(c) for c in catalog.countries],
        "aliases": [
            {
                "heading": a.heading,
                "variable": a.variable,
                "variable_label": a.variable_label,
                "pages": list(a.pages),
            }
            for a in catalog.aliases
        ],
    }
    return json.dumps(payload, indent=2, ensure_ascii=False) + "\n"


def variables_frame(catalog: Catalog) -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "name": v.name,
                "display_name": v.display_name,
                "label": v.label,
                "wording": v.wording,
                "section": v.section,
                "family": v.family,
                "scale_type": v.scale_type,
                "direction": v.direction,
                "min": v.min,
                "max": v.max,
                "waves_available": v.waves_available,
                "is_country_specific": v.is_country_specific,
                "is_us_only": v.is_us_only,
                "sfi_domain": v.sfi_domain,
                "nonresponse_skipped": v.nonresponse_codes["skipped"],
                "nonresponse_dk": v.nonresponse_codes["dk"],
                "nonresponse_refused": v.nonresponse_codes["refused"],
                "restricted": v.restricted,
                "review_status": v.review_status,
                "page_from": None if v.source_pages is None else v.source_pages[0],
                "page_to": None if v.source_pages is None else v.source_pages[1],
                "notes": v.notes,
            }
            for v in catalog.variables
        ],
        schema={
            "name": pl.String,
            "display_name": pl.String,
            "label": pl.String,
            "wording": pl.String,
            "section": pl.String,
            "family": pl.String,
            "scale_type": pl.String,
            "direction": pl.String,
            "min": pl.Int16,
            "max": pl.Int16,
            "waves_available": pl.List(pl.String),
            "is_country_specific": pl.Boolean,
            "is_us_only": pl.Boolean,
            "sfi_domain": pl.String,
            "nonresponse_skipped": pl.List(pl.Int16),
            "nonresponse_dk": pl.List(pl.Int16),
            "nonresponse_refused": pl.List(pl.Int16),
            "restricted": pl.Boolean,
            "review_status": pl.String,
            "page_from": pl.Int16,
            "page_to": pl.Int16,
            "notes": pl.String,
        },
    )


def value_labels_frame(catalog: Catalog) -> pl.DataFrame:
    return pl.DataFrame(
        [dataclasses.asdict(v) for v in catalog.value_labels],
        schema={
            "variable": pl.String,
            "wave": pl.String,
            "country_code": pl.Int16,
            "code": pl.Int16,
            "label": pl.String,
            "is_nonresponse": pl.Boolean,
        },
    )


def run_codebook(
    raw_dir: Path,
    out_dir: Path,
    *,
    dump_lines: Path | None = None,
    draft_overrides: Path | None = None,
) -> int:
    pdf_path = raw_dir / CODEBOOK_PDF
    for required in (pdf_path, raw_dir / GLOBAL_CSV, raw_dir / US_CSV):
        if not required.exists():
            print(f"codebook: missing input {required} (see data/README.md)", file=sys.stderr)
            return 1

    lines = extract_lines(pdf_path)
    entries = parse_entries(lines)
    overrides = load_overrides()

    if dump_lines is not None:
        dump_lines.parent.mkdir(parents=True, exist_ok=True)
        dump_lines.write_text(lines_to_json(select_fixture_lines(lines)), encoding="utf-8")
        print(f"codebook: wrote fixture lines to {dump_lines}")
    if draft_overrides is not None:
        draft_overrides.parent.mkdir(parents=True, exist_ok=True)
        draft_overrides.write_text(draft_overrides_yaml(entries, overrides), encoding="utf-8")
        print(f"codebook: wrote draft overrides to {draft_overrides}")

    try:
        catalog, report = build_catalog(
            entries,
            read_header(raw_dir / GLOBAL_CSV),
            read_header(raw_dir / US_CSV),
            overrides,
        )
    except CatalogError as error:
        print(f"codebook: {error}", file=sys.stderr)
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "catalog").mkdir(parents=True, exist_ok=True)
    (out_dir / "catalog.json").write_text(_catalog_json(catalog), encoding="utf-8")
    (out_dir / "catalog.schema.json").write_text(
        json.dumps(catalog_json_schema(), indent=2) + "\n", encoding="utf-8"
    )
    variables_frame(catalog).write_parquet(
        out_dir / "catalog" / "variables.parquet", compression="zstd"
    )
    value_labels_frame(catalog).write_parquet(
        out_dir / "catalog" / "value_labels.parquet", compression="zstd"
    )
    coverage = _coverage_markdown(report, catalog)
    (out_dir / "catalog_coverage.md").write_text(coverage, encoding="utf-8")
    print(coverage, end="")

    if not report.ok:
        print(
            "codebook: coverage is not clean — fix the overrides or allow-list "
            "the exceptions (see data/catalog_coverage.md)",
            file=sys.stderr,
        )
        return 1
    return 0
