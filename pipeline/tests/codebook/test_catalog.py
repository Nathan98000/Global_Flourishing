"""Catalog builder tests: classification units, a fixture-driven build with
synthetic overrides, and a full-data integration build (marked raw)."""

from pathlib import Path

import pytest
from flourish_pipeline.codebook.catalog import (
    Catalog,
    CatalogError,
    CoverageReport,
    ValueLabelRecord,
    build_catalog,
    classify_nonresponse,
    expand_scale_labels,
)
from flourish_pipeline.codebook.model import RawEntry, ValueLabelRaw
from flourish_pipeline.codebook.parse import parse_entries
from flourish_pipeline.codebook.stage import lines_from_json
from flourish_pipeline.columns import read_header
from flourish_pipeline.overrides import (
    Country,
    HeadingFix,
    Overrides,
    VariableOverride,
    load_overrides,
)

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "codebook_lines_sample.json"

Built = tuple[Catalog, CoverageReport]


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("(Saw, skipped)", "skipped"),
        ("(DK)", "dk"),
        ("(Does NOT know household income)", "dk"),
        ("(Refused)", "refused"),
        ("(RF)", "refused"),
        ("(Refused to give household income)", "refused"),
        ("Yes", None),
        ("Mestizo(a)", None),  # parentheses inside a label are not a sentinel
        ("99+", None),
        ("(None/No household income)", "unresolved"),
        ("(Does not apply)", "unresolved"),
    ],
)
def test_classify_nonresponse(label: str, expected: str | None) -> None:
    assert classify_nonresponse(label) == expected


def test_expand_scale_labels_fills_unlabelled_codes() -> None:
    records = [
        ValueLabelRecord("HAPPY", None, None, 0, "Extremely unhappy", False),
        ValueLabelRecord("HAPPY", None, None, 10, "Extremely happy", False),
    ]
    expanded = expand_scale_labels(records)
    assert {r.code for r in expanded} == set(range(11))
    assert next(r.label for r in expanded if r.code == 5) == ""


def _override(
    name: str, family: str, special_codes: dict[int, str] | None = None
) -> VariableOverride:
    return VariableOverride(
        name=name,
        display_name=name.title(),
        family=family,
        special_codes=special_codes or {},
    )


def _overrides(variables: dict[str, VariableOverride]) -> Overrides:
    return Overrides(
        variables=variables,
        aliases={},
        heading_fixes=(
            HeadingFix(heading="DOI_ANNUAL_Y2", when_label_contains="Midyear", use="DOI_MY"),
        ),
        allow_unmatched_headings=frozenset(),
        allow_undocumented_columns=frozenset(),
        countries={
            1: Country(1, "Argentina", "ARG"),
            2: Country(2, "Australia", "AUS"),
        },
        unused_country_codes=frozenset(),
    )


def _fixture_overrides() -> Overrides:
    return _overrides(
        {
            "ABUSED": _override("ABUSED", "childhood"),
            "CNTRY_REL_BUD": _override("CNTRY_REL_BUD", "religion"),
            "HAPPY": VariableOverride(
                name="HAPPY",
                display_name="Happiness",
                family="sfi",
                direction="higher_better",
                sfi_domain="happiness",
            ),
            "MODE_ANNUAL": _override("MODE_ANNUAL", "design"),
            "WAVE": _override("WAVE", "design"),
            "DOI_ANNUAL": _override("DOI_ANNUAL", "design"),
            "DOI": _override("DOI", "design"),
            "ID": _override("ID", "design"),
            "SELFID1": _override("SELFID1", "demographics", {9997: "valid"}),
            "SELFID2": _override("SELFID2", "demographics", {9997: "valid"}),
            "INCOME": _override("INCOME", "demographics", {9900: "valid"}),
        }
    )


GLOBAL_COLUMNS = [
    "ID",
    "WAVE_Y1",
    "WAVE_Y2",
    "WAVE_MY",
    "MODE_ANNUAL",
    "DOI_ANNUAL_Y1",
    "DOI_ANNUAL_Y2",
    "DOI_MY",
    "ABUSED_Y1",
    "CNTRY_REL_BUD_Y1",
    "HAPPY_Y1",
    "HAPPY_Y2",
    "INCOME_Y1",
    "INCOME_Y2",
    "SELFID1",
    "SELFID2",
]


