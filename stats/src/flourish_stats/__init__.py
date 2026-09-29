"""flourish_stats — survey-weighted estimators for the Global Flourishing Study.

Design-based standard errors (Taylor linearisation over strata/PSU, Kish
fallback), domain estimation, panel change, transition matrices,
correlations, suppression, and the wave → weight → eligibility table,
verified against R's ``survey`` package. See ``docs/METHODS.md`` for the
plain-language account and ADR-0005/0006 for the design decisions.
"""

from .averaging import average_countries
from .correlations import adjusted_association, weighted_correlation, weighted_correlations
from .design import Design
from .estimators import (
    RESULT_COLUMNS,
    kish_n_eff,
    weighted_distribution,
    weighted_mean,
    weighted_proportion,
    weighted_quantile,
)
from .panel import (
    paired_change,
    paired_change_distribution,
    paired_share_change,
    three_point_panel,
    transition_matrix,
)
from .suppression import DEFAULT_POLICY, NO_SUPPRESSION, SuppressionPolicy, suppress
from .weights import (
    WEIGHT_TABLE,
    PopulationTable,
    WeightSpec,
    adult_population_table,
    eligibility_expr,
    get,
    pairing_spec,
    pooled_population_weights,
    resolve,
    validate_frame,
    weight_table_json,
)

__all__ = [
    "DEFAULT_POLICY",
    "NO_SUPPRESSION",
    "RESULT_COLUMNS",
    "WEIGHT_TABLE",
    "Design",
    "PopulationTable",
    "SuppressionPolicy",
    "WeightSpec",
    "adjusted_association",
    "adult_population_table",
    "average_countries",
    "eligibility_expr",
    "get",
    "kish_n_eff",
    "paired_change",
    "paired_change_distribution",
    "paired_share_change",
    "pairing_spec",
    "pooled_population_weights",
    "resolve",
    "suppress",
    "three_point_panel",
    "transition_matrix",
    "validate_frame",
    "weight_table_json",
    "weighted_correlation",
    "weighted_correlations",
    "weighted_distribution",
    "weighted_mean",
    "weighted_proportion",
    "weighted_quantile",
]
