"""Hand-curated metadata that the codebook PDF cannot provide.

Three YAML files, packaged with the code so the pipeline is runnable from
a wheel:

- ``variables.yaml``  — per-variable display name, family, direction,
  corrections to the inferred scale type, SFI domain membership, special
  code rulings, and the alias/duplicate-heading fixes.
- ``countries.yaml``  — country code → name/ISO-3166 alpha-3.
- ``us_columns.yaml`` — the 15 columns that exist only in the US
  state-weight file and are absent from the Wave 2 codebook.

Precedence: overrides > CSV header > PDF (ADR-0004).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from importlib import resources
from typing import Any

import yaml

FAMILIES = frozenset(
    {
        "sfi",
        "wellbeing",
        "mental_health",
        "physical_health",
        "social_civic",
        "character",
        "religion",
        "politics",
        "childhood",
        "demographics",
        "midyear",
        "design",
    }
)
DIRECTIONS = frozenset({"higher_better", "lower_better", "none"})
SCALE_TYPES = frozenset(
    {
        "scale_0_10",
        "ordinal",
        "nominal",
        "binary",
        "count",
        "continuous",
        "date",
        "id",
        "string",
        "weight",
        "design",
    }
)
SFI_DOMAINS = frozenset(
    {"happiness", "health", "meaning", "character", "relationships", "financial"}
)
SPECIAL_TREATMENTS = frozenset({"valid", "skipped", "dk", "refused"})
REVIEW_STATUSES = frozenset({"reviewed", "draft"})


class OverridesError(ValueError):
    """The overrides files are malformed."""


@dataclass(frozen=True, slots=True)
class VariableOverride:
    name: str
    display_name: str
    family: str
    direction: str = "none"
    scale_type: str | None = None
    sfi_domain: str | None = None
    min: int | None = None
    max: int | None = None
    special_codes: dict[int, str] = field(default_factory=dict[int, str])
    codebook_headings: tuple[str, ...] = ()
    notes: str | None = None
    review_status: str = "reviewed"
    is_us_only: bool = False


@dataclass(frozen=True, slots=True)
class HeadingFix:
    """Disambiguates a duplicated codebook heading by its variable label."""

    heading: str
    when_label_contains: str
    use: str


@dataclass(frozen=True, slots=True)
class Country:
    code: int
    name: str
    iso3: str


@dataclass(frozen=True, slots=True)
class Overrides:
    variables: dict[str, VariableOverride]
    aliases: dict[str, str]  # codebook heading -> CSV base name
    heading_fixes: tuple[HeadingFix, ...]
    allow_unmatched_headings: frozenset[str]
    allow_undocumented_columns: frozenset[str]
    countries: dict[int, Country]
    unused_country_codes: frozenset[int]


def _require_str(raw: Any, what: str) -> str:
    if not isinstance(raw, str) or not raw:
        raise OverridesError(f"{what} must be a non-empty string, got {raw!r}")
    return raw


def _load_yaml(filename: str) -> dict[str, Any]:
    text = (resources.files(__package__) / filename).read_text(encoding="utf-8")
    data: Any = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise OverridesError(f"{filename} must be a mapping at top level")
    return data  # pyright: ignore[reportUnknownVariableType]


def _parse_variable(name: str, raw: Any, *, us_only: bool) -> VariableOverride:
    if not isinstance(raw, dict):
        raise OverridesError(f"{name}: entry must be a mapping")
    entry: dict[str, Any] = raw  # pyright: ignore[reportUnknownVariableType]
    family = _require_str(entry.get("family"), f"{name}.family")
    if family not in FAMILIES:
        raise OverridesError(f"{name}: unknown family {family!r}")
    direction = str(entry.get("direction", "none"))
    if direction not in DIRECTIONS:
        raise OverridesError(f"{name}: unknown direction {direction!r}")
    scale_type = entry.get("scale_type")
    if scale_type is not None and scale_type not in SCALE_TYPES:
        raise OverridesError(f"{name}: unknown scale_type {scale_type!r}")
    sfi_domain = entry.get("sfi_domain")
    if sfi_domain is not None and sfi_domain not in SFI_DOMAINS:
        raise OverridesError(f"{name}: unknown sfi_domain {sfi_domain!r}")
    review_status = str(entry.get("review_status", "reviewed"))
    if review_status not in REVIEW_STATUSES:
        raise OverridesError(f"{name}: unknown review_status {review_status!r}")
    special_codes: dict[int, str] = {}
    for code, treatment in dict(entry.get("special_codes") or {}).items():
        if str(treatment) not in SPECIAL_TREATMENTS:
            raise OverridesError(f"{name}: special code {code}: unknown treatment {treatment!r}")
        special_codes[int(code)] = str(treatment)
    return VariableOverride(
        name=name,
        display_name=_require_str(entry.get("display_name"), f"{name}.display_name"),
        family=family,
        direction=direction,
        scale_type=None if scale_type is None else str(scale_type),
        sfi_domain=None if sfi_domain is None else str(sfi_domain),
        min=None if entry.get("min") is None else int(entry["min"]),
        max=None if entry.get("max") is None else int(entry["max"]),
        special_codes=special_codes,
        codebook_headings=tuple(str(h) for h in entry.get("codebook_headings", [])),
        notes=None if entry.get("notes") is None else str(entry["notes"]),
        review_status=review_status,
        is_us_only=us_only,
    )


def load_overrides() -> Overrides:
    variables_doc = _load_yaml("variables.yaml")
    us_doc = _load_yaml("us_columns.yaml")
    countries_doc = _load_yaml("countries.yaml")

    variables: dict[str, VariableOverride] = {}
    for name, raw in dict(variables_doc.get("variables") or {}).items():
        variables[str(name)] = _parse_variable(str(name), raw, us_only=False)
    for name, raw in dict(us_doc.get("variables") or {}).items():
        if name in variables:
            raise OverridesError(f"{name}: defined in both variables.yaml and us_columns.yaml")
        variables[str(name)] = _parse_variable(str(name), raw, us_only=True)

    aliases = {str(k): str(v) for k, v in dict(variables_doc.get("aliases") or {}).items()}
    fixes = tuple(
        HeadingFix(
            heading=_require_str(f.get("heading"), "heading_fixes.heading"),
            when_label_contains=_require_str(
                f.get("when_label_contains"), "heading_fixes.when_label_contains"
            ),
            use=_require_str(f.get("use"), "heading_fixes.use"),
        )
        for f in list(variables_doc.get("heading_fixes") or [])
    )

    countries: dict[int, Country] = {}
    for raw in list(countries_doc.get("countries") or []):
        country = Country(int(raw["code"]), str(raw["name"]), str(raw["iso3"]))
        countries[country.code] = country

    return Overrides(
        variables=variables,
        aliases=aliases,
        heading_fixes=fixes,
        allow_unmatched_headings=frozenset(
            str(h) for h in list(variables_doc.get("allow_unmatched_headings") or [])
        ),
        allow_undocumented_columns=frozenset(
            str(c) for c in list(variables_doc.get("allow_undocumented_columns") or [])
        ),
        countries=countries,
        unused_country_codes=frozenset(
            int(c) for c in list(countries_doc.get("unused_codes") or [])
        ),
    )
