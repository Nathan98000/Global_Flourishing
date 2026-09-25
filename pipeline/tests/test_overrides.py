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


def test_religion_subtopics_pin_the_membership() -> None:
    """The Religion & spirituality family is the one with subtopics (the
    picker's second step — ADR-0016): every one of its 45 items carries a
    subfamily code, no other family carries any, and the six groups hold
    9 / 5 / 4 / 5 / 15 / 7 items."""
    overrides = load_overrides()
    religion = {n: v for n, v in overrides.variables.items() if v.family == "religion"}
    assert len(religion) == 45
    assert all(v.subfamily is not None for v in religion.values())
    assert all(v.subfamily is None for v in overrides.variables.values() if v.family != "religion")
    counts = {
        code: sum(v.subfamily == code for v in religion.values())
        for code in (
            "affiliation",
            "beliefs",
            "practice",
            "daily_life",
            "teachings",
            "teachings_country",
        )
    }
    assert counts == {
        "affiliation": 9,
        "beliefs": 5,
        "practice": 4,
        "daily_life": 5,
        "teachings": 15,
        "teachings_country": 7,
    }
    assert {n for n, v in religion.items() if v.subfamily == "affiliation"} == {
        f"REL{i}" for i in range(1, 10)
    }
    assert {n for n, v in religion.items() if v.subfamily == "teachings_country"} == {
        n for n in religion if n.startswith("CNTRY_REL_")
    }


def test_no_draft_variables_remain() -> None:
    # All 169 + 13 variables were reviewed by hand (the last six on
    # 2026-09-10); a new codebook entry starts as draft and must be
    # resolved before it lands.
    overrides = load_overrides()
    drafts = [n for n, v in overrides.variables.items() if v.review_status == "draft"]
    assert drafts == [], f"unreviewed variables: {drafts}"


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


def test_polarity_follows_the_label_not_the_direction() -> None:
    """ADR-0015: polarity says which end of the coded scale is the most of
    what the display name names. Set from the labelled endpoints alone."""
    overrides = load_overrides()
    variables = overrides.variables
    # The PHQ-2/GAD-2 items are 1 = Nearly every day: the lowest code is
    # the most depressed/anxious, whatever the better-or-worse direction.
    for name in ("DEPRESSED", "INTEREST", "FEEL_ANXIOUS", "CONTROL_WORRY"):
        assert variables[name].polarity == "descending", name
        assert variables[name].direction == "higher_better", name
    # Every 1 = Yes / 2 = No item: the named thing is the Yes.
    for name in ("CLOSE_TO", "DONATED", "VOLUNTEERED", "HELP_STRANGER", "ABUSED"):
        assert variables[name].polarity == "descending", name
    # Owner decision (24 Sept): Yes is better for these three, No for HEALTH_PROB.
    for name in ("CLOSE_TO", "ACHIEVING", "BEAUTY"):
        assert variables[name].direction == "lower_better", name
    assert variables["HEALTH_PROB"].direction == "higher_better"
    # 1 = Always … 4 = Never and 1 = More than once a week … 5 = Never.
    for name in ("CAPABLE", "LIFE_BALANCE", "PEACE", "ATTEND_SVCS", "TRUST_PEOPLE"):
        assert variables[name].polarity == "descending", name
    assert all(variables[f"TRAITS{i}"].polarity == "descending" for i in range(1, 11))
    # Named as their upward end: "Not feeling lonely" is 0 = Always … 10 = Never.
    for name in ("LONELY", "SUFFERING", "BODILY_PAIN", "DISCRIMINATED", "EDUCATION_3"):
        assert variables[name].polarity == "ascending", name
    # The SFI items and every 0–10 scale run upward as coded.
    assert all(v.polarity == "ascending" for v in variables.values() if v.sfi_domain)
    assert sum(v.polarity == "descending" for v in variables.values()) == 46


def test_short_labels_shorten_the_long_breakdown_answers() -> None:
    """Answers whose codebook wording runs past ~30 characters carry a
    short display label for controls and axes (the codebook keeps the
    full wording)."""
    overrides = load_overrides()
    assert overrides.variables["EDUCATION_3"].short_labels == {
        1: "Primary or less",
        2: "Secondary",
        3: "Tertiary",
    }
    assert overrides.variables["EMPLOYMENT"].short_labels == {
        6: "Unemployed, looking",
        8: "Out of work (reserve duty)",
    }
    assert overrides.variables["GENDER"].short_labels == {}
