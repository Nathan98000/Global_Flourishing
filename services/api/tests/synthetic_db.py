"""A tiny synthetic DuckDB with the production schema, for CI tests.

Extends the pattern of ``stats/tests/test_io.py`` to all seven tables plus
the ``responses_oriented`` view, written to a real ``.duckdb`` file so the
:class:`~flourish_api.data.DataStore` opens it exactly as it opens the
production bake. Values are deterministic arithmetic patterns (no RNG), so
golden-file tests stay byte-stable across library versions.

Shape: two countries. Testland (code 1) is a clustered design — 2 strata ×
3 PSUs × 10 respondents; the United States (22) is self-representing (one
stratum, PSU = respondent) with states, mirroring the real design's two
extremes. 60 respondents per country keeps whole-country cells above the
suppression threshold (50) while by-cells exercise flagging/suppression.
"""

# polars' expression API ships partially-unknown signatures, so this one
# strict diagnostic is disabled for this module; every other check applies.
# pyright: reportUnknownMemberType=false

from __future__ import annotations

import json
from pathlib import Path

import duckdb
import polars as pl

AGE_BANDS = ("18-24", "25-29", "30-39", "40-49")
US_STATES = ("CA", "NY", "TX")

#: (name, display, family, scale_type, direction, min, max, waves, country_specific)
VARIABLES: tuple[tuple[str, str, str, str, str, int, int, list[str], bool], ...] = (
    ("HAPPY", "Happiness", "wellbeing", "scale_0_10", "higher_better", 0, 10, ["Y1", "Y2"], False),
    ("LONELY", "Loneliness", "wellbeing", "scale_0_10", "lower_better", 0, 10, ["Y1"], False),
    ("ATTEND_SVCS", "Service attendance", "religion", "ordinal", "none", 1, 3, ["Y1", "Y2"], False),
    (
        "MONEY",
        "Importance of money",
        "midyear",
        "scale_0_10",
        "higher_better",
        0,
        10,
        ["MY"],
        False,
    ),
    ("CHILD_MEM", "Childhood memory", "childhood", "ordinal", "none", 1, 4, ["Y1"], False),
    ("INCOME", "Household income", "demographics", "nominal", "none", 101, 999, ["Y1"], True),
    ("WAVE", "Wave flag", "design", "design", "none", 0, 0, ["Y1", "MY", "Y2"], False),
)


def _respondents() -> pl.DataFrame:
    rows: list[dict[str, object]] = []
    for i in range(1, 61):  # Testland: ids 1..60
        stratum = 101 if i <= 30 else 102
        psu = stratum * 10 + ((i - 1) % 3)  # 3 PSUs per stratum, interleaved
        rows.append(_respondent(i, 1, stratum, psu, state=None))
    for i in range(101, 161):  # US: ids 101..160, self-representing
        rows.append(_respondent(i, 22, 2201, 22000 + i, state=US_STATES[i % 3]))
    return pl.DataFrame(rows)


def _respondent(
    i: int, country: int, stratum: int, psu: int, state: str | None
) -> dict[str, object]:
    retained = i % 3 != 0
    midyear = i % 2 == 0
    weight = 0.5 + (i % 7) * 0.25
    in_us = state is not None
    return {
        "id": i,
        "country_code": country,
        "strata": stratum,
        "psu": psu,
        "age_band": AGE_BANDS[i % 4],
        "gender": 1 + i % 2,
        "education_3": 1 + i % 3,
        "employment": 1 + i % 8,
        "marital_status": 1 + i % 6,
        "urban_rural": 1 + i % 4,
        "income_quintile": 1 + i % 5,
        "retained_y2": retained,
        "has_midyear": midyear,
        "midyear_type": (1 if i % 4 == 0 else 2) if midyear else None,
        "w_c1": weight,
        "w_c2": weight * 1.1 if retained else None,
        "w_l2": weight * 0.9 if retained else None,
        "w_r2": 0.6 + (i % 5) * 0.3,  # the quirk: populated for everyone
        "w_l1m": weight * 1.05 if midyear else None,
        "w_l1m2": weight * 0.95 if retained and midyear else None,
        "state": state,
        "w_state_c1": weight if in_us else None,
        "w_state_c2": weight * 1.1 if in_us and retained else None,
        "w_state_l2": weight * 0.9 if in_us and retained else None,
        "w_state_r2": weight * 1.2 if in_us else None,
        "w_state_l1m": weight * 1.05 if in_us and midyear else None,
        "w_state_l1m2": weight * 0.95 if in_us and retained and midyear else None,
        "w_state_adj_c2": weight * 1.15 if in_us and retained else None,
        "w_state_adj_l2": weight * 0.85 if in_us and retained else None,
        "w_state_adj_r2": weight * 1.25 if in_us else None,
        "w_state_adj_l1m": weight if in_us and midyear else None,
        "w_state_adj_l1m2": weight if in_us and retained and midyear else None,
    }


