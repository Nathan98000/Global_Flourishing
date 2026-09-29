"""Midyear pairs (ADR-0020) against the synthetic data: at wave=MY a
midyear question reads its midyear answers and every other question the
same respondent's answers from ``other_wave`` (Y1 by default, or Y2), on
the frame and the weight the pairing takes — every midyear respondent
(``w_l1m``) for 2023, those who also did Wave 2 (``w_l1m2``) for 2024.

In the synthetic data MONEY and TIME_MEDIA are asked only in the midyear
survey, BALANCE
in all three waves (so it is a midyear question too), HAPPY, WB_TODAY and
INCOME_FEELINGS at Wave 1 and Wave 2, and LONELY at Wave 1 only.
"""

import polars as pl
import pytest
from fastapi.testclient import TestClient
from flourish_api.data import DataStore
from flourish_stats import NO_SUPPRESSION, Design, weighted_correlation

MY_ANSWERS = {"MONEY", "BALANCE", "TIME_MEDIA"}


def get(client: TestClient, path: str, **params: object) -> dict:
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def refused(client: TestClient, path: str, **params: object) -> list[str]:
    response = client.get(path, params=params)
    assert response.status_code == 422, response.text
    return response.json()["detail"]


def respondents(store: DataStore) -> pl.DataFrame:
    assert store.con is not None
    frame = pl.from_arrow(store.con.execute("FROM respondents").arrow())
    assert isinstance(frame, pl.DataFrame)
    return frame


def answers(store: DataStore, variable: str, wave: str) -> pl.DataFrame:
    assert store.con is not None
    frame = pl.from_arrow(
        store.con.execute(
            "SELECT id, value FROM responses_long WHERE variable = ? AND wave = ?",
            [variable, wave],
        ).arrow()
    )
    assert isinstance(frame, pl.DataFrame)
    return frame.rename({"value": variable})


@pytest.mark.parametrize(
    ("other", "weight", "key", "eligible"),
    [
        ("Y1", "w_l1m", "y1_my", pl.col("has_midyear")),
        ("Y2", "w_l1m2", "y1_my_y2", pl.col("has_midyear") & pl.col("retained_y2")),
    ],
)
def test_each_pairing_takes_its_own_people_and_weight(
    client: TestClient, store: DataStore, other: str, weight: str, key: str, eligible: pl.Expr
) -> None:
    people = respondents(store).filter(eligible)
    assert people[weight].null_count() == 0
    body = get(
        client,
        "/v1/correlations/pair",
        y="HAPPY",
        x="MONEY",
        wave="MY",
        other_wave=other,
        filter="country_code:22",
    )
    meta = body["shares"]["meta"]
    assert meta["weight"] == weight and meta["weight_key"] == key
    assert meta["n_frame"] == people.filter(pl.col("country_code") == 22).height
    assert meta["other_wave"] == other
    assert meta["answer_waves"] == {"MONEY": "MY", "HAPPY": other}
    # The correlation of the midyear answers with the same people's
    # other-wave answers, by hand: joined on the person, on the frame.
    frame = (
        people.filter(pl.col("country_code") == 22)
        .join(answers(store, "MONEY", "MY"), on="id", how="left")
        .join(answers(store, "HAPPY", other), on="id", how="left")
    )
    expected = weighted_correlation(
        frame, "MONEY", "HAPPY", Design(weight=weight), policy=NO_SUPPRESSION
    ).to_pylist()[0]
    assert body["correlation"]["estimate"] == pytest.approx(expected["estimate"], abs=1e-12)
    assert body["correlation"]["n"] == expected["n"]
    # The default pairing is 2023.
    if other == "Y1":
        default = get(
            client,
            "/v1/correlations/pair",
            y="HAPPY",
            x="MONEY",
            wave="MY",
            filter="country_code:22",
        )
        assert default["correlation"] == body["correlation"]


def test_every_new_refusal(client: TestClient) -> None:
    one = {"filter": "country_code:1"}
    (message,) = refused(
        client, "/v1/correlates", outcome="HAPPY", wave="Y1", other_wave="Y2", **one
    )
    assert "other_wave applies at wave=MY only" in message
    (message,) = refused(
        client, "/v1/correlates", outcome="MONEY", wave="MY", other_wave="MY", **one
    )
    assert "other_wave must be one of ['Y1', 'Y2']" in message
    # Two questions the midyear survey did not ask belong at their wave.
    (message,) = refused(client, "/v1/correlations/pair", y="HAPPY", x="WB_TODAY", wave="MY", **one)
    assert "use wave=Y1 directly" in message
    (message,) = refused(
        client, "/v1/correlations/pair", y="HAPPY", x="WB_TODAY", wave="MY", other_wave="Y2", **one
    )
    assert "use wave=Y2 directly" in message
    (message,) = refused(
        client, "/v1/correlations", vars=["HAPPY", "WB_TODAY", "INCOME_FEELINGS"], wave="MY", **one
    )
    assert "none of HAPPY, WB_TODAY, INCOME_FEELINGS was asked in the midyear survey" in message
    (message,) = refused(
        client, "/v1/correlates", outcome="HAPPY", wave="MY", against="WB_TODAY", **one
    )
    assert "use wave=Y1 directly" in message
    # A question not asked at the other wave.
    (message,) = refused(
        client, "/v1/correlations/pair", y="LONELY", x="MONEY", wave="MY", other_wave="Y2", **one
    )
    assert "y='LONELY' was not asked in the midyear survey or at Y2" in message
    (message,) = refused(
        client,
        "/v1/correlates",
        outcome="MONEY",
        wave="MY",
        against="LONELY",
        other_wave="Y2",
        **one,
    )
    assert "against='LONELY' was not asked in the midyear survey or at Y2" in message
    # Paired with 2023, LONELY is fine.
    get(client, "/v1/correlations/pair", y="LONELY", x="MONEY", wave="MY", **one)


