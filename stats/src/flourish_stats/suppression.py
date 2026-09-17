"""Small-cell suppression as a pure function (docs/PROPOSAL.md §3.7).

The thresholds are parameters everywhere; nothing else in the package
hard-codes 50. Suppressed rows keep their group keys, ``n`` and ``sum_w``
so the reader can see *that* and *why* a cell was withheld; only the
estimates are nulled.
"""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_THRESHOLD = 50
DEFAULT_FLAG_BELOW = 100


def suppress(
    n: int, threshold: int = DEFAULT_THRESHOLD, flag_below: int = DEFAULT_FLAG_BELOW
) -> tuple[bool, bool]:
    """``(suppressed, flagged)`` for an unweighted cell size ``n``.

    ``n < threshold`` suppresses the cell; ``threshold ≤ n < flag_below``
    flags it as small but shows it. Monotone in ``n``: growing a cell can
    only move it suppressed → flagged → clean.
    """
    if n < 0:
        raise ValueError(f"n must be non-negative, got {n}")
    suppressed = n < threshold
    flagged = not suppressed and n < flag_below
    return suppressed, flagged


@dataclass(frozen=True)
class SuppressionPolicy:
    """The two thresholds, carried as data so callers can override them."""

    threshold: int = DEFAULT_THRESHOLD
    flag_below: int = DEFAULT_FLAG_BELOW

    def apply(self, n: int) -> tuple[bool, bool]:
        return suppress(n, self.threshold, self.flag_below)


DEFAULT_POLICY = SuppressionPolicy()

#: The serving policy since ADR-0011: show every cell. The arithmetic
#: makes it exact — a cell is suppressed when ``n < threshold`` and
#: flagged when ``threshold ≤ n < flag_below``, and with both thresholds
#: at zero ``n < 0`` is never true for a non-negative cell size, so
#: nothing is ever suppressed or flagged. The 50/100 rule stays one
#: policy object away (``DEFAULT_POLICY``, or ``FA_SUPPRESSION_*`` in
#: the API): this is a change of default, not a removal of capability.
NO_SUPPRESSION = SuppressionPolicy(threshold=0, flag_below=0)
