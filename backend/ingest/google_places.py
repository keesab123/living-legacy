import httpx
import pandas as pd
import time
from pathlib import Path
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

PLACES_BASE = "https://maps.googleapis.com/maps/api/place"

# Nearby Search hard-caps at 60 results (3 pages of 20) no matter the radius,
# and Fremont has far more restaurants than that within a single 15km search.
# Tile the city with smaller-radius searches instead of one big one so each
# tile stays under the cap, then dedupe by place_id.
SEARCH_RADIUS_METERS = 3000
GRID_CENTERS = [
    "37.5946,-121.9852",  # north Fremont / Irvington
    "37.5764,-121.9709",  # Mission San Jose
    "37.5622,-121.9855",  # Centerville
    "37.5485,-121.9886",  # downtown / Fremont Hub
    "37.5372,-121.9686",  # Warm Springs
    "37.5225,-121.9550",  # south Warm Springs / Tesla area
    "37.5580,-122.0180",  # Niles
    "37.5150,-121.9880",  # Ardenwood
]

# type=restaurant alone misses a lot of small immigrant-owned places Google
# tags under adjacent categories instead (a family diner as "cafe", a
# taqueria as "meal_takeaway"). Search all of them and dedupe by place_id.
PLACE_TYPES = ["restaurant", "cafe", "meal_takeaway", "bakery", "bar"]


def _fetch_page(url: str, params: dict) -> list[dict]:
    results = []
    while True:
        resp = httpx.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data.get("results", []))
        next_page = data.get("next_page_token")
        if not next_page:
            break
        # A freshly issued next_page_token isn't valid yet — Google needs a
        # short delay before it will honor it, otherwise it returns INVALID_REQUEST.
        time.sleep(2)
        params = {"pagetoken": next_page, "key": require("GOOGLE_API_KEY")}
    return results


def search_restaurants() -> list[dict]:
    url = f"{PLACES_BASE}/nearbysearch/json"
    by_place_id = {}

    for center in GRID_CENTERS:
        for place_type in PLACE_TYPES:
            params = {
                "location": center,
                "radius": SEARCH_RADIUS_METERS,
                "type": place_type,
                "key": require("GOOGLE_API_KEY"),
            }
            for r in _fetch_page(url, params):
                place_id = r.get("place_id")
                if place_id:
                    by_place_id[place_id] = r

    return list(by_place_id.values())


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
