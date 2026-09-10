"""Pure-parser tests: the committed ten-entry fixture plus synthetic edges."""

import json
from pathlib import Path

import pytest
from flourish_pipeline.codebook.model import Line, RawEntry
from flourish_pipeline.codebook.parse import parse_entries
from flourish_pipeline.codebook.stage import lines_from_json

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "codebook_lines_sample.json"


@pytest.fixture(scope="module")
def entries() -> list[RawEntry]:
    return parse_entries(lines_from_json(FIXTURE.read_text(encoding="utf-8")))


def by_heading(entries: list[RawEntry], heading: str) -> RawEntry:
    return next(e for e in entries if e.heading == heading)


def test_fixture_is_valid_json_with_ten_entries(entries: list[RawEntry]) -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["source"] == "GFS_codebook_wave2.pdf"
    assert len(entries) == 10


def test_simple_entry(entries: list[RawEntry]) -> None:
    abused = by_heading(entries, "ABUSED")
    assert abused.section == "Main Survey Questions"
    assert abused.variable_label == "Physically or Sexually Abused When Growing Up"
    assert abused.wording == "Were you ever physically or sexually abused when you were growing up?"
    assert [(v.code, v.label) for v in abused.value_labels] == [
        (-98, "(Saw, skipped)"),
        (1, "Yes"),
        (2, "No"),
        (98, "(DK)"),
        (99, "(Refused)"),
    ]


def test_multi_line_label_and_wording(entries: list[RawEntry]) -> None:
    entry = by_heading(entries, "CNTRY_REL_BUD")
    assert entry.variable_label is not None and entry.variable_label.count("\n") == 1
    assert entry.variable_label.startswith("The Teachings of Buddhism")
    assert entry.variable_label.endswith("Not Identified as Current Religion)")
    assert entry.wording is not None and entry.wording.count("\n") == 2
    assert entry.wording.endswith("important in my life.")


def test_zero_ten_endpoints_only(entries: list[RawEntry]) -> None:
    happy = by_heading(entries, "HAPPY")
    valid = [(v.code, v.label) for v in happy.value_labels if not v.label.startswith("(")]
    assert valid == [(0, "Extremely unhappy"), (10, "Extremely happy")]


def test_en_dash_system_variable_with_labels_under_wording(entries: list[RawEntry]) -> None:
    mode = by_heading(entries, "MODE_ANNUAL")
    assert mode.wording is None  # the 1/2/3 rows sit beside "Question Wording:"
    assert [(v.code, v.label) for v in mode.value_labels] == [
        (1, "CAPI"),
        (2, "CATI"),
        (3, "CAWI"),
    ]


def test_glued_equals_separator(entries: list[RawEntry]) -> None:
    wave_my = by_heading(entries, "WAVE_MY")
    assert [(v.code, v.label) for v in wave_my.value_labels] == [(1, "Midyear")]


def test_duplicated_doi_heading_yields_two_entries(entries: list[RawEntry]) -> None:
    pair = [e for e in entries if e.heading == "DOI_ANNUAL_Y2"]
    assert len(pair) == 2
    labels = {e.variable_label for e in pair}
    assert labels == {
        "End Date of Interview – Annual Year 2 Survey",
        "End Date of Interview – Midyear Survey",
    }


def test_empty_system_variable(entries: list[RawEntry]) -> None:
    id_entry = by_heading(entries, "ID")
    assert id_entry.variable_label is None
    assert id_entry.wording is None
    assert id_entry.value_labels == []


def test_joint_selfid_heading(entries: list[RawEntry]) -> None:
    joint = by_heading(entries, "SELFID1 & SELFID2")
    assert joint.section == "Country Specific Demographic Variables"  # two-line title merged
    assert joint.variable_label == (
        "First Identified Race/Ethnicity/Nationality of Respondent\n"
        "Second Identified Race/Ethnicity/Nationality of Respondent"
    )
    assert joint.wording is None
    codes = [v.code for v in joint.value_labels]
    assert codes[0] == -9998
    assert {9995, 9996, 9997, 9998, 9999} <= set(codes)


def test_income_spans_pages_and_keeps_special_codes(entries: list[RawEntry]) -> None:
    income = by_heading(entries, "INCOME_Y1")
    assert income.page_from == 52
    assert income.page_to == 58
    by_code = {v.code: v.label for v in income.value_labels}
    assert by_code[101] == "Argentina: 1,000 pesos or less"
    assert by_code[9900] == "(None/No household income)"
    assert by_code[9998] == "(Does NOT know household income)"


# ------------------------------------------------------------ synthetic edges


def _entry(lines: list[Line]) -> RawEntry:
    parsed = parse_entries([Line(1, 10.0, "section", "Main Survey Questions"), *lines])
    assert len(parsed) == 1
    return parsed[0]


