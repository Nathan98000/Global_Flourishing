"""The CSV export names what its codes stand for (G8): a country's name
after its code, a breakdown level's label after its value — the same
columns the client's export writes (export/csv.ts)."""

import csv
import io

from fastapi.testclient import TestClient


def table(text: str) -> list[dict[str, str]]:
    body = "\n".join(line for line in text.splitlines() if not line.startswith("#"))
    return list(csv.DictReader(io.StringIO(body)))


def test_each_code_is_followed_by_its_words(client: TestClient) -> None:
    meta = client.get("/v1/meta").json()
    names = {country["code"]: country["name"] for country in meta["countries"]}
    # Levels are keyed by their code as the CSV writes it (age bands are
    # strings, most others numbers).
    levels = {
        str(level["value"]): level["label"]
        for level in meta["breakdown_labels"]["age_band"]["levels"]
    }
    resp = client.get(
        "/v1/export.csv",
        params={"outcome": "HAPPY", "wave": "Y1", "by": ["country_code", "age_band"]},
    )
    rows = table(resp.text)
    header = next(line for line in resp.text.splitlines() if not line.startswith("#"))
    assert header.startswith("country_code,country,age_band,age_band_label,stat,")
    assert rows
    for row in rows:
        assert row["country"] == names[int(row["country_code"])]
        if row["age_band"]:
            assert row["age_band_label"] == levels[row["age_band"]]
