import pandas as pd
from pathlib import Path
from . import business_licenses, property_records, sba_loans, google_places, website_staleness
from .chains import is_chain
from .review_snapshots import save_snapshot, get_prior_counts
from .closure_check import filter_closed
from .matching import match_businesses

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

# Businesses confirmed closed on the ground even though Google Places still
# reports them OPERATIONAL (its status field lags real closures). Add a name
# here when a listing is verified defunct but survives the status filter below.
KNOWN_CLOSED = {
    "three stars restaurant",
    "habibi restaurant",
}


def run() -> pd.DataFrame:
    # Stream 1 — structural
    licenses = business_licenses.run()
    loans = sba_loans.run()

    try:
        properties = property_records.run()
    except NotImplementedError:
        # Property records source isn't wired up yet — degrade gracefully so the
        # rest of the pipeline still runs. lease_expiry/renting signals fall back
        # to neutral scores until this is implemented.
        properties = pd.DataFrame(columns=["address", "months_until_lease_expires", "owner_occupied"])

    df = licenses.merge(properties, on="address", how="left", suffixes=("", "_prop"))
    for col in ("months_until_lease_expires", "owner_occupied"):
        if col not in df.columns:
            df[col] = pd.NA
    loan_names = loans[["business_name", "has_sba_loan"]].drop_duplicates()
    df = df.merge(loan_names, left_on="name", right_on="business_name", how="left")
    df["has_sba_loan"] = df["has_sba_loan"].fillna(False)

    # Stream 2 — behavioral
    places = google_places.run()
    staleness = website_staleness.run(places["place_id"].tolist())

    # Save review snapshot and compute YoY decline from Google Places data
    save_snapshot(places.rename(columns={"user_ratings_total": "review_count"}))
    prior_counts = get_prior_counts(places.rename(columns={"user_ratings_total": "review_count"}))
    places = places.rename(columns={"user_ratings_total": "review_count_current"})
    places = places.merge(prior_counts, on=["name", "address"], how="left")

    # Both places (search result) and staleness (Place Details) report
    # business_status — Details is the fresher call, so prefer it.
    behavioral = places.merge(staleness, on="place_id", how="left", suffixes=("_search", ""))

    # Places is now the base population, so chains have to be filtered here
    # too — the license-stream chain filter only ever covered businesses that
    # also had a license match, and most Places-only rows never went through it.
    behavioral = behavioral[~behavioral["name"].apply(is_chain)]

    # The grid search radius bleeds past Fremont's border into Newark/Union
    # City at the edge tiles — keep this a Fremont-only list, same rule the
    # license stream already applies.
    behavioral = behavioral[behavioral["address"].str.contains("Fremont", case=False, na=False)]

    # Google Places is the base population — every restaurant it finds gets
    # scored. The license registry is enrichment, not a requirement: most
    # licensed 10+/5+-year-old "restaurants" turn out to be closed or
    # untraceable in Places, so requiring a match there was silently
    # shrinking the list to a fraction of what's actually open. Fuzzy-match
    # against it and fall back to neutral scoring signals where there's no
    # license record for a given place.
    full = match_businesses(behavioral, df, name_col="name", address_col="address", how="left")
    full["has_sba_loan"] = full["has_sba_loan"].fillna(False)

    # A place can match more than one historical license record at the same
    # address (a location renamed hands over the years) — keep the newest.
    full = full.sort_values("license_issued", ascending=False, na_position="last")
    full = full.drop_duplicates(subset=["place_id"], keep="first")

    # Drop businesses Google Places reports as closed — a stale or defunct
    # listing shouldn't show up as a live succession-risk candidate.
    full = full[full["business_status"].isin(["OPERATIONAL", None]) | full["business_status"].isna()]
    full = full[~full["name"].str.lower().isin(KNOWN_CLOSED)]

    # business_status lags real-world closures (it's stayed OPERATIONAL for
    # listings confirmed closed on the ground). A more reliable tell: once
    # Google purges a defunct listing, its place_id resolves back down to a
    # bare address instead of the business — so the freshly-fetched name no
    # longer matches what we searched for.
    full = full[
        full["confirmed_name"].isna() |
        (full["confirmed_name"].str.lower().str.strip() == full["name"].str.lower().str.strip())
    ]

    # Final pass: independently re-discover each survivor via a live text
    # search. Slower (one call per business) but catches closures the two
    # cheaper checks above miss.
    full = filter_closed(full)

    full.to_csv(PROCESSED_DIR / "full_merged.csv", index=False)
    return full
