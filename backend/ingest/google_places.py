import httpx
import pandas as pd
from pathlib import Path
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

FREMONT_LOCATION = "37.5485,-121.9886"
SEARCH_RADIUS_METERS = 15000


def search_restaurants() -> list[dict]:
    results = []
    url = f"{PLACES_BASE}/nearbysearch/json"
    params = {
        "location": FREMONT_LOCATION,
        "radius": SEARCH_RADIUS_METERS,
        "type": "restaurant",
        "key": require("GOOGLE_API_KEY"),
    }

    while True:
        resp = httpx.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("results", []))
        next_page = data.get("next_page_token")
        if not next_page:
            break
        params = {"pagetoken": next_page, "key": require("GOOGLE_API_KEY")}

    return results


def clean(records: list[dict]) -> pd.DataFrame:
    rows = []
    for r in records:
        rows.append({
            "place_id": r.get("place_id"),
            "name": r.get("name"),
            "address": r.get("vicinity"),
            "rating": r.get("rating"),
            "user_ratings_total": r.get("user_ratings_total"),
            "business_status": r.get("business_status"),
            "lat": r.get("geometry", {}).get("location", {}).get("lat"),
            "lng": r.get("geometry", {}).get("location", {}).get("lng"),
        })
    return pd.DataFrame(rows)


def run() -> pd.DataFrame:
    raw = search_restaurants()
    df = clean(raw)
    df.to_csv(RAW_DIR / "google_places_raw.csv", index=False)
    return df
