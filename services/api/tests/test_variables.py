"""GET /v1/variables and /v1/variables/{name}."""

from fastapi.testclient import TestClient


def names(body: dict) -> list[str]:
    return [v["name"] for v in body["variables"]]


def test_listing_covers_catalog_and_derived(client: TestClient) -> None:
    body = client.get("/v1/variables").json()
    listed = names(body)
    assert "HAPPY" in listed and "sfi" in listed and "phq2_positive" in listed
    assert "WAVE" not in listed  # design bookkeeping is not a variable
    by_name = {v["name"]: v for v in body["variables"]}
    assert by_name["INCOME"]["is_country_specific"] is True
    assert by_name["INCOME"]["servable"] is False  # listed, searchable, not chartable
    assert by_name["sfi"]["is_derived"] is True and by_name["sfi"]["family"] == "derived"
    assert by_name["LONELY"]["direction"] == "lower_better"


def test_search_matches_name_display_and_wording(client: TestClient) -> None:
    # "happi" hits the item and the derived domain built from it.
    assert names(client.get("/v1/variables", params={"q": "happi"}).json()) == [
        "HAPPY",
        "sfi_happiness",
    ]
    assert "ATTEND_SVCS" in names(client.get("/v1/variables", params={"q": "attend"}).json())
    # wording matches too ("How would you rate: …?")
    assert len(names(client.get("/v1/variables", params={"q": "how would you rate"}).json())) > 3
    assert "sfi" in names(client.get("/v1/variables", params={"q": "flourishing"}).json())


def test_family_filter(client: TestClient) -> None:
    assert names(client.get("/v1/variables", params={"family": "religion"}).json()) == [
        "ATTEND_SVCS"
    ]
    derived = names(client.get("/v1/variables", params={"family": "derived"}).json())
    assert derived == sorted(derived) and "sfi" in derived and "HAPPY" not in derived
    resp = client.get("/v1/variables", params={"family": "nope"})
    assert resp.status_code == 422
    assert "unknown family" in resp.json()["detail"]


def test_detail_with_labels_and_missingness(client: TestClient) -> None:
    body = client.get("/v1/variables/ATTEND_SVCS").json()
    assert body["wording"].startswith("How would you rate")
    labels = {label["code"]: label for label in body["value_labels"]}
    assert labels[1]["label"] == "Weekly"
    assert labels[99]["is_nonresponse"] is True
    rows = body["missingness"]
    assert {(r["wave"], r["country_code"]) for r in rows} == {
        ("Y1", 1),
        ("Y1", 22),
        ("Y2", 1),
        ("Y2", 22),
    }
    y1_testland = next(r for r in rows if r["wave"] == "Y1" and r["country_code"] == 1)
    assert y1_testland["n_present"] == 60 and y1_testland["n_valid"] == 60


def test_detail_counts_nonresponse(client: TestClient) -> None:
    rows = client.get("/v1/variables/HAPPY").json()["missingness"]
    y1_testland = next(r for r in rows if r["wave"] == "Y1" and r["country_code"] == 1)
    assert y1_testland["n_present"] == 60
    assert y1_testland["n_skipped"] == 6  # ids 10, 20, …, 60
    assert y1_testland["n_valid"] == 54


def test_detail_for_derived_outcome(client: TestClient) -> None:
    body = client.get("/v1/variables/phq2_positive").json()
    assert body["is_derived"] is True
    assert body["direction"] == "lower_better"
    assert body["value_labels"] == [] and body["missingness"] == []
    assert body["label"].startswith("PHQ-2 score")


def test_unknown_variable_404(client: TestClient) -> None:
    resp = client.get("/v1/variables/NOPE")
    assert resp.status_code == 404
    assert "/v1/variables" in resp.json()["detail"]


def test_503_without_data(absent_client: TestClient) -> None:
    assert absent_client.get("/v1/variables").status_code == 503
    assert absent_client.get("/v1/variables/HAPPY").status_code == 503
