import httpx
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime
from email.utils import parsedate_to_datetime
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

PLACES_BASE = "https://maps.googleapis.com/maps/api/place"


def get_place_details(place_id: str, retries: int = 3) -> dict:
    params = {"place_id": place_id, "fields": "name,website,url,business_status", "key": require("GOOGLE_API_KEY")}
    for attempt in range(retries):
        try:
            resp = httpx.get(f"{PLACES_BASE}/details/json", params=params, timeout=15)
            resp.raise_for_status()
            return resp.json().get("result", {})
        except httpx.HTTPError:
            if attempt == retries - 1:
                return {}
    return {}


def check_website_staleness(url: str) -> dict:
    result = {"website_url": url, "website_reachable": False, "last_modified": None, "staleness_days": None}
    if not url:
        return result
    try:
        resp = httpx.head(url, timeout=5, follow_redirects=True)
        result["website_reachable"] = resp.status_code == 200
        last_mod = resp.headers.get("last-modified")
        if last_mod:
            dt = parsedate_to_datetime(last_mod)
            result["last_modified"] = dt.isoformat()
            result["staleness_days"] = (datetime.now(dt.tzinfo) - dt).days
    except Exception:
        pass
    return result


def _check_one(pid: str) -> dict:
    details = get_place_details(pid)
    website = details.get("website", "")
    staleness = check_website_staleness(website)
    return {
        "place_id": pid,
        # kept separate from the search-result "name" column so a stale
        # or delisted place (which Google resolves down to a bare
        # address once purged) can be detected by comparing the two
        "confirmed_name": details.get("name"),
        "business_status": details.get("business_status"),
        **staleness,
    }


def run(place_ids: list[str], max_workers: int = 16) -> pd.DataFrame:
    """Pass place_ids from Google Places search results. Each place_id needs
    one Place Details call plus one HEAD request to its website, both
    network-bound, so fan them out instead of doing them serially."""
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        records = list(ex.map(_check_one, place_ids))
    df = pd.DataFrame(records)
    df.to_csv(RAW_DIR / "website_staleness_raw.csv", index=False)
    return df
