"""The US state codes, with their display names.

Shared data semantics for the engine's two consumers, like the breakdown
registry: a US respondent's ``state`` is the two-letter postal code of the
state they live in, and the API (``/v1/meta``) and the static exporter
(``meta.json``) both serve these labels, so the front end never owns a
state name. Every state has its own estimate (ADR-0028): the release's
``STATE_FOR_ANALYSIS`` pools 13 small states into four groups, to which
its state weights are calibrated, but the pipeline keys respondents by
their own state (``REGION1``), so a small state's estimate is a domain
of its group's weights — fewer people, a wider interval, never pooled.
All 50 states occur in the data; DC is named too, so a code can never
fall back to itself.
"""

from __future__ import annotations

from typing import Any

#: Postal code → name, the fifty states and DC.
US_STATE_NAMES: dict[str, str] = {
    "AL": "Alabama",
    "AK": "Alaska",
    "AZ": "Arizona",
    "AR": "Arkansas",
    "CA": "California",
    "CO": "Colorado",
    "CT": "Connecticut",
    "DE": "Delaware",
    "DC": "District of Columbia",
    "FL": "Florida",
    "GA": "Georgia",
    "HI": "Hawaii",
    "ID": "Idaho",
    "IL": "Illinois",
    "IN": "Indiana",
    "IA": "Iowa",
    "KS": "Kansas",
    "KY": "Kentucky",
    "LA": "Louisiana",
    "ME": "Maine",
    "MD": "Maryland",
    "MA": "Massachusetts",
    "MI": "Michigan",
    "MN": "Minnesota",
    "MS": "Mississippi",
    "MO": "Missouri",
    "MT": "Montana",
    "NE": "Nebraska",
    "NV": "Nevada",
    "NH": "New Hampshire",
    "NJ": "New Jersey",
    "NM": "New Mexico",
    "NY": "New York",
    "NC": "North Carolina",
    "ND": "North Dakota",
    "OH": "Ohio",
    "OK": "Oklahoma",
    "OR": "Oregon",
    "PA": "Pennsylvania",
    "RI": "Rhode Island",
    "SC": "South Carolina",
    "SD": "South Dakota",
    "TN": "Tennessee",
    "TX": "Texas",
    "UT": "Utah",
    "VT": "Vermont",
    "VA": "Virginia",
    "WA": "Washington",
    "WV": "West Virginia",
    "WI": "Wisconsin",
    "WY": "Wyoming",
}


def state_label(code: str) -> str:
    """The display name: the state's."""
    return US_STATE_NAMES.get(code, code)


def state_labels() -> dict[str, dict[str, Any]]:
    """Every state code → ``{name}``, for ``/v1/meta`` and the static
    ``meta.json``."""
    return {code: {"name": state_label(code)} for code in US_STATE_NAMES}
