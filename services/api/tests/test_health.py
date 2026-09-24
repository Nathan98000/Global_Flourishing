from fastapi.testclient import TestClient
from flourish_api import __version__
from flourish_api.config import Settings
from flourish_api.main import create_app


def test_health_with_data(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {
        "status": "ok",
        "service": "flourish-atlas-api",
        "version": __version__,
        "git_sha": None,
        "data": "ok",
        "data_version": "synthetic.0.0.1",
    }


def test_health_is_honest_without_data(absent_client: TestClient) -> None:
    body = absent_client.get("/health").json()
    assert body["status"] == "ok"  # the process is healthy…
    assert body["data"] == "absent"  # …the deployment just has no data
    assert body["data_version"] is None


def test_root_redirects_to_docs(client: TestClient) -> None:
    resp = client.get("/", follow_redirects=False)
    assert resp.status_code == 307
    assert resp.headers["location"] == "/docs"


def test_git_sha_from_settings(tmp_path) -> None:
    sha_app = create_app(Settings(git_sha="abc1234", data_path=tmp_path / "no.duckdb"))
    resp = TestClient(sha_app).get("/health")
    assert resp.json()["git_sha"] == "abc1234"


def test_cors_header_for_configured_origin(tmp_path) -> None:
    cors_app = create_app(
        Settings(cors_origins="https://flourish-atlas.pages.dev", data_path=tmp_path / "no.duckdb")
    )
    resp = TestClient(cors_app).get(
        "/health", headers={"Origin": "https://flourish-atlas.pages.dev"}
    )
    assert resp.headers["access-control-allow-origin"] == "https://flourish-atlas.pages.dev"


def test_no_cors_header_without_configuration(absent_client: TestClient) -> None:
    resp = absent_client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in resp.headers


def test_dev_allows_the_vite_servers_by_default(absent_client: TestClient) -> None:
    """`make api` + `make web` must exercise the static→API fallback
    without exporting FA_CORS_ORIGINS (dev only; prod stays explicit)."""
    resp = absent_client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert resp.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_prod_has_no_default_origins(tmp_path) -> None:
    prod_app = create_app(Settings(env="prod", data_path=tmp_path / "no.duckdb"))
    resp = TestClient(prod_app).get("/health", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in resp.headers


def test_unhandled_errors_are_json_500s_with_cors(tmp_path) -> None:
    """A bug must reach the browser as an error, not as a network failure:
    the JSON 500 is produced inside the CORS middleware, so it carries
    the CORS headers the front end needs to read it."""
    app = create_app(
        Settings(cors_origins="https://flourish-atlas.pages.dev", data_path=tmp_path / "no.duckdb")
    )

    @app.get("/boom")
    def boom() -> None:  # pyright: ignore[reportUnusedFunction]
        raise ValueError("9 eligible rows have a null weight")

    resp = TestClient(app, raise_server_exceptions=False).get(
        "/boom", headers={"Origin": "https://flourish-atlas.pages.dev"}
    )
    assert resp.status_code == 500
    assert resp.headers["access-control-allow-origin"] == "https://flourish-atlas.pages.dev"
    assert resp.headers["content-type"].startswith("application/json")
    assert (
        resp.json()["detail"]
        == "Internal server error: ValueError: 9 eligible rows have a null weight"
    )