def test_find_related_ranks_what_the_pairing_allows(client: TestClient) -> None:
    one = {"filter": "country_code:1"}
    # A midyear question: every midyear question, and every question
    # asked at the other wave (read there).
    body = get(client, "/v1/correlates", outcome="MONEY", wave="MY", **one)
    ranked = {row["predictor"] for row in body["rows"]}
    assert "BALANCE" in ranked and {"LONELY", "WB_TODAY", "INCOME_FEELINGS"} <= ranked
    # (HAPPY competes too: the index built from it stands in for it.)
    assert body["meta"]["dropped_overlap"].get("HAPPY") in ("sfi", "sfi_happiness")
    waves = body["meta"]["answer_waves"]
    assert waves["MONEY"] == "MY" and waves["BALANCE"] == "MY" and waves["WB_TODAY"] == "Y1"
    paired_2024 = get(client, "/v1/correlates", outcome="MONEY", wave="MY", other_wave="Y2", **one)
    assert "LONELY" not in {row["predictor"] for row in paired_2024["rows"]}
    assert paired_2024["meta"]["answer_waves"]["WB_TODAY"] == "Y2"
    # Any other question: the midyear questions only.
    other = get(client, "/v1/correlates", outcome="HAPPY", wave="MY", **one)
    assert {row["predictor"] for row in other["rows"]} == MY_ANSWERS
    assert other["meta"]["answer_waves"] == {
        "HAPPY": "Y1",
        **dict.fromkeys(sorted(MY_ANSWERS), "MY"),
    }


def test_a_table_takes_every_cell_on_the_same_people(client: TestClient, store: DataStore) -> None:
    body = get(
        client,
        "/v1/correlations",
        vars=["MONEY", "HAPPY", "WB_TODAY"],
        wave="MY",
        other_wave="Y2",
        filter="country_code:22",
    )
    assert body["meta"]["weight"] == "w_l1m2"
    assert body["meta"]["answer_waves"] == {"MONEY": "MY", "HAPPY": "Y2", "WB_TODAY": "Y2"}
    pairs = {(pair["a"], pair["b"]): pair for pair in body["pairs"]}
    # Two questions the midyear survey did not ask: on the pairing's
    # people (midyear and Wave 2), not the Wave 2 cross-section's.
    both = pairs[("HAPPY", "WB_TODAY")]["correlation"]
    people = (
        respondents(store)
        .filter(pl.col("has_midyear") & pl.col("retained_y2") & (pl.col("country_code") == 22))
        .join(answers(store, "HAPPY", "Y2"), on="id", how="left")
        .join(answers(store, "WB_TODAY", "Y2"), on="id", how="left")
    )
    expected = weighted_correlation(
        people, "HAPPY", "WB_TODAY", Design(weight="w_l1m2"), policy=NO_SUPPRESSION
    ).to_pylist()[0]
    assert both["n"] == expected["n"]
    assert both["estimate"] == pytest.approx(expected["estimate"], abs=1e-12)
    wave_2 = get(
        client, "/v1/correlations", vars=["HAPPY", "WB_TODAY"], wave="Y2", filter="country_code:22"
    )
    assert both["n"] < wave_2["pairs"][0]["correlation"]["n"]


def test_pooling_works_at_the_midyear_survey_too(client: TestClient) -> None:
    body = get(
        client,
        "/v1/correlations/pair",
        y="HAPPY",
        x="MONEY",
        wave="MY",
        other_wave="Y2",
        pooled="population",
    )
    meta = body["shares"]["meta"]
    assert meta["pooled"] == "population" and meta["countries"] == [1, 22]
    assert meta["answer_waves"] == {"MONEY": "MY", "HAPPY": "Y2"}
    assert body["correlation"]["n_countries"] == 2
    sweep = get(client, "/v1/correlates", outcome="MONEY", wave="MY", pooled="population")
    assert sweep["meta"]["other_wave"] == "Y1" and sweep["rows"]


def test_other_waves_say_nothing_about_answer_waves(client: TestClient) -> None:
    body = get(
        client, "/v1/correlations/pair", y="HAPPY", x="WB_TODAY", wave="Y1", filter="country_code:1"
    )
    assert body["shares"]["meta"]["other_wave"] is None
    assert body["shares"]["meta"]["answer_waves"] is None
