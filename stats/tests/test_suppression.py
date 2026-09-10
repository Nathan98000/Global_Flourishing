"""Suppression policy: pure, parameterised, monotone."""

import pytest
from flourish_stats import SuppressionPolicy, suppress


def test_default_thresholds() -> None:
    assert suppress(0) == (True, False)
    assert suppress(49) == (True, False)
    assert suppress(50) == (False, True)
    assert suppress(99) == (False, True)
    assert suppress(100) == (False, False)
    assert suppress(10_000) == (False, False)


def test_thresholds_are_parameters() -> None:
    assert suppress(49, threshold=10, flag_below=20) == (False, False)
    assert suppress(5, threshold=10, flag_below=20) == (True, False)
    assert suppress(15, threshold=10, flag_below=20) == (False, True)
    assert suppress(0, threshold=0, flag_below=0) == (False, False)


def test_policy_object_applies_its_thresholds() -> None:
    policy = SuppressionPolicy(threshold=30, flag_below=60)
    assert policy.apply(29) == (True, False)
    assert policy.apply(30) == (False, True)
    assert policy.apply(60) == (False, False)


def test_negative_n_rejected() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        suppress(-1)
