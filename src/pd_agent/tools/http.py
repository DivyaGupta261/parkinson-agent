"""One place for outgoing HTTP, with retries for temporary failures.

Public research APIs sometimes return 429 (slow down) or 5xx (temporarily
unavailable). Retrying with a growing pause usually succeeds; giving up on
the first blip would make the whole agent look broken.
"""

from __future__ import annotations

import time

import httpx

RETRY_STATUS = {429, 500, 502, 503, 504}
HEADERS = {"User-Agent": "pd-agent (educational research assistant)"}


def get(url: str, params: dict | None = None, timeout: float = 30, retries: int = 3) -> httpx.Response:
    """GET with retries. Non-retryable errors (404 etc.) are returned, not
    raised, so callers can treat "not found" as an answer."""
    for attempt in range(retries + 1):
        try:
            resp = httpx.get(url, params=params, timeout=timeout, headers=HEADERS)
            if resp.status_code not in RETRY_STATUS or attempt == retries:
                return resp
        except (httpx.TimeoutException, httpx.TransportError):
            if attempt == retries:
                raise
        time.sleep(1.5 * 2**attempt)  # 1.5s, 3s, 6s
    raise AssertionError("unreachable")
