"""DataStore + catalog behaviour."""

from pathlib import Path

from flourish_api.config import Settings
from flourish_api.data import DataStore


def test_absent_data_is_a_supported_state(tmp_path: Path) -> None:
    store = DataStore(Settings(data_path=tmp_path / "nope.duckdb"))
    assert store.present is False
    assert store.con is None and store.catalog is None and store.data_version is None
    store.close()  # no-op, no error


def test_catalog_servable_allow_list(store: DataStore) -> None:
    assert store.catalog is not None
    assert store.catalog.outcome("HAPPY") is not None
    assert store.catalog.outcome("sfi") is not None
    assert store.catalog.outcome("INCOME") is None  # country-specific
    assert store.catalog.outcome("WAVE") is None  # design bookkeeping
    assert store.catalog.outcome("nope") is None
    assert "phq2_positive" in store.catalog.outcome_names


def test_catalog_lookups(store: DataStore) -> None:
    assert store.catalog is not None
    assert store.catalog.country_codes() == {1, 22}
    info = store.catalog.outcome("LONELY")
    assert info is not None and info.direction == "lower_better" and info.waves == ("Y1",)


def test_duckdb_pragmas_applied(store: DataStore) -> None:
    assert store.con is not None
    row = store.con.execute("SELECT current_setting('threads')").fetchone()
    assert row is not None and int(row[0]) == Settings().duckdb_threads


def test_outcome_frame_shapes(store: DataStore) -> None:
    assert store.catalog is not None
    happy = store.catalog.outcome("HAPPY")
    assert happy is not None
    frame = store.outcome_frame(happy, "Y1", extra_columns=("age_band",))
    assert {"id", "value", "w_c1", "strata", "psu", "age_band"} <= set(frame.columns)
    assert frame.height == 120

    sfi = store.catalog.outcome("sfi")
    assert sfi is not None
    derived = store.outcome_frame(sfi, "Y2")
    assert derived.height == 80  # retained only
