import httpx
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from config import require

TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"


def _check_one(name: str, address: str) -> str:
    """Independently re-discover a business via a fresh text search rather than
    trusting our stored place_id — Google's business_status field lags real
    closures badly, but a business that's genuinely gone usually can't be
    found again by name+address at all, or comes back CLOSED_PERMANENTLY."""
    try:
        resp = httpx.get(
            TEXT_SEARCH_URL,
            params={"query": f"{name}, {address}", "key": require("GOOGLE_API_KEY")},
            timeout=15,
        )
        results = resp.json().get("results", [])
        if not results:
            return "NO_RESULTS"
        statuses = [r.get("business_status") for r in results[:3]]
        return "OPERATIONAL" if "OPERATIONAL" in statuses else (statuses[0] or "UNKNOWN")
    except Exception:
        return "UNKNOWN"


def filter_closed(df: pd.DataFrame, max_workers: int = 12) -> pd.DataFrame:
    """Drop rows that a live text search can no longer find, or reports as
    permanently closed. Runs one Text Search call per row — cheap in dollars
    (well under $0.01/business) but does real network I/O, so only run this
    over the full set periodically, not on every request."""
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        statuses = list(ex.map(lambda r: _check_one(r["name"], r["address"]), df.to_dict("records")))
    df = df.assign(_closure_status=statuses)
    kept = df[~df["_closure_status"].isin(["CLOSED_PERMANENTLY", "NO_RESULTS"])]
    return kept.drop(columns=["_closure_status"])
