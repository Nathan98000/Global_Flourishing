from fastapi.testclient import TestClient
from flourish_api import __version__
from flourish_api.config import Settings
from flourish_api.main import app, create_app

client = TestClient(app)


def test_health_shape() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "service": "flourish-atlas-api",
        "version": __version__,
        "git_sha": None,
        "data_version": None,
    }


def test_root_redirects_to_docs() -> None:
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == "/docs"


def test_git_sha_from_settings() -> None:
    sha_app = create_app(Settings(git_sha="abc1234"))
    resp = TestClient(sha_app).get("/health")
    assert resp.json()["git_sha"] == "abc1234"


def test_cors_header_for_configured_origin() -> None:
    cors_app = create_app(Settings(cors_origins="https://flourish-atlas.pages.dev"))
    resp = TestClient(cors_app).get(
        "/health", headers={"Origin": "https://flourish-atlas.pages.dev"}
    )
    assert resp.headers["access-control-allow-origin"] == "https://flourish-atlas.pages.dev"


def test_no_cors_header_without_configuration() -> None:
    resp = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in resp.headers