def _responses(respondents: pl.DataFrame) -> pl.DataFrame:
    rows: list[dict[str, object]] = []

    def add(
        person: dict[str, object], wave: str, variable: str, value: int | None, reason: str | None
    ) -> None:
        rows.append(
            {
                "id": person["id"],
                "wave": wave,
                "variable": variable,
                "value": value,
                "nonresponse": reason,
            }
        )

    for person in respondents.iter_rows(named=True):
        i = int(person["id"])
        if i % 10 == 0:
            add(person, "Y1", "HAPPY", None, "skipped")
        else:
            add(person, "Y1", "HAPPY", (i * 3) % 11, None)
        add(person, "Y1", "LONELY", (i * 7) % 11, None)
        add(person, "Y1", "ATTEND_SVCS", 1 + i % 3, None)
        add(person, "Y1", "CHILD_MEM", 1 + i % 4, None)
        add(person, "Y1", "INCOME", 101 + i % 3, None)
        if person["retained_y2"]:
            if i % 9 == 0:
                add(person, "Y2", "HAPPY", None, "refused")
            else:
                add(person, "Y2", "HAPPY", (i * 3 + 1) % 11, None)
            add(person, "Y2", "ATTEND_SVCS", 1 + (i + 1) % 3, None)
        if person["has_midyear"]:
            add(person, "MY", "MONEY", (i * 5) % 11, None)
    return pl.DataFrame(rows).sort("variable", "wave", "id")


def _derived(respondents: pl.DataFrame) -> pl.DataFrame:
    rows: list[dict[str, object]] = []
    for person in respondents.iter_rows(named=True):
        i = int(person["id"])
        for wave in ("Y1", "Y2"):
            if wave == "Y2" and not person["retained_y2"]:
                continue
            sfi = ((i * 13) % 101) / 10.0
            phq2 = i % 7
            gad2 = (i + 3) % 7
            rows.append(
                {
                    "id": i,
                    "wave": wave,
                    "sfi": sfi,
                    "sfi_n_items": 12,
                    "sfi_happiness": sfi,
                    "sfi_health": sfi,
                    "sfi_meaning": sfi,
                    "sfi_character": sfi,
                    "sfi_relationships": sfi,
                    "sfi_financial": sfi,
                    "phq2_score": phq2,
                    "phq2_positive": phq2 >= 3,
                    "gad2_score": gad2,
                    "gad2_positive": gad2 >= 3,
                }
            )
    return pl.DataFrame(rows)


def _variables() -> pl.DataFrame:
    return pl.DataFrame(
        [
            {
                "name": name,
                "display_name": display,
                "label": f"{display} (label)",
                "wording": f"How would you rate: {display.lower()}?",
                "family": family,
                "scale_type": scale_type,
                "direction": direction,
                "min": lo,
                "max": hi,
                "waves_available": waves,
                "is_country_specific": country_specific,
                "restricted": False,
            }
            for (
                name,
                display,
                family,
                scale_type,
                direction,
                lo,
                hi,
                waves,
                country_specific,
            ) in VARIABLES
        ]
    )


def _value_labels() -> pl.DataFrame:
    rows: list[dict[str, object]] = [
        {
            "variable": "ATTEND_SVCS",
            "wave": None,
            "country_code": None,
            "code": code,
            "label": label,
            "is_nonresponse": False,
        }
        for code, label in ((1, "Weekly"), (2, "Sometimes"), (3, "Never"))
    ]
    rows.append(
        {
            "variable": "ATTEND_SVCS",
            "wave": None,
            "country_code": None,
            "code": 99,
            "label": "(Refused)",
            "is_nonresponse": True,
        }
    )
    rows.append(
        {
            "variable": "INCOME",
            "wave": None,
            "country_code": 1,
            "code": 101,
            "label": "Lowest band",
            "is_nonresponse": False,
        }
    )
    return pl.DataFrame(rows)


def _coverage(responses: pl.DataFrame, respondents: pl.DataFrame) -> pl.DataFrame:
    joined = responses.join(respondents.select("id", "country_code"), on="id")
    return (
        joined.group_by("variable", "wave", "country_code")
        .agg(
            pl.len().cast(pl.Int32).alias("n_present"),
            pl.col("value").is_not_null().sum().cast(pl.Int32).alias("n_valid"),
            (pl.col("nonresponse") == "skipped").sum().cast(pl.Int32).alias("n_skipped"),
            (pl.col("nonresponse") == "dk").sum().cast(pl.Int32).alias("n_dk"),
            (pl.col("nonresponse") == "refused").sum().cast(pl.Int32).alias("n_refused"),
        )
        .sort("variable", "wave", "country_code")
    )


def build_synthetic_db(directory: Path) -> Path:
    """Write flourish.duckdb + manifest.json into ``directory``."""
    directory.mkdir(parents=True, exist_ok=True)
    db_path = directory / "flourish.duckdb"
    respondents = _respondents()
    responses = _responses(respondents)
    tables: dict[str, pl.DataFrame] = {
        "respondents": respondents,
        "responses_long": responses,
        "derived": _derived(respondents),
        "variables": _variables(),
        "value_labels": _value_labels(),
        "countries": pl.DataFrame(
            {"code": [1, 22], "name": ["Testland", "United States"], "iso3": ["TST", "USA"]}
        ),
        "coverage": _coverage(responses, respondents),
    }
    con = duckdb.connect(str(db_path))
    try:
        for name, frame in tables.items():
            con.register("frame_view", frame.to_arrow())
            con.execute(f"CREATE TABLE {name} AS FROM frame_view")
            con.unregister("frame_view")
        # Same definition as the pipeline's oriented view (derive.py).
        con.execute(
            """
            CREATE VIEW responses_oriented AS
            SELECT r.id, r.wave, r.variable,
                   CASE WHEN v.direction = 'lower_better'
                        THEN v."min" + v."max" - r.value
                        ELSE r.value END AS value,
                   r.nonresponse
            FROM responses_long r
            JOIN variables v ON v.name = r.variable
            """
        )
    finally:
        con.close()
    (directory / "manifest.json").write_text(json.dumps({"data_version": "synthetic.0.0.1"}))
    return db_path
