"""
For each business license record, look it up on Google Places Find Place
to get lat/lng, review count, rating, and website URL.
Saves results incrementally so it can be resumed if interrupted.
"""
from __future__ import annotations
import httpx
import pandas as pd
import time
from pathlib import Path
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
ENRICHED_FILE = RAW_DIR / "licenses_enriched.csv"

FIND_PLACE_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"


def find_place(client: httpx.Client, name: str, address: str) -> dict:
    resp = client.get(FIND_PLACE_URL, params={
        "input": f"{name} {address} Fremont CA",
        "inputtype": "textquery",
        "fields": "place_id,name,geometry,rating,user_ratings_total",
        "key": require("GOOGLE_API_KEY"),
    })
    resp.raise_for_status()
    candidates = resp.json().get("candidates", [])
    if not candidates:
        return {}
    return candidates[0]


def get_website(client: httpx.Client, place_id: str) -> str | None:
    resp = client.get(DETAILS_URL, params={
        "place_id": place_id,
        "fields": "website",
        "key": require("GOOGLE_API_KEY"),
    })
    resp.raise_for_status()
    return resp.json().get("result", {}).get("website")


def run(df: pd.DataFrame = None) -> pd.DataFrame:
    if df is None:
        df = pd.read_csv(RAW_DIR / "business_licenses_clean.csv")

    # Resume from existing enriched file if present
    if ENRICHED_FILE.exists():
        done = pd.read_csv(ENRICHED_FILE)
        done_ids = set(done["account_id"].astype(str))
        remaining = df[~df["account_id"].astype(str).isin(done_ids)]
        print(f"Resuming: {len(done)} done, {len(remaining)} remaining")
    else:
        done = pd.DataFrame()
        remaining = df

    results = []
    with httpx.Client(timeout=10) as client:
        for i, (_, row) in enumerate(remaining.iterrows()):
            place = find_place(client, row["name"], row["address"])

            enriched = row.to_dict()
            if place:
                enriched["place_id"] = place.get("place_id")
                enriched["lat"] = place.get("geometry", {}).get("location", {}).get("lat")
                enriched["lng"] = place.get("geometry", {}).get("location", {}).get("lng")
                enriched["review_count_current"] = place.get("user_ratings_total")
                enriched["rating"] = place.get("rating")
                if place.get("place_id"):
                    enriched["website_url"] = get_website(client, place["place_id"])
                    time.sleep(0.05)
            else:
                enriched.update({"place_id": None, "lat": None, "lng": None,
                                  "review_count_current": None, "rating": None, "website_url": None})

            results.append(enriched)

            # Save every 50 records
            if (i + 1) % 50 == 0:
                batch = pd.DataFrame(results)
                combined = pd.concat([done, batch], ignore_index=True) if not done.empty else batch
                combined.to_csv(ENRICHED_FILE, index=False)
                print(f"  {i + 1}/{len(remaining)} enriched")
                results = []
                done = combined

            time.sleep(0.1)

    if results:
        batch = pd.DataFrame(results)
        combined = pd.concat([done, batch], ignore_index=True) if not done.empty else batch
        combined.to_csv(ENRICHED_FILE, index=False)

    print(f"Enrichment complete: {len(combined)} records")
    return combined
