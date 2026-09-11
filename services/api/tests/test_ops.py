"""ETag/LRU caching, rate limiting, access logs, Sentry gating."""

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from flourish_api.config import Settings
from flourish_api.main import create_app
from flourish_api.ops import TokenBucket, init_sentry

PARAMS = {"outcome": "HAPPY", "wave": "Y1", "by": "country_code"}


class TestCaching:
    def test_miss_then_hit_with_stable_etag(self, client: TestClient) -> None:
        first = client.get("/v1/aggregate", params=PARAMS)
        again = client.get("/v1/aggregate", params=PARAMS)
        assert again.headers["x-cache"] == "hit"
        assert first.headers["etag"] == again.headers["etag"]
        assert first.json() == again.json()
        assert "max-age" in first.headers["cache-control"]

    def test_if_none_match_returns_304_before_any_work(self, client: TestClient) -> None:
        etag = client.get("/v1/aggregate", params=PARAMS).headers["etag"]
        resp = client.get("/v1/aggregate", params=PARAMS, headers={"If-None-Match": etag})
        assert resp.status_code == 304
        assert resp.headers["etag"] == etag
        assert resp.content == b""

    def test_key_is_order_insensitive_but_value_sensitive(self, client: TestClient) -> None:
        a = client.get(
            "/v1/aggregate", params={"wave": "Y1", "outcome": "HAPPY", "by": "country_code"}
        )
        b = client.get(
            "/v1/aggregate", params={"by": "country_code", "outcome": "HAPPY", "wave": "Y1"}
        )
        assert a.headers["etag"] == b.headers["etag"]
        c = client.get("/v1/aggregate", params={**PARAMS, "wave": "Y2"})
        assert c.headers["etag"] != a.headers["etag"]

    def test_errors_are_not_cached(self, client: TestClient) -> None:
        resp = client.get("/v1/aggregate", params={"outcome": "NOPE", "wave": "Y1"})
        assert resp.status_code == 422
        assert "etag" not in resp.headers

    def test_csv_export_is_cached_with_disposition(self, client: TestClient) -> None:
        client.get("/v1/export.csv", params=PARAMS)
        again = client.get("/v1/export.csv", params=PARAMS)
        assert again.headers["x-cache"] == "hit"
        assert "content-disposition" in again.headers
        assert again.headers["content-type"].startswith("text/csv")

    def test_health_is_not_cached(self, client: TestClient) -> None:
        resp = client.get("/health")
        assert "etag" not in resp.headers


class TestRateLimit:
    @pytest.fixture()
    def prod_client(self, synthetic_data_dir: Path) -> TestClient:
        settings = Settings(
            env="prod",
            data_path=synthetic_data_dir / "flourish.duckdb",
            rate_limit_per_minute=3,
        )
        return TestClient(create_app(settings))

    def test_bucket_empties_then_429_with_retry_after(self, prod_client: TestClient) -> None:
        for _ in range(3):
            assert prod_client.get("/v1/meta").status_code == 200
        resp = prod_client.get("/v1/meta")
        assert resp.status_code == 429
        assert int(resp.headers["retry-after"]) >= 1

    def test_keyed_by_forwarded_for(self, prod_client: TestClient) -> None:
        for _ in range(3):
            prod_client.get("/v1/meta", headers={"X-Forwarded-For": "10.0.0.1"})
        blocked = prod_client.get("/v1/meta", headers={"X-Forwarded-For": "10.0.0.1"})
        other = prod_client.get("/v1/meta", headers={"X-Forwarded-For": "10.0.0.2"})
        assert blocked.status_code == 429
        assert other.status_code == 200

    def test_health_is_never_limited(self, prod_client: TestClient) -> None:
        for _ in range(10):
            assert prod_client.get("/health").status_code == 200

    def test_dev_mode_is_unlimited(self, client: TestClient) -> None:
        for _ in range(10):
            assert client.get("/v1/meta").status_code == 200


class TestTokenBucket:
    def test_refills_over_time(self) -> None:
        bucket = TokenBucket(per_minute=60)  # one per second
        assert bucket.check("ip", now=0.0) == 0.0
        for _ in range(59):
            bucket.check("ip", now=0.0)
        wait = bucket.check("ip", now=0.0)
        assert wait == pytest.approx(1.0)
        assert bucket.check("ip", now=2.0) == 0.0  # refilled

    def test_sweep_drops_stale_buckets(self) -> None:
        bucket = TokenBucket(per_minute=60)
        for i in range(5000):
            bucket.check(f"ip-{i}", now=0.0)
        bucket.sweep(now=500.0)
        assert len(bucket._buckets) == 0


def test_access_log_line(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.INFO, logger="flourish_api.access"):
        client.get("/v1/meta")
    line = next(r.message for r in caplog.records if "/v1/meta" in r.message)
    assert "200" in line and "ms" in line


def test_sentry_only_with_dsn(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert init_sentry(Settings(data_path=tmp_path / "no.duckdb")) is False

    calls: list[dict] = []
    import sentry_sdk

    monkeypatch.setattr(sentry_sdk, "init", lambda **kwargs: calls.append(kwargs))
    settings = Settings(
        data_path=tmp_path / "no.duckdb",
        sentry_dsn="https://examplekey@o0.ingest.sentry.io/0",
    )
    assert init_sentry(settings) is True
    assert calls and calls[0]["dsn"] == settings.sentry_dsn
    assert calls[0]["environment"] == "dev"
