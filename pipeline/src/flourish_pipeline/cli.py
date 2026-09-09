"""Pipeline command-line entry point.

Phase 0 stub: the real stages (codebook parse, ingest, reshape, derive,
validate, aggregate — docs/PROPOSAL.md §5.2) land in Phase 1. Keeping the
entry point here lets `make data` and CI wire up now and stay stable later.
"""

import sys

STAGES = ("codebook", "ingest", "reshape", "derive", "validate", "aggregate", "manifest")


def main() -> int:
    print("flourish-pipeline: Phase 1 will implement stages:", ", ".join(STAGES))
    print("Raw inputs are fetched outside git; see data/README.md.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