@pytest.fixture(scope="module")
def built() -> Built:
    entries = parse_entries(lines_from_json(FIXTURE.read_text(encoding="utf-8")))
    return build_catalog(entries, GLOBAL_COLUMNS, [], _fixture_overrides())


def test_fixture_build_covers_all_bases(built: Built) -> None:
    catalog, report = built
    assert report.ok
    assert [v.name for v in catalog.variables] == sorted(
        [
            "ID",
            "WAVE",
            "MODE_ANNUAL",
            "DOI_ANNUAL",
            "DOI",
            "ABUSED",
            "CNTRY_REL_BUD",
            "HAPPY",
            "INCOME",
            "SELFID1",
            "SELFID2",
        ]
    )


def test_scale_inference(built: Built) -> None:
    catalog, _ = built
    by_name = {v.name: v for v in catalog.variables}
    assert by_name["HAPPY"].scale_type == "scale_0_10"
    assert (by_name["HAPPY"].min, by_name["HAPPY"].max) == (0, 10)
    assert by_name["ABUSED"].scale_type == "binary"
    assert by_name["MODE_ANNUAL"].scale_type == "design"
    assert by_name["DOI"].scale_type == "date"
    assert by_name["ID"].scale_type == "id"
    assert by_name["INCOME"].scale_type == "nominal"
    assert by_name["INCOME"].is_country_specific


def test_happy_labels_expanded_to_full_scale(built: Built) -> None:
    catalog, _ = built
    happy = [r for r in catalog.value_labels if r.variable == "HAPPY"]
    valid = [r for r in happy if not r.is_nonresponse]
    assert {r.code for r in valid} == set(range(11))
    assert next(r.label for r in valid if r.code == 4) == ""


def test_waves_come_from_csv_headers_not_pdf(built: Built) -> None:
    catalog, _ = built
    by_name = {v.name: v for v in catalog.variables}
    assert by_name["HAPPY"].waves_available == ["Y1", "Y2"]
    assert by_name["CNTRY_REL_BUD"].waves_available == ["Y1"]
    assert by_name["WAVE"].waves_available == ["Y1", "MY", "Y2"]
    assert by_name["DOI"].waves_available == ["MY"]
    assert by_name["SELFID1"].waves_available == []  # unsuffixed column


def test_duplicate_doi_heading_disambiguated(built: Built) -> None:
    catalog, _ = built
    by_name = {v.name: v for v in catalog.variables}
    assert by_name["DOI"].label == "End Date of Interview – Midyear Survey"
    assert by_name["DOI"].codebook_headings == ["DOI_MY"]
    assert by_name["DOI_ANNUAL"].label == "End Date of Interview – Annual Year 2 Survey"


def test_selfid_joint_entry_split(built: Built) -> None:
    catalog, _ = built
    by_name = {v.name: v for v in catalog.variables}
    assert by_name["SELFID1"].label == "First Identified Race/Ethnicity/Nationality of Respondent"
    assert by_name["SELFID2"].label == "Second Identified Race/Ethnicity/Nationality of Respondent"
    labels_1 = [r for r in catalog.value_labels if r.variable == "SELFID1"]
    labels_2 = [r for r in catalog.value_labels if r.variable == "SELFID2"]
    assert len(labels_1) == len(labels_2) > 0
    special = next(r for r in labels_1 if r.code == 9997)
    assert not special.is_nonresponse


def test_income_wave_tagging_and_special_codes(built: Built) -> None:
    catalog, _ = built
    income = [r for r in catalog.value_labels if r.variable == "INCOME"]
    # The fixture holds only the INCOME_Y1 entry, so labels stay untagged;
    # per-wave tagging with both entries is covered below and on real data.
    assert {r.wave for r in income} == {None}
    special = next(r for r in income if r.code == 9900)
    assert not special.is_nonresponse
    first_band = next(r for r in income if r.code == 101)
    assert first_band.country_code == 1
    assert first_band.label == "1,000 pesos or less"  # country prefix stripped
    by_name = {v.name: v for v in catalog.variables}
    assert by_name["INCOME"].nonresponse_codes == {
        "skipped": [-9998],
        "dk": [9998],
        "refused": [9999],
    }


