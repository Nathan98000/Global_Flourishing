import pytest
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


def test_main_fails_loudly_until_phase_1(capsys: pytest.CaptureFixture[str]) -> None:
    assert main() == 1
    err = capsys.readouterr().err
    assert "Not implemented: Phase 1 (docs/PROPOSAL.md §5.2)" in err
