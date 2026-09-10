"""Pipeline command-line entry point.

``flourish-pipeline run`` executes the stages in order; each stage is also
its own subcommand. ``aggregate`` is a loud Phase 3 stub (its precomputed
views need the Phase 2 estimators), so ``run`` skips it with a notice
rather than failing ``make data``.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path

STAGES = ("codebook", "ingest", "reshape", "derive", "validate", "aggregate", "manifest")

_NOT_IMPLEMENTED_PHASE_1 = (
    "Not implemented: Phase 1 (docs/PROPOSAL.md §5.2) — arrives with the pipeline PR"
)
_NOT_IMPLEMENTED_PHASE_3 = (
    "Not implemented: Phase 3 — `aggregate` precomputes view aggregates with "
    "confidence intervals, which need the Phase 2 estimators (docs/PROPOSAL.md §5.2)"
)


def _stage_codebook(args: argparse.Namespace) -> int:
    from .codebook.stage import run_codebook

    return run_codebook(
        args.raw_dir,
        args.out_dir,
        dump_lines=getattr(args, "dump_lines", None),
        draft_overrides=getattr(args, "draft_overrides", None),
    )


def _not_implemented(message: str) -> Callable[[argparse.Namespace], int]:
    def stage(_args: argparse.Namespace) -> int:
        print(message, file=sys.stderr)
        return 1

    return stage


STAGE_RUNNERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "codebook": _stage_codebook,
    "ingest": _not_implemented(_NOT_IMPLEMENTED_PHASE_1),
    "reshape": _not_implemented(_NOT_IMPLEMENTED_PHASE_1),
    "derive": _not_implemented(_NOT_IMPLEMENTED_PHASE_1),
    "validate": _not_implemented(_NOT_IMPLEMENTED_PHASE_1),
    "aggregate": _not_implemented(_NOT_IMPLEMENTED_PHASE_3),
    "manifest": _not_implemented(_NOT_IMPLEMENTED_PHASE_1),
}


def _add_dirs(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path("data/raw"),
        help="directory holding the raw CSVs and codebook PDF (default: data/raw)",
    )
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("data"),
        help="directory for pipeline outputs (default: data)",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="flourish-pipeline",
        description="Flourish Atlas data pipeline (docs/PROPOSAL.md §5.2)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run = subparsers.add_parser("run", help="run all stages in order")
    _add_dirs(run)
    run.add_argument("--from", dest="from_stage", choices=STAGES, default=STAGES[0])
    run.add_argument("--to", dest="to_stage", choices=STAGES, default=STAGES[-1])

    for stage in STAGES:
        sub = subparsers.add_parser(stage, help=f"run only the {stage} stage")
        _add_dirs(sub)
        if stage == "codebook":
            sub.add_argument(
                "--dump-lines",
                type=Path,
                default=None,
                help="also write the ten-entry parse fixture (regenerates the committed one)",
            )
            sub.add_argument(
                "--draft-overrides",
                type=Path,
                default=None,
                help="also write a draft overrides YAML for entries missing from variables.yaml",
            )
    return parser


def _run_all(args: argparse.Namespace) -> int:
    start_index = STAGES.index(args.from_stage)
    end_index = STAGES.index(args.to_stage)
    if start_index > end_index:
        print(f"run: --from {args.from_stage} is after --to {args.to_stage}", file=sys.stderr)
        return 2
    total_start = time.perf_counter()
    for stage in STAGES[start_index : end_index + 1]:
        if stage == "aggregate" and args.to_stage != "aggregate":
            print("[aggregate] skipped (Not implemented: Phase 3)")
            continue
        stage_start = time.perf_counter()
        code = STAGE_RUNNERS[stage](args)
        elapsed = time.perf_counter() - stage_start
        print(f"[{stage}] {'ok' if code == 0 else f'FAILED ({code})'} in {elapsed:.1f}s")
        if code != 0:
            return code
    print(f"[run] all stages done in {time.perf_counter() - total_start:.1f}s")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "run":
        return _run_all(args)
    return STAGE_RUNNERS[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
