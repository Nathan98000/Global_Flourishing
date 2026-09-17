"""The derived-score registry: components, scoring rules, no-suppression."""

from flourish_stats import NO_SUPPRESSION
from flourish_stats.outcomes import (
    DERIVED_OUTCOMES,
    GAD2_ITEMS,
    PHQ2_ITEMS,
    SCREEN_POSITIVE_AT,
    SFI_DOMAINS,
    SFI_ITEMS,
    SFI_MIN_ITEMS,
)


def test_sfi_components_are_the_twelve_items() -> None:
    assert DERIVED_OUTCOMES["sfi"].components == SFI_ITEMS
    assert len(SFI_ITEMS) == 12
    assert len(set(SFI_ITEMS)) == 12


def test_each_domain_carries_its_pair() -> None:
    for domain, items in SFI_DOMAINS.items():
        outcome = DERIVED_OUTCOMES[f"sfi_{domain}"]
        assert outcome.components == items
        assert len(items) == 2


def test_screeners_carry_their_items_and_threshold() -> None:
    for name in ("phq2_score", "phq2_positive"):
        assert DERIVED_OUTCOMES[name].components == PHQ2_ITEMS
    for name in ("gad2_score", "gad2_positive"):
        assert DERIVED_OUTCOMES[name].components == GAD2_ITEMS
    for name in ("phq2_positive", "gad2_positive"):
        assert str(SCREEN_POSITIVE_AT) in DERIVED_OUTCOMES[name].scoring


def test_scoring_rules_carry_the_registry_numbers() -> None:
    assert str(SFI_MIN_ITEMS) in DERIVED_OUTCOMES["sfi"].scoring
    for outcome in DERIVED_OUTCOMES.values():
        assert outcome.scoring
        assert outcome.components


def test_no_suppression_never_withholds_or_flags() -> None:
    # n < 0 is never true for a cell size, so nothing suppresses or flags.
    for n in (0, 1, 5, 49, 99, 10_000):
        assert NO_SUPPRESSION.apply(n) == (False, False)
