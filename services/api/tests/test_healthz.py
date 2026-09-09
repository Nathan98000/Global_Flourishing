from fastapi.testclient import TestClient
from flourish_api import __version__
from flourish_api.main import app

client = TestClient(app)


def test_healthz_ok() -> None:
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "version": __version__}


def test_root_points_at_docs_and_cites_data() -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["docs"] == "/docs"
    assert "10.17605/OSF.IO/3JTZ8" in body["data_citation"]
