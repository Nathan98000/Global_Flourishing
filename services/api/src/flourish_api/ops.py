"""Operational middleware: ETag/Cache-Control, in-process LRU, rate limit, logs.

The data is immutable per deployment, so every /v1 GET response is a pure
function of (data_version, canonical query). That gives two cheap wins
(ADR-0008): the **ETag is computed from the request alone** — a matching
``If-None-Match`` returns 304 before any work happens — and a small
**in-process LRU** keyed the same way serves repeat queries without
touching DuckDB. Rate limiting is a per-IP token bucket, per instance
(acceptable at Cloud Run max-2 instances, and documented as such).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from flourish_api.config import Settings

logger = logging.getLogger("flourish_api.access")

CACHE_CONTROL = "public, max-age=86400, stale-while-revalidate=604800"


def canonical_key(request: Request, data_version: str | None) -> str:
    query = "&".join(sorted(f"{k}={v}" for k, v in request.query_params.multi_items()))
    return f"{data_version or 'absent'}:{request.url.path}?{query}"


def etag_for(key: str) -> str:
    return '"' + hashlib.sha256(key.encode()).hexdigest()[:20] + '"'


@dataclass
class CachedResponse:
    body: bytes
    media_type: str
    headers: dict[str, str]


class ResponseCache:
    """A size-bounded LRU of successful /v1 response bodies."""

    def __init__(self, max_entries: int) -> None:
        self.max_entries = max_entries
        self._entries: OrderedDict[str, CachedResponse] = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> CachedResponse | None:
        entry = self._entries.get(key)
        if entry is None:
            self.misses += 1
            return None
        self._entries.move_to_end(key)
        self.hits += 1
        return entry

    def put(self, key: str, entry: CachedResponse) -> None:
        if self.max_entries <= 0:
            return
        self._entries[key] = entry
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)


class CacheMiddleware(BaseHTTPMiddleware):
    """ETag + Cache-Control + LRU for GET /v1/*."""

    def __init__(self, app: ASGIApp, cache: ResponseCache) -> None:
        super().__init__(app)
        self.cache = cache

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method != "GET" or not request.url.path.startswith("/v1"):
            return await call_next(request)
        store = request.app.state.store
        key = canonical_key(request, store.data_version)
        etag = etag_for(key)
        if etag in request.headers.get("if-none-match", ""):
            return Response(status_code=304, headers={"ETag": etag, "Cache-Control": CACHE_CONTROL})

        cached = self.cache.get(key)
        if cached is not None:
            headers = {
                **cached.headers,
                "ETag": etag,
                "Cache-Control": CACHE_CONTROL,
                "X-Cache": "hit",
            }
            return Response(content=cached.body, media_type=cached.media_type, headers=headers)

        response = await call_next(request)
        if response.status_code != 200:
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])  # type: ignore[attr-defined]
        media_type = response.headers.get("content-type", "application/json")
        passthrough = {
            k: v for k, v in response.headers.items() if k.lower() in ("content-disposition",)
        }
        self.cache.put(key, CachedResponse(body=body, media_type=media_type, headers=passthrough))
        headers = {**passthrough, "ETag": etag, "Cache-Control": CACHE_CONTROL, "X-Cache": "miss"}
        return Response(content=body, status_code=200, media_type=media_type, headers=headers)


class TokenBucket:
    def __init__(self, per_minute: int) -> None:
        self.capacity = float(per_minute)
        self.rate = per_minute / 60.0
        self._buckets: dict[str, tuple[float, float]] = {}  # key -> (tokens, stamp)

    def check(self, key: str, now: float | None = None) -> float:
        """0.0 when allowed (consumes a token) else seconds to wait."""
        now = time.monotonic() if now is None else now
        tokens, stamp = self._buckets.get(key, (self.capacity, now))
        tokens = min(self.capacity, tokens + (now - stamp) * self.rate)
        if tokens >= 1.0:
            self._buckets[key] = (tokens - 1.0, now)
            return 0.0
        self._buckets[key] = (tokens, now)
        return (1.0 - tokens) / self.rate

    def sweep(self, now: float | None = None) -> None:
        now = time.monotonic() if now is None else now
        if len(self._buckets) <= 4096:
            return
        self._buckets = {
            key: (tokens, stamp)
            for key, (tokens, stamp) in self._buckets.items()
            if now - stamp < 120.0
        }


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-IP token bucket on /v1 (prod only; per instance, ADR-0008)."""

    def __init__(self, app: ASGIApp, per_minute: int) -> None:
        super().__init__(app)
        self.bucket = TokenBucket(per_minute)

    @staticmethod
    def client_key(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            return forwarded.split(",")[0].strip()
        return request.client.host if request.client else "unknown"

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if not request.url.path.startswith("/v1"):
            return await call_next(request)
        wait = self.bucket.check(self.client_key(request))
        self.bucket.sweep()
        if wait > 0:
            return Response(
                content=json.dumps({"detail": "rate limit exceeded"}),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(math.ceil(wait))},
            )
        return await call_next(request)


class AccessLogMiddleware(BaseHTTPMiddleware):
    """One structured line per request (JSON in prod, terse in dev)."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        super().__init__(app)
        self.as_json = settings.env == "prod"

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        record = {
            "method": request.method,
            "path": request.url.path,
            "query": str(request.url.query),
            "status": response.status_code,
            "ms": round(elapsed_ms, 1),
            "cache": response.headers.get("x-cache"),
        }
        if self.as_json:
            logger.info(json.dumps(record, separators=(",", ":")))
        else:
            logger.info(
                "%s %s%s -> %s in %.1f ms%s",
                record["method"],
                record["path"],
                f"?{record['query']}" if record["query"] else "",
                record["status"],
                record["ms"],
                f" [{record['cache']}]" if record["cache"] else "",
            )
        return response


def install_middleware(app: FastAPI, settings: Settings) -> None:
    """Order (outermost first): access log → rate limit → cache/ETag."""
    app.add_middleware(CacheMiddleware, cache=ResponseCache(settings.cache_size))
    if settings.env == "prod" and settings.rate_limit_per_minute > 0:
        app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute)
    app.add_middleware(AccessLogMiddleware, settings=settings)


def init_sentry(settings: Settings) -> bool:
    """Initialise Sentry only when a DSN is configured (docs/SETUP.md)."""
    if not settings.sentry_dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.env, traces_sample_rate=0.0)
    return True
