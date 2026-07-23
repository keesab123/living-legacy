from __future__ import annotations
import pandas as pd
from pathlib import Path
from config import require
from .http_utils import get_json, parallel_map

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json"


def geocode_address(address: str) -> tuple[float | None, float | None]:
    params = {"address": f"{address}, Fremont, CA", "key": require("GOOGLE_API_KEY")}
    results = get_json(GEOCODE_BASE, params).get("results", [])
    if not results:
        return None, None
    loc = results[0]["geometry"]["location"]
    return loc["lat"], loc["lng"]


def geocode_dataframe(df: pd.DataFrame, address_col: str = "address", max_workers: int = 16) -> pd.DataFrame:
    """Add lat/lng columns to a DataFrame by geocoding the address column."""
    unique_addrs = [a for a in df[address_col].unique() if pd.notna(a)]
    results = parallel_map(geocode_address, unique_addrs, max_workers=max_workers)
    cache = dict(zip(unique_addrs, results))

    df[["lat", "lng"]] = df[address_col].apply(
        lambda a: pd.Series(cache.get(a, (None, None)))
    )
    return df