def test_per_wave_entries_tag_their_value_labels() -> None:
    entries = [
        RawEntry(
            heading="INCOME_Y1",
            section=None,
            variable_label="Income",
            wording=None,
            value_labels=[ValueLabelRaw(101, "Argentina: 1,000 pesos or less")],
            page_from=1,
            page_to=1,
        ),
        RawEntry(
            heading="INCOME_Y2",
            section=None,
            variable_label="Income",
            wording=None,
            value_labels=[ValueLabelRaw(101, "Argentina: 10,000 pesos or less")],
            page_from=2,
            page_to=2,
        ),
    ]
    overrides = _overrides({"INCOME": _override("INCOME", "demographics")})
    catalog, report = build_catalog(entries, ["INCOME_Y1", "INCOME_Y2"], [], overrides)
    assert report.ok
    labels = [(r.wave, r.label) for r in catalog.value_labels]
    assert labels == [
        ("Y1", "1,000 pesos or less"),
        ("Y2", "10,000 pesos or less"),
    ]


def test_unresolved_parenthesised_label_fails_without_ruling() -> None:
    entries = [
        RawEntry(
            heading="INCOME_Y1",
            section=None,
            variable_label="Income",
            wording=None,
            value_labels=[ValueLabelRaw(9900, "(None/No household income)")],
            page_from=1,
            page_to=1,
        )
    ]
    overrides = _overrides({"INCOME": _override("INCOME", "demographics")})
    with pytest.raises(CatalogError, match="special_codes"):
        build_catalog(entries, ["INCOME_Y1"], [], overrides)


def test_unexpected_duplicate_heading_fails() -> None:
    entry = RawEntry(
        heading="HAPPY",
        section=None,
        variable_label="x",
        wording=None,
        value_labels=[],
        page_from=1,
        page_to=1,
    )
    overrides = _overrides({"HAPPY": _override("HAPPY", "sfi")})
    with pytest.raises(CatalogError, match="duplicate"):
        build_catalog([entry, entry], ["HAPPY_Y1"], [], overrides)


def test_undocumented_column_reported() -> None:
    catalog, report = build_catalog([], ["MYSTERY_Y1"], [], _overrides({}))
    assert not catalog.variables
    assert report.undocumented_columns == ["MYSTERY"]
    assert not report.ok


def test_stale_override_fails() -> None:
    overrides = _overrides({"GHOST": _override("GHOST", "design")})
    with pytest.raises(CatalogError, match="not in any CSV"):
        build_catalog([], [], [], overrides)


# ------------------------------------------------------------- full build


@pytest.mark.raw
def test_full_catalog_build_is_clean(raw_dir: Path) -> None:
    from flourish_pipeline.codebook.extract import extract_lines

    entries = parse_entries(extract_lines(raw_dir / "GFS_codebook_wave2.pdf"))
    catalog, report = build_catalog(
        entries,
        read_header(raw_dir / "gfs_all_countries_wave2_with_midyear.csv"),
        read_header(raw_dir / "gfs_us-state-weight_wave2_with-midyear.csv"),
        load_overrides(),
    )
    assert report.ok
    assert sum(1 for v in catalog.variables if not v.is_us_only) == 169
    assert sum(1 for v in catalog.variables if v.is_us_only) == 13
    assert len(report.drafts) <= 10
    sfi = [v for v in catalog.variables if v.sfi_domain is not None]
    assert len(sfi) == 12
    assert all(v.direction == "higher_better" and v.scale_type == "scale_0_10" for v in sfi)
    domains = sorted(v.sfi_domain for v in sfi if v.sfi_domain)
    assert domains == sorted(
        [
            "happiness",
            "happiness",
            "health",
            "health",
            "meaning",
            "meaning",
            "character",
            "character",
            "relationships",
            "relationships",
            "financial",
            "financial",
        ]
    )