def test_wrapped_value_label_folds_into_previous() -> None:
    entry = _entry(
        [
            Line(1, 20.0, "heading", "EDUCATION_3"),
            Line(1, 30.0, "label", "Variable Label:"),
            Line(1, 30.0, "content", "Highest Completed Level of Education"),
            Line(1, 40.0, "label", "Question Wording:"),
            Line(1, 50.0, "content", "-98 = (Saw, skipped)"),
            Line(1, 60.0, "content", "2 = Secondary - Some secondary education, or"),
            Line(1, 70.0, "content", "some post-secondary education (9-15 years of education)"),
            Line(1, 75.0, "label", "Value labels:"),
            Line(1, 80.0, "content", "99 = (RF)"),
        ]
    )
    assert [(v.code, v.label) for v in entry.value_labels] == [
        (-98, "(Saw, skipped)"),
        (
            2,
            "Secondary - Some secondary education, or some post-secondary education "
            "(9-15 years of education)",
        ),
        (99, "(RF)"),
    ]


def test_wording_starting_with_digits_is_not_a_value_label() -> None:
    entry = _entry(
        [
            Line(1, 20.0, "heading", "DAYS_EXERCISE"),
            Line(1, 30.0, "label", "Variable Label:"),
            Line(1, 30.0, "content", "Days Exercised"),
            Line(1, 40.0, "content", "In the past week, on how many days did you exercise for"),
            Line(1, 45.0, "label", "Question Wording:"),
            Line(1, 50.0, "content", "30 minutes or more in the past week?"),
            Line(1, 60.0, "content", "0 = 0 days"),
        ]
    )
    assert entry.wording == (
        "In the past week, on how many days did you exercise for\n"
        "30 minutes or more in the past week?"
    )
    assert [(v.code, v.label) for v in entry.value_labels] == [(0, "0 days")]


def test_rel9_bare_and_period_separators() -> None:
    entry = _entry(
        [
            Line(1, 20.0, "heading", "REL9"),
            Line(1, 30.0, "label", "Variable Label:"),
            Line(1, 30.0, "content", "Buddhist Sect You Most Identify With"),
            Line(1, 40.0, "label", "Question Wording:"),
            Line(1, 40.0, "content", "Which of the following sects do you most identify with?"),
            Line(1, 50.0, "content", "-98. (Saw, skipped)"),
            Line(1, 60.0, "content", "1 Jodo sect (Honen)"),
            Line(1, 70.0, "content", "96 Some other sect"),
            Line(1, 80.0, "label", "Value labels:"),
            Line(1, 90.0, "content", "99 = (Refused)"),
        ]
    )
    assert [(v.code, v.label) for v in entry.value_labels] == [
        (-98, "(Saw, skipped)"),
        (1, "Jodo sect (Honen)"),
        (96, "Some other sect"),
        (99, "(Refused)"),
    ]


def test_label_level_with_first_wording_line_splits_blocks_correctly() -> None:
    # CLOSE_TO layout: the variable-label text sits level with its label, the
    # three wording lines wrap around a centred "Question Wording:".
    entry = _entry(
        [
            Line(1, 20.0, "heading", "CLOSE_TO"),
            Line(1, 30.0, "label", "Variable Label:"),
            Line(1, 30.0, "content", "Know One Special Person"),
            Line(1, 40.0, "content", "Is there any one special person you know?"),
            Line(1, 50.0, "label", "Question Wording:"),
            Line(1, 50.0, "content", "For example, someone you can confide in."),
            Line(1, 60.0, "content", "If more than one, select Yes."),
            Line(1, 70.0, "content", "1 = Yes"),
        ]
    )
    assert entry.variable_label == "Know One Special Person"
    assert entry.wording == (
        "Is there any one special person you know?\n"
        "For example, someone you can confide in.\n"
        "If more than one, select Yes."
    )


def test_table_of_contents_section_is_dropped() -> None:
    parsed = parse_entries(
        [
            Line(2, 10.0, "section", "Table of Contents"),
            Line(2, 20.0, "content", "3"),
            Line(3, 10.0, "section", "Main Survey Questions"),
            Line(4, 20.0, "heading", "HAPPY"),
            Line(4, 30.0, "label", "Variable Label:"),
            Line(4, 30.0, "content", "How Happy You Usually Feel"),
        ]
    )
    assert [(e.heading, e.section) for e in parsed] == [("HAPPY", "Main Survey Questions")]


def test_two_section_lines_on_one_page_merge() -> None:
    parsed = parse_entries(
        [
            Line(51, 10.0, "section", "Country Specific"),
            Line(51, 40.0, "section", "Demographic Variables"),
            Line(52, 20.0, "heading", "INCOME_Y1"),
            Line(52, 30.0, "label", "Variable Label:"),
        ]
    )
    assert parsed[0].section == "Country Specific Demographic Variables"


def test_consecutive_section_lines_on_different_pages_do_not_merge() -> None:
    parsed = parse_entries(
        [
            Line(2, 10.0, "section", "Table of Contents"),
            Line(3, 10.0, "section", "Main Survey Questions"),
            Line(4, 20.0, "heading", "HAPPY"),
            Line(4, 30.0, "label", "Variable Label:"),
        ]
    )
    assert parsed[0].section == "Main Survey Questions"
