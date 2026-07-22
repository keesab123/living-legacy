import pandas as pd
from pathlib import Path
from . import business_licenses, property_records, sba_loans, google_places, website_staleness
from .geocoder import geocode_dataframe
from .review_snapshots import save_snapshot, get_prior_counts

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)


def run() -> pd.DataFrame:
    # Stream 1 — structural
    licenses = business_licenses.run()
    properties = property_records.run()
    loans = sba_loans.run()

    df = licenses.merge(properties, on="address", how="left", suffixes=("", "_prop"))
    loan_names = loans[["business_name", "has_sba_loan"]].drop_duplicates()
    df = df.merge(loan_names, left_on="name", right_on="business_name", how="left")
    df["has_sba_loan"] = df["has_sba_loan"].fillna(False)

    # Geocode Stream 1 addresses so they can appear on the map
    df = geocode_dataframe(df, address_col="address")

    # Stream 2 — behavioral
    places = google_places.run()
    staleness = website_staleness.run(places["place_id"].tolist())

    # Save review snapshot and compute YoY decline from Google Places data
    save_snapshot(places.rename(columns={"user_ratings_total": "review_count"}))
    prior_counts = get_prior_counts(places.rename(columns={"user_ratings_total": "review_count"}))
    places = places.rename(columns={"user_ratings_total": "review_count_current"})
    places = places.merge(prior_counts, on=["name", "address"], how="left")

    behavioral = places.merge(staleness, on="place_id", how="left")

    # Cross-validate: join Stream 1 + Stream 2 on business name + address
    full = df.merge(behavioral, on=["name", "address"], how="inner", suffixes=("", "_behavioral"))

    # Prefer geocoords from Stream 2 (Google Places) when Stream 1 geocoding missed
    full["lat"] = full["lat"].combine_first(full.get("lat_behavioral"))
    full["lng"] = full["lng"].combine_first(full.get("lng_behavioral"))
    full = full.drop(columns=["lat_behavioral", "lng_behavioral"], errors="ignore")

    full.to_csv(PROCESSED_DIR / "full_merged.csv", index=False)
    return full
