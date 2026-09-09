from flourish_pipeline.cli import STAGES, main


def test_stages_cover_proposal_sections() -> None:
    assert STAGES == (
        "codebook",
        "ingest",
        "reshape",
        "derive",
        "validate",
        "aggregate",
        "manifest",
    )


def test_main_exits_zero() -> None:
    assert main() == 0
