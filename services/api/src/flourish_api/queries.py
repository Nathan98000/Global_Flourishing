"""The typed query model: parse + validate aggregate requests.

Everything a request can ask for is validated against the catalog before
any data is touched, and every rejection is a 422 whose messages name the
fix (proposal §7 Phase 3: "validation that rejects nonsense"). Weight
choice is **not** expressible here — it always flows through
``flourish_stats.weights.resolve`` from (waves, scope).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from fastapi import HTTPException
from flourish_stats import WeightSpec, get, resolve

from flourish_api.data import Catalog, VariableInfo

#: Respondent columns a request may group or filter by. The value sets
#: mirror pipeline/src/flourish_pipeline/schemas.py (asserted against the
#: built data in the `built`-marked tests).
BREAKDOWNS: dict[str, tuple[str | int, ...]] = {
    "country_code": (),  # validated against the catalog's countries table
    "age_band": ("18-24", "25-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"),
    "gender": (1, 2, 3, 4),
    "education_3": (1, 2, 3),
    "employment": (1, 2, 3, 4, 5, 6, 7, 8),
    "marital_status": (1, 2, 3, 4, 5, 6),
    "urban_rural": (1, 2, 3, 4),
    "income_quintile": (1, 2, 3, 4, 5),
}
#: `state` joins the list under the US scopes only.
STATE_COLUMN = "state"

STATS = ("mean", "proportion", "distribution", "quantile")
SCOPES = ("global", "us_state", "us_state_adj")
WAVES = ("Y1", "MY", "Y2")

#: stat → scale types it applies to (docs/prompts/phase-3-api.md §2.2).
STAT_SCALE_TYPES: dict[str, frozenset[str]] = {
    "mean": frozenset({"scale_0_10", "count", "ordinal", "binary"}),
    "quantile": frozenset({"scale_0_10", "count"}),
    "proportion": frozenset({"ordinal", "nominal", "binary"}),
    "distribution": frozenset({"scale_0_10", "count", "ordinal", "nominal", "binary"}),
}

#: Categorical scale types usable as a variable-valued breakdown.
CATEGORICAL_SCALE_TYPES = frozenset({"ordinal", "nominal", "binary"})

MAX_BY = 3


@dataclass(frozen=True)
class DomainFilter:
    """A non-country filter: applied as a domain, never as a row subset."""

    column: str
    values: tuple[str | int, ...]


@dataclass(frozen=True)
class AggregateQuery:
    outcome: VariableInfo
    stat: str
    wave: str
    by: tuple[str, ...]  # respondent columns, validated
    by_variable: VariableInfo | None  # at most one catalog variable as a breakdown
    countries: tuple[int, ...]  # subset filter (safe: strata nest in countries)
    filters: tuple[DomainFilter, ...]
    scope: str
    oriented: bool
    p: tuple[float, ...] = (0.5,)

    @property
    def group_columns(self) -> tuple[str, ...]:
        extra = (self.by_variable.name,) if self.by_variable else ()
        return (*self.by, *extra)


@dataclass
class _Problems:
    messages: list[str] = field(default_factory=list[str])

    def add(self, message: str) -> None:
        self.messages.append(message)

    def raise_if_any(self) -> None:
        if self.messages:
            raise HTTPException(status_code=422, detail=self.messages)


def _parse_filter_value(column: str, raw: str, problems: _Problems) -> str | int | None:
    allowed = BREAKDOWNS.get(column)
    if column == "age_band" or column == STATE_COLUMN:
        value: str | int = raw
    else:
        try:
            value = int(raw)
        except ValueError:
            problems.add(f"filter {column!r}: {raw!r} is not an integer code")
            return None
    if allowed and value not in allowed:
        problems.add(f"filter {column!r}: {value!r} is not one of {sorted(map(str, allowed))}")
        return None
    return value


def parse_aggregate_query(
    catalog: Catalog,
    *,
    outcome: str,
    stat: str,
    wave: str,
    by: list[str],
    filters: list[str],
    scope: str,
    oriented: bool,
    p: list[float] | None,
) -> AggregateQuery:
    """Validate raw query parameters into an :class:`AggregateQuery`.

    Raises HTTPException 422 carrying *all* problems found, each phrased
    as the fix ("HAPPY is not asked at MY; it is available at Y1, Y2").
    """
    problems = _Problems()

    info = catalog.outcome(outcome)
    if info is None:
        problems.add(
            f"unknown or non-servable outcome {outcome!r} — see /v1/variables "
            f"(country-specific and design variables cannot be aggregated)"
        )
        problems.raise_if_any()
        raise AssertionError("unreachable")

    if wave not in WAVES:
        problems.add(f"wave must be one of {list(WAVES)}, got {wave!r}")
    elif wave not in info.waves:
        problems.add(
            f"{info.name} is not asked at {wave}; it is available at {', '.join(info.waves)}"
        )

    if stat not in STATS:
        problems.add(f"stat must be one of {list(STATS)}, got {stat!r}")
    elif info.scale_type not in STAT_SCALE_TYPES[stat]:
        problems.add(
            f"stat {stat!r} does not apply to {info.name} "
            f"(scale_type {info.scale_type!r}); valid stats: "
            f"{sorted(s for s, types in STAT_SCALE_TYPES.items() if info.scale_type in types)}"
        )

    if scope not in SCOPES:
        problems.add(f"scope must be one of {list(SCOPES)}, got {scope!r}")
        problems.raise_if_any()
    if wave in WAVES:
        try:
            resolve((wave,), scope)
        except KeyError:
            problems.add(
                f"no weight exists for wave {wave} in scope {scope!r} (the release "
                f"has no _ADJ_ variant of the Wave 1 state weight; see /v1/meta)"
            )

    if oriented and info.is_derived:
        problems.add(
            f"oriented=true does not apply to derived outcome {info.name!r} "
            f"(derived scores are already higher-is-better)"
        )

    # --- by ---------------------------------------------------------------
    allowed_columns = set(BREAKDOWNS)
    if scope != "global":
        allowed_columns.add(STATE_COLUMN)
    seen: list[str] = []
    by_variable: VariableInfo | None = None
    for name in by:
        if name in seen or (by_variable is not None and name == by_variable.name):
            problems.add(f"duplicate by={name!r}")
            continue
        if name in allowed_columns:
            seen.append(name)
            continue
        candidate = catalog.outcome(name)
        if candidate is None or candidate.is_derived:
            problems.add(
                f"by={name!r} is neither a demographic breakdown "
                f"({sorted(allowed_columns)}) nor a categorical survey variable"
            )
        elif candidate.scale_type not in CATEGORICAL_SCALE_TYPES:
            problems.add(
                f"by={name!r} has scale_type {candidate.scale_type!r}; only "
                f"categorical variables ({sorted(CATEGORICAL_SCALE_TYPES)}) can break down"
            )
        elif wave not in candidate.waves:
            problems.add(f"by={name!r} is not asked at {wave} (available: {candidate.waves})")
        elif name == info.name:
            problems.add(f"by={name!r} cannot break an outcome down by itself")
        elif by_variable is not None:
            problems.add(
                f"at most one survey variable may appear in by= "
                f"(got {by_variable.name!r} and {name!r})"
            )
        else:
            by_variable = candidate
    if len(seen) + (1 if by_variable else 0) > MAX_BY:
        problems.add(f"at most {MAX_BY} by= dimensions are supported")

    # --- filters ----------------------------------------------------------
    countries: list[int] = []
    domain_filters: dict[str, list[str | int]] = {}
    for item in filters:
        column, sep, raw = item.partition(":")
        if not sep or not raw:
            problems.add(f"filter {item!r} must look like column:value")
            continue
        if column == "country_code":
            try:
                code = int(raw)
            except ValueError:
                problems.add(f"filter country_code: {raw!r} is not an integer code")
                continue
            if code not in catalog.country_codes():
                problems.add(f"filter country_code: unknown country {code}")
            elif code not in countries:
                countries.append(code)
            continue
        if column not in allowed_columns:
            problems.add(
                f"filter column {column!r} is not filterable; use one of "
                f"{sorted({*allowed_columns, 'country_code'})}"
            )
            continue
        value = _parse_filter_value(column, raw, problems)
        if value is not None:
            domain_filters.setdefault(column, []).append(value)

    # --- scope rules --------------------------------------------------------
    if scope == "global" and "country_code" not in seen and not countries:
        problems.add(
            "global-scope estimates must group by country (by=country_code) or "
            "filter to countries (filter=country_code:N) — weights are "
            "normalised within country, so pooling countries is not "
            "meaningful until the population-rescaled option (Phase 5)"
        )
    if scope != "global" and countries and countries != [22]:
        problems.add(f"scope {scope!r} is US-only; drop the country filter {countries}")

    # --- p ------------------------------------------------------------------
    p_values: tuple[float, ...] = (0.5,)
    if p:
        if stat != "quantile":
            problems.add("p= only applies to stat=quantile")
        elif not all(0.0 < q < 1.0 for q in p):
            problems.add(f"p values must lie strictly between 0 and 1, got {p}")
        else:
            p_values = tuple(dict.fromkeys(p))

    problems.raise_if_any()
    return AggregateQuery(
        outcome=info,
        stat=stat,
        wave=wave,
        by=tuple(seen),
        by_variable=by_variable,
        countries=tuple(countries),
        filters=tuple(
            DomainFilter(column, tuple(values)) for column, values in domain_filters.items()
        ),
        scope=scope,
        oriented=oriented,
        p=p_values,
    )


@dataclass(frozen=True)
class ChangeQuery:
    """A validated /v1/change request: the same people at two (or three)
    waves, weight resolved from the table — never chosen by the caller."""

    outcome: VariableInfo
    waves: tuple[str, ...]  # chronological: (from, to) or (from, via, to)
    spec: WeightSpec
    by: tuple[str, ...]
    countries: tuple[int, ...]
    filters: tuple[DomainFilter, ...]
    scope: str
    rect: bool

    @property
    def is_three_point(self) -> bool:
        return len(self.waves) == 3


def parse_change_query(
    catalog: Catalog,
    *,
    outcome: str,
    from_wave: str,
    to_wave: str,
    via: str | None,
    by: list[str],
    filters: list[str],
    scope: str,
    rect: bool,
) -> ChangeQuery:
    """Validate a change request. The outcome must be asked at every
    requested wave; the weight comes from ``resolve``/``get`` only, and the
    midyear-mode restriction rides in on the spec (`my_y2` rows)."""
    problems = _Problems()

    info = catalog.outcome(outcome)
    if info is None:
        problems.add(f"unknown or non-servable outcome {outcome!r} — see /v1/variables")
        problems.raise_if_any()
        raise AssertionError("unreachable")
    if scope not in SCOPES:
        problems.add(f"scope must be one of {list(SCOPES)}, got {scope!r}")
        problems.raise_if_any()

    chronological: tuple[str, ...] = (from_wave, via, to_wave) if via else (from_wave, to_wave)
    for wave in chronological:
        if wave not in WAVES:
            problems.add(f"wave must be one of {list(WAVES)}, got {wave!r}")
    problems.raise_if_any()
    order = [WAVES.index(w) for w in chronological]
    if len(set(order)) != len(order) or order != sorted(order):
        problems.add(
            f"waves must be distinct and chronological (Y1 → MY → Y2), got {chronological}"
        )
    for wave in chronological:
        if wave not in info.waves:
            problems.add(
                f"{info.name} is not asked at {wave}; change needs the same item "
                f"at every requested wave (available: {', '.join(info.waves)})"
            )
    problems.raise_if_any()

    if rect and chronological != ("Y1", "Y2"):
        problems.add("rect=true (the rectangular w_r2 weight) only applies to from=Y1&to=Y2")
    try:
        if rect and chronological == ("Y1", "Y2"):
            spec = get("y1_y2_rect" if scope == "global" else f"{scope}:y1_y2_rect")
        else:
            spec = resolve(chronological, scope)
    except KeyError:
        supported = "Y1→Y2, Y1→MY, MY→Y2, Y1→MY→Y2"
        problems.add(
            f"no longitudinal weight exists for waves {chronological} in scope "
            f"{scope!r}; supported: {supported} (see /v1/meta weight_table)"
        )
        problems.raise_if_any()
        raise AssertionError("unreachable") from None

    # Breakdowns: demographics only for change (a variable-valued breakdown
    # would need its own wave choice; not offered).
    allowed_columns = set(BREAKDOWNS)
    if scope != "global":
        allowed_columns.add(STATE_COLUMN)
    seen: list[str] = []
    for name in by:
        if name in seen:
            problems.add(f"duplicate by={name!r}")
        elif name not in allowed_columns:
            problems.add(
                f"by={name!r}: change breakdowns are the demographic columns "
                f"only ({sorted(allowed_columns)})"
            )
        else:
            seen.append(name)

    countries: list[int] = []
    domain_filters: dict[str, list[str | int]] = {}
    for item in filters:
        column, sep, raw = item.partition(":")
        if not sep or not raw:
            problems.add(f"filter {item!r} must look like column:value")
            continue
        if column == "country_code":
            try:
                code = int(raw)
            except ValueError:
                problems.add(f"filter country_code: {raw!r} is not an integer code")
                continue
            if code not in catalog.country_codes():
                problems.add(f"filter country_code: unknown country {code}")
            elif code not in countries:
                countries.append(code)
            continue
        if column not in allowed_columns:
            problems.add(f"filter column {column!r} is not filterable")
            continue
        value = _parse_filter_value(column, raw, problems)
        if value is not None:
            domain_filters.setdefault(column, []).append(value)

    if scope == "global" and "country_code" not in seen and not countries:
        problems.add(
            "global-scope change must group by country (by=country_code) or "
            "filter to countries (filter=country_code:N)"
        )
    if scope != "global" and countries and countries != [22]:
        problems.add(f"scope {scope!r} is US-only; drop the country filter {countries}")

    problems.raise_if_any()
    return ChangeQuery(
        outcome=info,
        waves=chronological,
        spec=spec,
        by=tuple(seen),
        countries=tuple(countries),
        filters=tuple(
            DomainFilter(column, tuple(values)) for column, values in domain_filters.items()
        ),
        scope=scope,
        rect=rect,
    )
