"""The US state codes the release uses, with their display names.

Shared data semantics for the engine's two consumers, like the breakdown
registry: the release keys US respondents by a two-letter postal code —
or by one of four **pooled groups** of small states, whose codes join the
members with underscores — and the API (``/v1/meta``) and the static
exporter (``meta.json``) both serve these labels, so the front end never
owns a state name. Only 37 states and the 4 groups occur in the data;
every state and DC is named here so a code can never fall back to itself.
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

#: The four pooled small-state groups the release keys (the state-weight
#: file's STATE_FOR_ANALYSIS columns): small states are pooled so every
#: state estimate rests on enough people.
POOLED_STATE_GROUPS: tuple[str, ...] = ("ME_NH_RI_VT", "DE_MS_WV", "AK_HI_MT", "ND_SD_WY")


def state_members(code: str) -> list[str]:
    """A code's member states: itself, or a pooled group's members."""
    return [part for part in code.split("_") if part]


def state_label(code: str) -> str:
    """The display name: the state's, or ``A, B & C (pooled)`` for a group."""
    members = state_members(code)
    if len(members) == 1:
        return US_STATE_NAMES.get(code, code)
    names = [US_STATE_NAMES.get(member, member) for member in members]
    return f"{', '.join(names[:-1])} & {names[-1]} (pooled)"


def state_labels() -> dict[str, dict[str, Any]]:
    """Every code the release can carry → ``{name, members}``, for
    ``/v1/meta`` and the static ``meta.json``."""
    codes = [*US_STATE_NAMES, *POOLED_STATE_GROUPS]
    return {code: {"name": state_label(code), "members": state_members(code)} for code in codes}
