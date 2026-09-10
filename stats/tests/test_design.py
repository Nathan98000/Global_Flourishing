"""Design: column bundle + SE-method choice."""

import pytest
from flourish_stats import Design


def test_taylor_when_both_design_columns_given() -> None:
    design = Design(weight="w_c1", strata="strata", psu="psu")
    assert design.se_method == "taylor"
    assert design.columns == ("w_c1", "strata", "psu")


def test_kish_when_neither_given() -> None:
    design = Design(weight="w_c1")
    assert design.se_method == "kish"
    assert design.columns == ("w_c1",)


def test_half_a_design_is_rejected() -> None:
    with pytest.raises(ValueError, match="together"):
        Design(weight="w_c1", strata="strata")
    with pytest.raises(ValueError, match="together"):
        Design(weight="w_c1", psu="psu")
