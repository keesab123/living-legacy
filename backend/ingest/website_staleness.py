import httpx
import pandas as pd
from pathlib import Path
from datetime import datetime
from email.utils import parsedate_to_datetime
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

PLACES_BASE = "https://maps.googleapis.com/maps/api/place"


def get_place_details(place_id: str) -> dict:
    resp = httpx.get(
        f"{PLACES_BASE}/details/json",
        params={"place_id": place_id, "fields": "name,website,url,business_status", "key": require("GOOGLE_API_KEY")},
    )
    resp.raise_for_status()
    return resp.json().get("result", {})


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


def run(place_ids: list[str]) -> pd.DataFrame:
    """Pass place_ids from Google Places search results."""
    records = []
    for pid in place_ids:
        details = get_place_details(pid)
        website = details.get("website", "")
        staleness = check_website_staleness(website)
        records.append({
            "place_id": pid,
            "name": details.get("name"),
            "business_status": details.get("business_status"),
            **staleness,
        })
    df = pd.DataFrame(records)
    df.to_csv(RAW_DIR / "website_staleness_raw.csv", index=False)
    return df
