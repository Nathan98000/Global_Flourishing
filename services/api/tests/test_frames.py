"""Frame assembly — including the proof that filters must be domains.

The engine treats the frame it receives as the survey design, so
subsetting rows to a subgroup silently changes SEs relative to R's domain
semantics. These tests pin the two constructions apart on a toy design
and prove the country exception (strata nest within countries).
"""

import polars as pl
import pytest
from flourish_api.data import DataStore
from flourish_api.frames import apply_domain_filters, assemble_aggregate_frame
from flourish_api.queries import DomainFilter, parse_aggregate_query
from flourish_stats import Design, SuppressionPolicy, weighted_mean

NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
TAYLOR = Design(weight="w", strata="strata", psu="psu")

# The R-verified toy design from stats/tests: the "young" flag cuts across
# strata (like an age band does), the "country" column follows whole strata.
TOY = pl.DataFrame(
    {
        "strata": [1, 1, 1, 2, 2, 3, 3, 3, 3],
        "psu": [11, 11, 12, 21, 21, 31, 32, 33, 33],
        "w": [1.0, 2.0, 1.5, 1.0, 0.5, 2.0, 1.0, 1.0, 0.5],
        "value": [3, 5, 4, 10, 8, 1, 2, 6, 4],
        "young": [1, 0, 1, 0, 1, 1, 0, 1, 0],
        "country": ["A", "A", "A", "A", "A", "B", "B", "B", "B"],
    }
)


def the_row(table):
    rows = table.to_pylist()
    assert len(rows) == 1
    return rows[0]


class TestFiltersAreDomains:
    def test_domain_and_subset_disagree_on_a_non_nested_filter(self) -> None:
        domain_frame = apply_domain_filters(TOY, "value", [DomainFilter("young", (1,))])
        assert domain_frame.height == TOY.height  # rows stay in the design
        domain = the_row(weighted_mean(domain_frame, "value", TAYLOR, policy=NO_SUPPRESSION))

        subset = the_row(
            weighted_mean(TOY.filter(pl.col("young") == 1), "value", TAYLOR, policy=NO_SUPPRESSION)
        )
        # Same estimate (same rows contribute)…
        assert domain["estimate"] == pytest.approx(subset["estimate"], rel=1e-12)
        # …different variance: the subset threw away part of the design.
        assert domain["se"] != pytest.approx(subset["se"], rel=1e-6)

    def test_country_subset_is_safe_because_strata_nest(self) -> None:
        by_group = weighted_mean(
            TOY, "value", TAYLOR, by=["country"], policy=NO_SUPPRESSION
        ).to_pylist()
        domain_b = next(r for r in by_group if r["country"] == "B")
        subset_b = the_row(
            weighted_mean(
                TOY.filter(pl.col("country") == "B"), "value", TAYLOR, policy=NO_SUPPRESSION
            )
        )
        assert domain_b["estimate"] == pytest.approx(subset_b["estimate"], rel=1e-12)
        assert domain_b["se"] == pytest.approx(subset_b["se"], rel=1e-12)

    def test_multiple_filters_intersect(self) -> None:
        frame = apply_domain_filters(
            TOY, "value", [DomainFilter("young", (1,)), DomainFilter("country", ("B",))]
        )
        assert frame["value"].drop_nulls().len() == 2  # young ∩ B


def make_query(store: DataStore, **overrides):
    assert store.catalog is not None
    defaults = dict(
        outcome="HAPPY",
        stat="mean",
        wave="Y1",
        by=["country_code"],
        filters=[],
        scope="global",
        oriented=False,
        p=None,
    )
    return parse_aggregate_query(store.catalog, **{**defaults, **overrides})


class TestAssembly:
    def test_y1_frame_is_everyone(self, store: DataStore) -> None:
        assembled = assemble_aggregate_frame(store, make_query(store))
        assert assembled.frame.height == 120
        assert assembled.spec.key == "y1" and assembled.design.weight == "w_c1"
        assert assembled.groups == ("country_code",)

    def test_y2_frame_is_the_retained(self, store: DataStore) -> None:
        assembled = assemble_aggregate_frame(store, make_query(store, wave="Y2"))
        assert assembled.spec.key == "y2"
        assert assembled.frame.height == 80  # ids with id % 3 != 0
        assert assembled.frame["retained_y2"].all()

    def test_country_filter_subsets(self, store: DataStore) -> None:
        query = make_query(store, by=["age_band"], filters=["country_code:1"])
        assembled = assemble_aggregate_frame(store, query)
        assert assembled.frame.height == 60
        assert assembled.frame["country_code"].unique().to_list() == [1]

    def test_demographic_filter_keeps_rows_and_nulls_values(self, store: DataStore) -> None:
        query = make_query(store, filters=["country_code:1", "gender:1"], by=[])
        assembled = assemble_aggregate_frame(store, query)
        assert assembled.frame.height == 60  # rows kept for the design
        men = assembled.frame.filter(pl.col("gender") == 1)
        women = assembled.frame.filter(pl.col("gender") == 2)
        assert women["value"].drop_nulls().len() == 0
        assert men["value"].drop_nulls().len() > 0

    def test_by_variable_joins_the_breakdown(self, store: DataStore) -> None:
        query = make_query(store, by=["country_code", "ATTEND_SVCS"])
        assembled = assemble_aggregate_frame(store, query)
        assert "ATTEND_SVCS" in assembled.frame.columns
        assert assembled.groups == ("country_code", "ATTEND_SVCS")
        assert set(assembled.frame["ATTEND_SVCS"].drop_nulls().unique().to_list()) == {1, 2, 3}

    def test_us_state_scope(self, store: DataStore) -> None:
        query = make_query(store, scope="us_state", by=["state"])
        assembled = assemble_aggregate_frame(store, query)
        assert assembled.spec.key == "us_state:y1"
        assert assembled.design.weight == "w_state_c1"
        assert assembled.frame.height == 60
        assert set(assembled.frame["state"].unique().to_list()) == {"CA", "NY", "TX"}

    def test_oriented_flips_lower_better(self, store: DataStore) -> None:
        plain = assemble_aggregate_frame(
            store, make_query(store, outcome="LONELY", by=[], filters=["country_code:1"])
        )
        oriented = assemble_aggregate_frame(
            store,
            make_query(store, outcome="LONELY", by=[], filters=["country_code:1"], oriented=True),
        )
        joined = plain.frame.select("id", "value").join(
            oriented.frame.select("id", pl.col("value").alias("flipped")), on="id"
        )
        assert joined.filter(pl.col("value") + pl.col("flipped") != 10).height == 0

    def test_derived_outcome_frame(self, store: DataStore) -> None:
        query = make_query(store, outcome="phq2_positive")
        assembled = assemble_aggregate_frame(store, query)
        # booleans arrive as 0/1 so the mean is the share screening positive
        assert set(assembled.frame["value"].unique().to_list()) <= {0, 1}
