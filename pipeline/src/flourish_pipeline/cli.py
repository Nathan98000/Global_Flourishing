"""Pipeline command-line entry point.

Phase 0 stub: fails loudly until Phase 1 implements the real stages
(codebook parse, ingest, reshape, derive, validate, aggregate, manifest —
docs/PROPOSAL.md §5.2). Keeping the entry point here lets `make data` and
CI wire up now and stay stable later.
"""

import sys

STAGES = ("codebook", "ingest", "reshape", "derive", "validate", "aggregate", "manifest")


def main() -> int:
    print("Not implemented: Phase 1 (docs/PROPOSAL.md §5.2)", file=sys.stderr)
    print(f"Phase 1 will implement stages: {', '.join(STAGES)}", file=sys.stderr)
    print("Raw inputs are fetched outside git; see data/README.md.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
