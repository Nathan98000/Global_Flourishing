"""Column-name helper tests."""

from pathlib import Path

from flourish_pipeline.columns import base_name, read_header, wave_of, waves_available


def test_base_name_strips_wave_suffixes() -> None:
    assert base_name("HAPPY_Y1") == "HAPPY"
    assert base_name("TIME_MEDIA_MY") == "TIME_MEDIA"
    assert base_name("GENDER") == "GENDER"
    assert base_name("DOI_MY") == "DOI"  # yes, really — documented in the catalog notes
    assert base_name("RETENTION_WEIGHT_L_1M2") == "RETENTION_WEIGHT_L_1M2"


def test_wave_of() -> None:
    assert wave_of("HAPPY_Y1") == "Y1"
    assert wave_of("HAPPY_Y2") == "Y2"
    assert wave_of("MONEY_MY") == "MY"
    assert wave_of("GENDER") is None


def test_waves_available_in_chronological_order() -> None:
    columns = ["X_Y2", "X_Y1", "X_MY", "GENDER"]
    assert waves_available(columns, "X") == ["Y1", "MY", "Y2"]
    assert waves_available(columns, "GENDER") == []


def test_read_header_reads_only_column_names(tmp_path: Path) -> None:
    csv_path = tmp_path / "t.csv"
    csv_path.write_text("A,B,C\n1,2,3\n", encoding="utf-8")
    assert read_header(csv_path) == ["A", "B", "C"]
