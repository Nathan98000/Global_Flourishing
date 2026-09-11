"""parse_aggregate_query: every rejection is a 422 that names the fix."""

import pytest
from fastapi import HTTPException
from flourish_api.data import Catalog, DataStore
from flourish_api.queries import parse_aggregate_query


@pytest.fixture(scope="module")
def catalog(store: DataStore) -> Catalog:
    assert store.catalog is not None
    return store.catalog


def parse(catalog: Catalog, **overrides):
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
    return parse_aggregate_query(catalog, **{**defaults, **overrides})


def messages(catalog: Catalog, **overrides) -> list[str]:
    with pytest.raises(HTTPException) as excinfo:
        parse(catalog, **overrides)
    assert excinfo.value.status_code == 422
    detail = excinfo.value.detail
    assert isinstance(detail, list)
    return detail


def test_happy_path(catalog: Catalog) -> None:
    query = parse(catalog)
    assert query.outcome.name == "HAPPY"
    assert query.by == ("country_code",) and query.by_variable is None
    assert query.group_columns == ("country_code",)


def test_unknown_outcome(catalog: Catalog) -> None:
    assert any("unknown or non-servable" in m for m in messages(catalog, outcome="NOPE"))


def test_country_specific_outcome_rejected(catalog: Catalog) -> None:
    assert any("non-servable" in m for m in messages(catalog, outcome="INCOME"))


def test_wave_not_asked(catalog: Catalog) -> None:
    found = messages(catalog, outcome="MONEY", wave="Y1", filters=["country_code:1"], by=[])
    assert any("MONEY is not asked at Y1" in m and "MY" in m for m in found)


def test_bad_wave_and_stat_literals(catalog: Catalog) -> None:
    found = messages(catalog, wave="Y9", stat="median")
    assert any("wave must be" in m for m in found)
    assert any("stat must be" in m for m in found)


def test_stat_scale_mismatch_names_the_valid_stats(catalog: Catalog) -> None:
    found = messages(catalog, outcome="ATTEND_SVCS", stat="quantile")
    assert any("does not apply" in m and "proportion" in m for m in found)
    # …but mean over an ordinal is allowed (documented in METHODS.md).
    assert parse(catalog, outcome="ATTEND_SVCS", stat="mean").stat == "mean"


def test_oriented_on_derived_rejected(catalog: Catalog) -> None:
    found = messages(catalog, outcome="sfi", oriented=True)
    assert any("derived" in m for m in found)


def test_by_variable_breakdown(catalog: Catalog) -> None:
    query = parse(catalog, by=["country_code", "ATTEND_SVCS"])
    assert query.by == ("country_code",)
    assert query.by_variable is not None and query.by_variable.name == "ATTEND_SVCS"
    assert query.group_columns == ("country_code", "ATTEND_SVCS")


def test_by_rejections(catalog: Catalog) -> None:
    assert any("neither a demographic" in m for m in messages(catalog, by=["shoe_size"]))
    assert any(
        "cannot break an outcome down by itself" in m
        for m in messages(catalog, outcome="ATTEND_SVCS", stat="mean", by=["ATTEND_SVCS"])
    )
    assert any("duplicate" in m for m in messages(catalog, by=["country_code", "country_code"]))
    assert any(
        "at most one survey variable" in m
        for m in messages(catalog, by=["country_code", "ATTEND_SVCS", "CHILD_MEM"])
    )
    # a scale_0_10 item is not a categorical breakdown
    assert any("scale_type" in m for m in messages(catalog, outcome="sfi", by=["HAPPY"]))
    # a Y1-only variable cannot break down a Y2 outcome
    assert any(
        "not asked at Y2" in m
        for m in messages(catalog, wave="Y2", by=["country_code", "CHILD_MEM"])
    )


def test_filters_parse_and_validate(catalog: Catalog) -> None:
    query = parse(
        catalog,
        by=[],
        filters=["country_code:1", "gender:2", "age_band:18-24", "age_band:25-29"],
    )
    assert query.countries == (1,)
    by_column = {f.column: f.values for f in query.filters}
    assert by_column == {"gender": (2,), "age_band": ("18-24", "25-29")}


def test_filter_rejections(catalog: Catalog) -> None:
    assert any("column:value" in m for m in messages(catalog, filters=["gender"]))
    assert any("not filterable" in m for m in messages(catalog, filters=["shoe_size:9"]))
    assert any("not an integer code" in m for m in messages(catalog, filters=["gender:female"]))
    assert any("is not one of" in m for m in messages(catalog, filters=["gender:7"]))
    assert any("unknown country" in m for m in messages(catalog, filters=["country_code:99"]))


def test_global_scope_needs_a_country(catalog: Catalog) -> None:
    found = messages(catalog, by=["age_band"])
    assert any("Phase 5" in m and "country" in m for m in found)
    # …satisfied by either grouping or filtering.
    parse(catalog, by=["country_code", "age_band"])
    parse(catalog, by=["age_band"], filters=["country_code:22"])


def test_us_scope_rules(catalog: Catalog) -> None:
    query = parse(catalog, scope="us_state", by=["state"])
    assert query.by == ("state",)
    assert any(
        "US-only" in m
        for m in messages(catalog, scope="us_state", by=["state"], filters=["country_code:1"])
    )
    # state is not a global-scope breakdown
    assert any("neither a demographic" in m for m in messages(catalog, by=["state"]))


def test_p_rules(catalog: Catalog) -> None:
    query = parse(catalog, outcome="HAPPY", stat="quantile", p=[0.25, 0.5, 0.25])
    assert query.p == (0.25, 0.5)  # de-duplicated, order kept
    assert any("only applies" in m for m in messages(catalog, stat="mean", p=[0.5]))
    assert any("between 0 and 1" in m for m in messages(catalog, stat="quantile", p=[0.0, 1.5]))
