"""Merge parsed entries + CSV headers + overrides into the variable catalog.

Naming: catalog variables are keyed by CSV *base name* (wave suffix
stripped), so ``HAPPY_Y1``/``HAPPY_Y2`` are one variable with
``waves_available = [Y1, Y2]``. Codebook headings resolve to base names
mechanically (exact match, then suffix strip) with the handful of true
renames (``ANNUAL_WEIGHT_1``) coming from the overrides alias table.
``waves_available`` comes from the CSV header, never from the PDF, which
does not record which waves asked a variable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..columns import base_name, wave_of, waves_available
from ..overrides import Country, Overrides, VariableOverride
from .model import RawEntry, ValueLabelRaw


class CatalogError(ValueError):
    """The codebook, CSV headers and overrides do not line up."""


@dataclass(frozen=True, slots=True)
class ValueLabelRecord:
    variable: str
    wave: str | None  # set only when a variable has per-wave codebook entries (INCOME, WAVE)
    country_code: int | None
    code: int
    label: str
    is_nonresponse: bool


@dataclass(slots=True)
class VariableRecord:
    name: str
    display_name: str
    label: str | None
    wording: str | None
    section: str | None
    family: str
    scale_type: str
    direction: str
    min: int | None
    max: int | None
    waves_available: list[str]
    is_country_specific: bool
    is_us_only: bool
    sfi_domain: str | None
    nonresponse_codes: dict[str, list[int]]
    restricted: bool
    review_status: str
    source_pages: list[int] | None
    codebook_headings: list[str]
    notes: str | None


@dataclass(frozen=True, slots=True)
class AliasRecord:
    """One codebook entry as printed, mapped to its catalog variable."""

    heading: str
    variable: str
    variable_label: str | None
    pages: tuple[int, int]


@dataclass(slots=True)
class Catalog:
    variables: list[VariableRecord]
    value_labels: list[ValueLabelRecord]
    countries: list[Country]
    aliases: list[AliasRecord]


@dataclass(slots=True)
class CoverageReport:
    """Every column must map to an entry and vice versa (or be allow-listed)."""

    documented: list[str] = field(default_factory=list[str])
    undocumented_columns: list[str] = field(default_factory=list[str])
    unmatched_headings: list[str] = field(default_factory=list[str])
    drafts: list[str] = field(default_factory=list[str])

    @property
    def ok(self) -> bool:
        return not self.undocumented_columns and not self.unmatched_headings


_TOP_CODE_RE = re.compile(r"^(\d+)\+$")

# Scale types decided by what the variable *is*, not by its value labels.
_NAME_SCALE_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^ID$"), "id"),
    (re.compile(r"^(STRATA|PSU)$"), "design"),
    (re.compile(r"WEIGHT"), "weight"),
    (re.compile(r"^DOI(_|$)"), "date"),
    (
        re.compile(r"^(WAVE|MODE_RECRUIT|MODE_ANNUAL|RECRUIT_TYPE|MIDYEAR_TYPE|FULL_PARTIAL)$"),
        "design",
    ),
    (re.compile(r"^COUNTRY$"), "design"),
)


def classify_nonresponse(label: str) -> str | None:
    """skipped / dk / refused for a fully parenthesised label, else None.

    Returns "unresolved" for a parenthesised label that matches no known
    phrasing — the caller must find a ruling in the overrides
    (``INCOME``'s ``9900 = (None/No household income)`` is an *answer*).
    """
    if not (label.startswith("(") and label.endswith(")")):
        return None
    lowered = label.lower()
    if "skip" in lowered:
        return "skipped"
    if "dk" in lowered or "know" in lowered:
        return "dk"
    if "refus" in lowered or lowered == "(rf)":
        return "refused"
    return "unresolved"


def _resolve_headings(
    entries: list[RawEntry], overrides: Overrides
) -> tuple[dict[str, list[tuple[RawEntry, str | None]]], list[str]]:
    """heading → base name, applying duplicate fixes, joint splits and aliases.

    Returns {base: [(entry, wave-of-heading)]} plus unmatched headings.
    """
    # 1. Duplicate headings: the codebook prints DOI_ANNUAL_Y2 twice; the
    #    second (label "… Midyear Survey") is really DOI_MY.
    fixed: list[RawEntry] = []
    seen: dict[str, int] = {}
    for entry in entries:
        seen[entry.heading] = seen.get(entry.heading, 0) + 1
        if seen[entry.heading] > 1:
            for fix in overrides.heading_fixes:
                if fix.heading == entry.heading and fix.when_label_contains in (
                    entry.variable_label or ""
                ):
                    entry = RawEntry(
                        heading=fix.use,
                        section=entry.section,
                        variable_label=entry.variable_label,
                        wording=entry.wording,
                        value_labels=entry.value_labels,
                        page_from=entry.page_from,
                        page_to=entry.page_to,
                    )
                    break
            else:
                raise CatalogError(f"unexpected duplicate codebook heading: {entry.heading}")
        fixed.append(entry)

    # 2. Joint headings ("SELFID1 & SELFID2"): one entry per component, the
    #    printed label lines distributed in order, value labels shared.
    split: list[RawEntry] = []
    for entry in fixed:
        if " & " not in entry.heading:
            split.append(entry)
            continue
        parts = entry.heading.split(" & ")
        labels = (entry.variable_label or "").split("\n")
        if len(labels) != len(parts):
            raise CatalogError(
                f"joint heading {entry.heading!r}: {len(parts)} names but {len(labels)} label lines"
            )
        for part, label in zip(parts, labels, strict=True):
            split.append(
                RawEntry(
                    heading=part,
                    section=entry.section,
                    variable_label=label,
                    wording=entry.wording,
                    value_labels=entry.value_labels,
                    page_from=entry.page_from,
                    page_to=entry.page_to,
                )
            )

    # 3. Resolve to base names.
    by_base: dict[str, list[tuple[RawEntry, str | None]]] = {}
    unmatched: list[str] = []
    known_bases = set(overrides.variables)
    for entry in split:
        heading = entry.heading
        if heading in overrides.aliases:
            base, wave = overrides.aliases[heading], None
        elif heading in known_bases:
            base, wave = heading, None
        elif base_name(heading) in known_bases:
            base, wave = base_name(heading), wave_of(heading)
        else:
            unmatched.append(heading)
            continue
        by_base.setdefault(base, []).append((entry, wave))
    return by_base, unmatched


def _split_country_label(
    code: int, label: str, countries: dict[int, Country]
) -> tuple[int | None, str]:
    """``104, "Argentina: Mestizo(a)"`` → ``(1, "Mestizo(a)")``.

    Country-specific codes are country code × 100 + band. Codes whose
    prefix is not a real country (9995–9999, 9900) stay global.
    """
    prefix = code // 100
    if code >= 100 and prefix in countries:
        expected = countries[prefix].name + ":"
        if label.startswith(expected):
            return prefix, label[len(expected) :].strip()
        raise CatalogError(f"code {code}: expected label to start with {expected!r}, got {label!r}")
    return None, label


def _classify_labels(
    name: str,
    raw_labels: list[tuple[str | None, ValueLabelRaw]],
    override: VariableOverride,
    countries: dict[int, Country],
) -> tuple[list[ValueLabelRecord], dict[str, list[int]]]:
    records: list[ValueLabelRecord] = []
    nonresponse: dict[str, list[int]] = {"skipped": [], "dk": [], "refused": []}
    for wave, vl in raw_labels:
        kind = classify_nonresponse(vl.label)
        if vl.code in override.special_codes:
            ruling = override.special_codes[vl.code]
            kind = None if ruling == "valid" else ruling
        elif kind == "unresolved":
            raise CatalogError(
                f"{name}: code {vl.code} label {vl.label!r} is parenthesised but matches no "
                "known non-response phrasing; add a special_codes ruling in variables.yaml"
            )
        if kind is not None and vl.code not in nonresponse[kind]:
            nonresponse[kind].append(vl.code)
        country_code, label = (
            (None, vl.label)
            if kind is not None
            else _split_country_label(vl.code, vl.label, countries)
        )
        records.append(
            ValueLabelRecord(
                variable=name,
                wave=wave,
                country_code=country_code,
                code=vl.code,
                label=label,
                is_nonresponse=kind is not None,
            )
        )
    for codes in nonresponse.values():
        codes.sort()
    return records, nonresponse


def _infer_scale(
    name: str,
    valid: list[ValueLabelRecord],
    override: VariableOverride,
) -> tuple[str, int | None, int | None]:
    """(scale_type, min, max) from the value labels, unless overridden."""
    inferred: tuple[str, int | None, int | None] | None = None
    for pattern, scale in _NAME_SCALE_RULES:
        if pattern.search(name):
            inferred = (scale, None, None)
            break
    if inferred is None:
        codes = sorted({v.code for v in valid})
        top_codes = [v.code for v in valid if _TOP_CODE_RE.match(v.label)]
        if any(v.country_code is not None for v in valid):
            inferred = ("nominal", min(codes), max(codes))
        elif top_codes:
            inferred = ("count", 0 if 0 in codes else None, max(top_codes))
        elif codes == [0, 10]:
            inferred = ("scale_0_10", 0, 10)
        elif codes == [1, 2]:
            inferred = ("binary", 1, 2)
        elif (
            len(codes) >= 3
            and codes[0] in (0, 1)
            and codes == list(range(codes[0], codes[0] + len(codes)))
        ):
            inferred = ("ordinal", codes[0], codes[-1])
        elif codes:
            inferred = ("nominal", codes[0], codes[-1])
        else:
            inferred = ("continuous", None, None)
    scale = override.scale_type or inferred[0]
    lo = override.min if override.min is not None else inferred[1]
    hi = override.max if override.max is not None else inferred[2]
    return scale, lo, hi


def expand_scale_labels(records: list[ValueLabelRecord]) -> list[ValueLabelRecord]:
    """Fill codes 1–9 (no label) for 0–10 scales that print endpoints only."""
    present = {r.code for r in records}
    template = next(r for r in records if r.code in (0, 10))
    filled = list(records)
    for code in range(11):
        if code not in present:
            filled.append(
                ValueLabelRecord(
                    variable=template.variable,
                    wave=template.wave,
                    country_code=None,
                    code=code,
                    label="",
                    is_nonresponse=False,
                )
            )
    return filled


def build_catalog(
    entries: list[RawEntry],
    global_columns: list[str],
    us_columns: list[str],
    overrides: Overrides,
) -> tuple[Catalog, CoverageReport]:
    by_base, unmatched = _resolve_headings(entries, overrides)

    global_bases: list[str] = []
    seen_bases: set[str] = set()
    for column in global_columns:
        base = base_name(column)
        if base not in seen_bases:
            seen_bases.add(base)
            global_bases.append(base)
    us_only_bases: list[str] = []
    for column in us_columns:
        base = base_name(column)
        if column not in global_columns and base not in seen_bases:
            seen_bases.add(base)
            us_only_bases.append(base)
    all_columns = global_columns + [c for c in us_columns if c not in global_columns]

    report = CoverageReport()
    report.unmatched_headings = [
        h for h in unmatched if h not in overrides.allow_unmatched_headings
    ]

    variables: list[VariableRecord] = []
    value_labels: list[ValueLabelRecord] = []
    aliases: list[AliasRecord] = []

    for base in global_bases + us_only_bases:
        override = overrides.variables.get(base)
        base_entries = by_base.get(base, [])
        if override is None:
            if base not in overrides.allow_undocumented_columns:
                report.undocumented_columns.append(base)
            continue
        report.documented.append(base)
        if override.review_status == "draft":
            report.drafts.append(base)

        # Per-wave codebook entries (INCOME_Y1/INCOME_Y2, WAVE_Y1/Y2/MY) keep
        # their wave tag on the value labels; single entries stay untagged.
        tag_waves = len(base_entries) > 1
        raw_labels: list[tuple[str | None, ValueLabelRaw]] = []
        for entry, wave in base_entries:
            for vl in entry.value_labels:
                raw_labels.append((wave if tag_waves else None, vl))
        records, nonresponse = _classify_labels(base, raw_labels, override, overrides.countries)
        valid = [r for r in records if not r.is_nonresponse]
        scale, lo, hi = _infer_scale(base, valid, override)
        if scale == "scale_0_10" and valid:
            records = expand_scale_labels(records)
        records.sort(key=lambda r: (r.wave or "", r.code))
        value_labels.extend(records)

        first = base_entries[0][0] if base_entries else None
        pages: list[int] | None = None
        if base_entries:
            pages = [
                min(e.page_from for e, _ in base_entries),
                max(e.page_to for e, _ in base_entries),
            ]
        for entry, _wave in base_entries:
            aliases.append(
                AliasRecord(
                    heading=entry.heading,
                    variable=base,
                    variable_label=_flatten(entry.variable_label),
                    pages=(entry.page_from, entry.page_to),
                )
            )
        variables.append(
            VariableRecord(
                name=base,
                display_name=override.display_name,
                label=_flatten(first.variable_label) if first else None,
                wording=_flatten(first.wording) if first else None,
                section=first.section if first else None,
                family=override.family,
                scale_type=scale,
                direction=override.direction,
                min=lo,
                max=hi,
                waves_available=waves_available(all_columns, base),
                is_country_specific=any(r.country_code is not None for r in records),
                is_us_only=override.is_us_only,
                sfi_domain=override.sfi_domain,
                nonresponse_codes=nonresponse,
                restricted=False,
                review_status=override.review_status,
                source_pages=pages,
                codebook_headings=sorted({e.heading for e, _ in base_entries}),
                notes=override.notes,
            )
        )

    stale = sorted(set(overrides.variables) - set(report.documented))
    if stale:
        raise CatalogError(f"overrides for columns not in any CSV: {', '.join(stale)}")

    variables.sort(key=lambda v: v.name)
    value_labels.sort(key=lambda r: (r.variable, r.wave or "", r.code))
    aliases.sort(key=lambda a: (a.variable, a.heading))
    catalog = Catalog(
        variables=variables,
        value_labels=value_labels,
        countries=sorted(overrides.countries.values(), key=lambda c: c.code),
        aliases=aliases,
    )
    return catalog, report


def _flatten(text: str | None) -> str | None:
    return text.replace("\n", " ") if text else None
