from __future__ import annotations
import httpx
import pandas as pd
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json"


def geocode_address(address: str, retries: int = 3) -> tuple[float | None, float | None]:
    params = {"address": f"{address}, Fremont, CA", "key": require("GOOGLE_API_KEY")}
    for attempt in range(retries):
        try:
            resp = httpx.get(GEOCODE_BASE, params=params, timeout=15)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if not results:
                return None, None
            loc = results[0]["geometry"]["location"]
            return loc["lat"], loc["lng"]
        except httpx.HTTPError:
            if attempt == retries - 1:
                return None, None
    return None, None


def geocode_dataframe(df: pd.DataFrame, address_col: str = "address", max_workers: int = 16) -> pd.DataFrame:
    """Add lat/lng columns to a DataFrame by geocoding the address column."""
    unique_addrs = [a for a in df[address_col].unique() if pd.notna(a)]
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        results = list(ex.map(geocode_address, unique_addrs))
    cache = dict(zip(unique_addrs, results))

    df[["lat", "lng"]] = df[address_col].apply(
        lambda a: pd.Series(cache.get(a, (None, None)))
    )
    return df
