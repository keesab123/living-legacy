import httpx
import pandas as pd
from pathlib import Path

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

# Alameda County Assessor parcel service (ArcGIS FeatureServer/MapServer query endpoint).
# Fill in with the verified layer URL, e.g.:
#   "https://<host>/arcgis/rest/services/<folder>/ParcelsAPNs/MapServer/0"
DATA_SOURCE = None

QUERY_PARAMS = {
    "where": "1=1",
    "outFields": "*",
    "f": "json",
}


def fetch() -> pd.DataFrame:
    if DATA_SOURCE is None:
        raise NotImplementedError("Set DATA_SOURCE to the Alameda County Assessor parcel layer URL")

    response = httpx.get(f"{DATA_SOURCE}/query", params=QUERY_PARAMS, timeout=60)
    response.raise_for_status()
    data = response.json()
    features = data.get("features", [])
    return pd.DataFrame([f["attributes"] for f in features])


def _normalize_address(series: pd.Series) -> pd.Series:
    return (
        series.astype(str)
        .str.upper()
        .str.replace(r"[.,]", "", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )


def clean(df: pd.DataFrame) -> pd.DataFrame:
    # TODO: confirm actual field names once DATA_SOURCE is wired up — these are
    # the typical names on county assessor parcel layers.
    column_map = {
        "APN": "parcel_id",
        "SITUS_ADDRESS": "address",
        "OWNER_NAME": "owner",
        "OWNER_ADDRESS": "owner_mailing_address",
        "ASSESSED_VALUE": "assessed_value",
    }
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})

    # Proxy for owner-occupied vs. rented: if the assessed owner's mailing
    # address matches the property (situs) address, the owner runs the
    # business out of a property they own. A mismatch means the parcel is
    # owned by someone else (a landlord) and the business is a tenant.
    # This is a proxy, not a direct signal — county rolls don't publish
    # private commercial lease terms, so lease_expires/months_until_lease_expires
    # stay unavailable from this source.
    if "address" in df.columns and "owner_mailing_address" in df.columns:
        situs_norm = _normalize_address(df["address"])
        owner_norm = _normalize_address(df["owner_mailing_address"])
        df["owner_occupied"] = situs_norm == owner_norm
    else:
        df["owner_occupied"] = pd.NA

    return df


def run() -> pd.DataFrame:
    raw = fetch()
    raw.to_csv(RAW_DIR / "property_records_raw.csv", index=False)
    cleaned = clean(raw)
    cleaned.to_csv(RAW_DIR / "property_records_clean.csv", index=False)
    return cleaned
