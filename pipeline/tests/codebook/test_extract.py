"""Integration tests against the real PDF (skipped when data/raw/ is empty)."""

from collections import Counter
from pathlib import Path

import pytest
from flourish_pipeline.codebook.extract import extract_lines
from flourish_pipeline.codebook.model import Line
from flourish_pipeline.codebook.parse import parse_entries
from flourish_pipeline.codebook.stage import lines_from_json, lines_to_json, select_fixture_lines

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "codebook_lines_sample.json"

pytestmark = pytest.mark.raw


@pytest.fixture(scope="module")
def lines(raw_dir: Path) -> list[Line]:
    return extract_lines(raw_dir / "GFS_codebook_wave2.pdf")


def test_heading_counts(lines: list[Line]) -> None:
    headings = [line.text for line in lines if line.column == "heading"]
    # The two CSVs have 169 unique base column names; the codebook prints
    # 172 heading lines for them: 171 unique headings (DOI_ANNUAL_Y2 twice,
    # the second being DOI_MY), with INCOME_Y1/INCOME_Y2 as two entries for
    # one column and "SELFID1 & SELFID2" as one entry for two columns.
    assert len(headings) == 172
    counts = Counter(headings)
    assert len(counts) == 171
    assert [h for h, n in counts.items() if n > 1] == ["DOI_ANNUAL_Y2"]
    assert "SELFID1 & SELFID2" in counts
    assert counts["INCOME_Y1"] == 1 and counts["INCOME_Y2"] == 1


def test_sections_in_document_order(lines: list[Line]) -> None:
    sections = [line.text for line in lines if line.column == "section"]
    assert sections == [
        "Table of Contents",
        "Main Survey Questions",
        "Midyear Survey Questions",
        "System Variables",
        "Demographic Variables",
        "Country Specific",  # two-line title, merged by the parser
        "Demographic Variables",
    ]


def test_parse_yields_all_entries_with_sections(lines: list[Line]) -> None:
    entries = parse_entries(lines)
    assert len(entries) == 172
    by_section = Counter(e.section for e in entries)
    assert by_section == {
        "Main Survey Questions": 117,
        "Midyear Survey Questions": 15,
        "System Variables": 22,
        "Demographic Variables": 11,
        "Country Specific Demographic Variables": 7,
    }


def test_committed_fixture_is_reproducible(lines: list[Line]) -> None:
    regenerated = lines_to_json(select_fixture_lines(lines))
    assert regenerated == FIXTURE.read_text(encoding="utf-8"), (
        "fixture drifted; regenerate with "
        "`flourish-pipeline codebook --dump-lines pipeline/tests/fixtures/"
        "codebook_lines_sample.json`"
    )


def test_fixture_round_trips(lines: list[Line]) -> None:
    selected = select_fixture_lines(lines)
    assert lines_from_json(lines_to_json(selected)) == selected
