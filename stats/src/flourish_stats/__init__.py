"""flourish_stats — survey-weighted estimators for the Global Flourishing Study.

Design-based standard errors (Taylor linearisation over strata/PSU, Kish
fallback), domain estimation, suppression, and the wave → weight →
eligibility table, verified against R's ``survey`` package. See
``docs/METHODS.md`` for the plain-language account and ADR-0005/0006 for
the design decisions.
"""

from .design import Design
from .estimators import (
    RESULT_COLUMNS,
    kish_n_eff,
    weighted_mean,
    weighted_proportion,
    weighted_quantile,
)
from .suppression import DEFAULT_POLICY, SuppressionPolicy, suppress
from .weights import (
    WEIGHT_TABLE,
    WeightSpec,
    eligibility_expr,
    get,
    resolve,
    validate_frame,
    weight_table_json,
)

__all__ = [
    "DEFAULT_POLICY",
    "RESULT_COLUMNS",
    "WEIGHT_TABLE",
    "Design",
    "SuppressionPolicy",
    "WeightSpec",
    "eligibility_expr",
    "get",
    "kish_n_eff",
    "resolve",
    "suppress",
    "validate_frame",
    "weight_table_json",
    "weighted_mean",
    "weighted_proportion",
    "weighted_quantile",
]
