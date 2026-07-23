import httpx
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

T = TypeVar("T")


def get_json(url: str, params: dict, retries: int = 3, timeout: float = 15) -> dict:
    """GET a URL and return parsed JSON, retrying on transient HTTP errors.
    Returns {} if every attempt fails — callers treat a missing result as
    "unknown", not as a crash, since one flaky request shouldn't take down
    a multi-minute pipeline run."""
    for attempt in range(retries):
        try:
            resp = httpx.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError:
            if attempt == retries - 1:
                return {}
    return {}


def parallel_map(fn: Callable[..., T], items: list, max_workers: int = 16) -> list[T]:
    """Run fn over items concurrently — every network-bound loop in this
    package (geocoding, place details, closure re-checks) is I/O-bound, so
    fanning out with threads is a straightforward win over doing them serially."""
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        return list(ex.map(fn, items))
