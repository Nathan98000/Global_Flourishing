"""The survey design: which columns carry the weight, strata and PSUs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

SeMethod = Literal["taylor", "kish"]


@dataclass(frozen=True)
class Design:
    """Column names describing the design of the frame handed to an estimator.

    With ``strata`` and ``psu`` both given, standard errors use Taylor
    linearisation for stratified, with-replacement PSU sampling (R
    ``svydesign(ids=~psu, strata=~strata, weights=~w, nest=TRUE)``). With
    neither, they fall back to a weighted SE on the Kish effective sample
    size. The fallback is never chosen silently: every output row records
    ``se_method``, and the Phase 3 API must surface it.
    """

    weight: str
    strata: str | None = None
    psu: str | None = None

    def __post_init__(self) -> None:
        if (self.strata is None) != (self.psu is None):
            raise ValueError(
                "strata and psu must be given together (Taylor) or both omitted (Kish); "
                f"got strata={self.strata!r}, psu={self.psu!r}"
            )

    @property
    def se_method(self) -> SeMethod:
        return "taylor" if self.strata is not None else "kish"

    @property
    def columns(self) -> tuple[str, ...]:
        """The frame columns this design reads."""
        if self.strata is None or self.psu is None:
            return (self.weight,)
        return (self.weight, self.strata, self.psu)
