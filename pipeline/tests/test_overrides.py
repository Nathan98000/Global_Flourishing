"""The packaged overrides load and satisfy the curation contract."""

from flourish_pipeline.overrides import load_overrides


def test_overrides_load_and_have_expected_shape() -> None:
    overrides = load_overrides()
    non_us = [v for v in overrides.variables.values() if not v.is_us_only]
    us_only = [v for v in overrides.variables.values() if v.is_us_only]
    assert len(non_us) == 169  # one per global CSV base name
    assert len(us_only) == 13  # the 15 US-only columns collapse to 13 bases
    assert overrides.aliases == {"ANNUAL_WEIGHT_1": "ANNUAL_WEIGHT_C1"}
    assert [f.use for f in overrides.heading_fixes] == ["DOI_MY"]


def test_sfi_membership_is_exactly_twelve() -> None:
    overrides = load_overrides()
    sfi = {n: v for n, v in overrides.variables.items() if v.sfi_domain is not None}
    assert sorted(sfi) == sorted(
        [
            "HAPPY",
            "LIFE_SAT",
            "PHYSICAL_HLTH",
            "MENTAL_HEALTH",
            "WORTHWHILE",
            "LIFE_PURPOSE",
            "PROMOTE_GOOD",
            "GIVE_UP",
            "CONTENT",
            "SAT_RELATNSHP",
            "EXPENSES",
            "WORRY_SAFETY",
        ]
    )
    domains = sorted(v.sfi_domain for v in sfi.values() if v.sfi_domain)
    assert all(domains.count(d) == 2 for d in set(domains))
    assert all(v.direction == "higher_better" for v in sfi.values())
    assert all(v.family == "sfi" for v in sfi.values())


def test_drafts_stay_within_budget() -> None:
    overrides = load_overrides()
    drafts = [n for n, v in overrides.variables.items() if v.review_status == "draft"]
    assert len(drafts) <= 10, f"too many drafts for review: {drafts}"


def test_countries_match_the_release() -> None:
    overrides = load_overrides()
    assert len(overrides.countries) == 23
    assert overrides.unused_country_codes == {15, 21}
    assert overrides.countries[19].name == "Türkiye"
    assert overrides.countries[22].iso3 == "USA"
    assert set(overrides.countries) & overrides.unused_country_codes == set()


def test_special_code_rulings_present() -> None:
    overrides = load_overrides()
    assert overrides.variables["INCOME"].special_codes == {9900: "valid"}
    assert overrides.variables["SELFID1"].special_codes == {9997: "valid"}
    assert overrides.variables["SELFID2"].special_codes == {9997: "valid"}
    for name in (
        "OUTSIDER",
        "MOTHER_RELATN",
        "FATHER_RELATN",
        "MOTHER_LOVED",
        "FATHER_LOVED",
        "SVCS_MOTHER",
        "SVCS_FATHER",
    ):
        assert overrides.variables[name].special_codes == {97: "valid"}, name
