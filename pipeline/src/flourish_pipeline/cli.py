"""Pipeline command-line entry point.

``flourish-pipeline run`` executes the stages in order; each stage is also
its own subcommand. ``aggregate`` (Phase 3) exports the static views
through the Phase 2 estimators; see aggregate.py.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable, Sequence
from pathlib import Path

STAGES = ("codebook", "ingest", "reshape", "derive", "validate", "aggregate", "manifest")


def _stage_codebook(args: argparse.Namespace) -> int:
    from .codebook.stage import run_codebook

    return run_codebook(
        args.raw_dir,
        args.out_dir,
        dump_lines=getattr(args, "dump_lines", None),
        draft_overrides=getattr(args, "draft_overrides", None),
    )


def _stage_ingest(args: argparse.Namespace) -> int:
    from .ingest import run_ingest

    return run_ingest(args.raw_dir, args.out_dir)


def _stage_reshape(args: argparse.Namespace) -> int:
    from .reshape import run_reshape

    return run_reshape(args.out_dir)


def _stage_derive(args: argparse.Namespace) -> int:
    from .derive import run_derive

    return run_derive(args.out_dir)


def _stage_validate(args: argparse.Namespace) -> int:
    from .validate import run_validate

    return run_validate(args.out_dir)


def _stage_aggregate(args: argparse.Namespace) -> int:
    from .aggregate import run_aggregate

    return run_aggregate(args.raw_dir, args.out_dir)


def _stage_manifest(args: argparse.Namespace) -> int:
    from .manifest import run_manifest

    return run_manifest(args.raw_dir, args.out_dir)


STAGE_RUNNERS: dict[str, Callable[[argparse.Namespace], int]] = {
    "codebook": _stage_codebook,
    "ingest": _stage_ingest,
    "reshape": _stage_reshape,
    "derive": _stage_derive,
    "validate": _stage_validate,
    "aggregate": _stage_aggregate,
    "manifest": _stage_manifest,
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
    from .util import record_timing

    start_index = STAGES.index(args.from_stage)
    end_index = STAGES.index(args.to_stage)
    if start_index > end_index:
        print(f"run: --from {args.from_stage} is after --to {args.to_stage}", file=sys.stderr)
        return 2
    total_start = time.perf_counter()
    for stage in STAGES[start_index : end_index + 1]:
        stage_start = time.perf_counter()
        code = STAGE_RUNNERS[stage](args)
        elapsed = time.perf_counter() - stage_start
        if code == 0:
            record_timing(args.out_dir, stage, elapsed)
        print(f"[{stage}] {'ok' if code == 0 else f'FAILED ({code})'} in {elapsed:.1f}s")
        if code != 0:
            return code
    print(f"[run] all stages done in {time.perf_counter() - total_start:.1f}s")
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    from .util import record_timing

    args = build_parser().parse_args(argv)
    if args.command == "run":
        return _run_all(args)
    stage_start = time.perf_counter()
    code = STAGE_RUNNERS[args.command](args)
    if code == 0:
        record_timing(args.out_dir, args.command, time.perf_counter() - stage_start)
    return code


if __name__ == "__main__":
    sys.exit(main())
