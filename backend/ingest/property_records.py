import httpx
import pandas as pd
from pathlib import Path

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

# TODO: replace with Alameda County Assessor endpoint or downloaded file
DATA_SOURCE = None  # e.g. Alameda County open data or a bulk CSV export


def fetch() -> pd.DataFrame:
    if DATA_SOURCE is None:
        raise NotImplementedError("Set DATA_SOURCE to the Alameda County property records endpoint or file path")

    if DATA_SOURCE.startswith("http"):
        response = httpx.get(DATA_SOURCE, params={"$limit": 50000})
        response.raise_for_status()
        df = pd.DataFrame(response.json())
    else:
        df = pd.read_csv(DATA_SOURCE)

    return df


def clean(df: pd.DataFrame) -> pd.DataFrame:
    # TODO: map actual column names from the source
    column_map = {
        "parcel_number": "parcel_id",
        "situs_address": "address",
        "owner_name": "owner",
        "lease_expiration": "lease_expires",
        "owner_occupied": "owner_occupied",
        "assessed_value": "assessed_value",
    }
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})

    if "lease_expires" in df.columns:
        df["lease_expires"] = pd.to_datetime(df["lease_expires"], errors="coerce")
        df["months_until_lease_expires"] = (
            (df["lease_expires"] - pd.Timestamp.now()).dt.days / 30
        ).clip(lower=0)

    return df


def run() -> pd.DataFrame:
    raw = fetch()
    raw.to_csv(RAW_DIR / "property_records_raw.csv", index=False)
    cleaned = clean(raw)
    cleaned.to_csv(RAW_DIR / "property_records_clean.csv", index=False)
    return cleaned
