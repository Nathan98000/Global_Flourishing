"""pandera (polars) schemas for the published tables.

``responses_long`` is validated in SQL instead (35M rows; see
``validate.check_responses_long``).
"""

# polars' expression API (when/then/otherwise, sum_horizontal, …) ships
# partially-unknown signatures, so this one strict diagnostic is disabled
# for this module; every other strict check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import pandera.polars as pa
import polars as pl

WAVES = ["Y1", "MY", "Y2"]
COUNTRY_CODES = list(range(1, 15)) + list(range(16, 21)) + [22, 23, 24, 25]

respondents_schema = pa.DataFrameSchema(
    {
        "id": pa.Column(pl.Int64, nullable=False, unique=True),
        "country_code": pa.Column(pl.Int16, pa.Check.isin(COUNTRY_CODES), nullable=False),
        "country_name": pa.Column(pl.String, nullable=False),
        "gender": pa.Column(pl.Int16, pa.Check.isin([1, 2, 3, 4]), nullable=True),
        "age": pa.Column(pl.Int16, pa.Check.in_range(18, 99), nullable=True),
        "age_band": pa.Column(
            pl.String,
            pa.Check.isin(["18-24", "25-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"]),
            nullable=True,
        ),
        "education_3": pa.Column(pl.Int16, pa.Check.isin([1, 2, 3]), nullable=True),
        "employment": pa.Column(pl.Int16, pa.Check.in_range(1, 8), nullable=True),
        "marital_status": pa.Column(pl.Int16, pa.Check.in_range(1, 6), nullable=True),
        "urban_rural": pa.Column(pl.Int16, pa.Check.in_range(1, 4), nullable=True),
        "income_code": pa.Column(pl.Int16, pa.Check.in_range(101, 9900), nullable=True),
        "income_band": pa.Column(pl.Int16, pa.Check.in_range(0, 18), nullable=True),
        "income_quintile": pa.Column(pl.Int8, pa.Check.in_range(1, 5), nullable=True),
        "region1": pa.Column(pl.Int16, nullable=True),
        "region2": pa.Column(pl.Int16, nullable=True),
        "region3": pa.Column(pl.Int16, nullable=True),
        "selfid1": pa.Column(pl.Int16, nullable=True),
        "selfid2": pa.Column(pl.Int16, nullable=True),
        "w_c1": pa.Column(pl.Float64, pa.Check.gt(0), nullable=False),
        "w_c2": pa.Column(pl.Float64, pa.Check.gt(0), nullable=True),
        "w_l2": pa.Column(pl.Float64, pa.Check.gt(0), nullable=True),
        "w_r2": pa.Column(pl.Float64, pa.Check.gt(0), nullable=True),
        "w_l1m": pa.Column(pl.Float64, pa.Check.gt(0), nullable=True),
        "w_l1m2": pa.Column(pl.Float64, pa.Check.gt(0), nullable=True),
        "strata": pa.Column(pl.Int32, nullable=False),
        "psu": pa.Column(pl.Int64, nullable=False),
        "retained_y2": pa.Column(pl.Boolean, nullable=False),
        "has_midyear": pa.Column(pl.Boolean, nullable=False),
        "midyear_type": pa.Column(pl.Int16, pa.Check.isin([1, 2]), nullable=True),
        "full_partial_y1": pa.Column(pl.Int16, pa.Check.isin([1, 2]), nullable=False),
        "full_partial_y2": pa.Column(pl.Int16, pa.Check.isin([1, 2]), nullable=True),
        "full_partial_my": pa.Column(pl.Int16, pa.Check.isin([1, 2]), nullable=True),
        "mode_recruit": pa.Column(pl.Int16, pa.Check.isin([1, 2, 3]), nullable=False),
        "mode_annual": pa.Column(pl.Int16, pa.Check.isin([1, 2, 3]), nullable=False),
        "recruit_type": pa.Column(pl.Int16, pa.Check.isin([1, 2]), nullable=False),
        "doi_recruit_y1": pa.Column(pl.Date, nullable=False),
        "doi_annual_y1": pa.Column(pl.Date, nullable=False),
        "doi_annual_y2": pa.Column(pl.Date, nullable=True),
        "doi_my": pa.Column(pl.Date, nullable=True),
        "state": pa.Column(pl.String, nullable=True),
        "state_y2": pa.Column(pl.String, nullable=True),
        "fips": pa.Column(pl.String, pa.Check.str_matches(r"^\d{5}$"), nullable=True),
        "fips_y2": pa.Column(pl.String, pa.Check.str_matches(r"^\d{5}$"), nullable=True),
        "w_state_c1": pa.Column(pl.Float64, nullable=True),
        "w_state_c2": pa.Column(pl.Float64, nullable=True),
        "w_state_l2": pa.Column(pl.Float64, nullable=True),
        "w_state_r2": pa.Column(pl.Float64, nullable=True),
        "w_state_adj_c2": pa.Column(pl.Float64, nullable=True),
        "w_state_adj_l2": pa.Column(pl.Float64, nullable=True),
        "w_state_adj_r2": pa.Column(pl.Float64, nullable=True),
        "w_state_l1m": pa.Column(pl.Float64, nullable=True),
        "w_state_l1m2": pa.Column(pl.Float64, nullable=True),
        "w_state_adj_l1m": pa.Column(pl.Float64, nullable=True),
        "w_state_adj_l1m2": pa.Column(pl.Float64, nullable=True),
    },
    strict=True,
)

