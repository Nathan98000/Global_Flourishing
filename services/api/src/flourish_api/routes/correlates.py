"""GET /v1/correlates — Phase 6."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

router = APIRouter()


@router.get("/correlates", summary="Not implemented: Phase 6")
def correlates() -> None:
    """Ranked weighted associations ship in Phase 6 together with the
    adjusted models and the Correlates view (docs/PROPOSAL.md §7); the
    engine's `weighted_correlation` exists but is deliberately not served
    until its caveats ship with it."""
    raise HTTPException(status_code=501, detail="Not implemented: Phase 6")