variables_schema = pa.DataFrameSchema(
    {
        "name": pa.Column(pl.String, nullable=False, unique=True),
        "display_name": pa.Column(pl.String, nullable=False),
        "family": pa.Column(pl.String, nullable=False),
        "scale_type": pa.Column(pl.String, nullable=False),
        "direction": pa.Column(
            pl.String, pa.Check.isin(["higher_better", "lower_better", "none"]), nullable=False
        ),
        "review_status": pa.Column(pl.String, pa.Check.isin(["reviewed", "draft"]), nullable=False),
        "restricted": pa.Column(pl.Boolean, pa.Check.isin([False]), nullable=False),
    },
    strict=False,  # the frame carries more columns; validate the invariants
)

value_labels_schema = pa.DataFrameSchema(
    {
        "variable": pa.Column(pl.String, nullable=False),
        "wave": pa.Column(pl.String, pa.Check.isin(WAVES), nullable=True),
        "country_code": pa.Column(pl.Int16, pa.Check.isin(COUNTRY_CODES), nullable=True),
        "code": pa.Column(pl.Int16, pa.Check.in_range(-9998, 9999), nullable=False),
        "label": pa.Column(pl.String, nullable=False),
        "is_nonresponse": pa.Column(pl.Boolean, nullable=False),
    },
    strict=True,
)

derived_schema = pa.DataFrameSchema(
    {
        "id": pa.Column(pl.Int64, nullable=False),
        "wave": pa.Column(pl.String, pa.Check.isin(WAVES), nullable=False),
        "sfi": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_n_items": pa.Column(pl.Int8, pa.Check.in_range(0, 12), nullable=True),
        "sfi_happiness": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_health": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_meaning": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_character": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_relationships": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "sfi_financial": pa.Column(pl.Float64, pa.Check.in_range(0.0, 10.0), nullable=True),
        "phq2_score": pa.Column(pl.Int8, pa.Check.in_range(0, 6), nullable=True),
        "phq2_positive": pa.Column(pl.Boolean, nullable=True),
        "gad2_score": pa.Column(pl.Int8, pa.Check.in_range(0, 6), nullable=True),
        "gad2_positive": pa.Column(pl.Boolean, nullable=True),
        "priority_top": pa.Column(
            pl.String,
            pa.Check.isin(["money", "relationships", "meaning", "tie"]),
            nullable=True,
        ),
        "money_minus_relationships": pa.Column(pl.Int16, pa.Check.in_range(-10, 10), nullable=True),
    },
    strict=True,
)

coverage_schema = pa.DataFrameSchema(
    {
        "variable": pa.Column(pl.String, nullable=False),
        "wave": pa.Column(pl.String, pa.Check.isin(WAVES), nullable=False),
        "country_code": pa.Column(pl.Int16, pa.Check.isin(COUNTRY_CODES), nullable=False),
        "n_present": pa.Column(pl.Int32, pa.Check.ge(1), nullable=False),
        "n_valid": pa.Column(pl.Int32, pa.Check.ge(0), nullable=False),
        "n_skipped": pa.Column(pl.Int32, pa.Check.ge(0), nullable=False),
        "n_dk": pa.Column(pl.Int32, pa.Check.ge(0), nullable=False),
        "n_refused": pa.Column(pl.Int32, pa.Check.ge(0), nullable=False),
    },
    strict=True,
)

TABLE_SCHEMAS = {
    "respondents": respondents_schema,
    "variables": variables_schema,
    "value_labels": value_labels_schema,
    "derived": derived_schema,
    "coverage": coverage_schema,
}
