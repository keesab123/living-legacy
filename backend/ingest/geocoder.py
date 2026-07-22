from __future__ import annotations
import httpx
import pandas as pd
from pathlib import Path
from config import require

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json"


def geocode_address(address: str) -> tuple[float | None, float | None]:
    resp = httpx.get(
        GEOCODE_BASE,
        params={"address": f"{address}, Fremont, CA", "key": require("GOOGLE_API_KEY")},
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        return None, None
    loc = results[0]["geometry"]["location"]
    return loc["lat"], loc["lng"]


def geocode_dataframe(df: pd.DataFrame, address_col: str = "address") -> pd.DataFrame:
    """Add lat/lng columns to a DataFrame by geocoding the address column."""
    cache: dict[str, tuple] = {}

    def _geocode(addr: str):
        if pd.isna(addr):
            return None, None
        if addr not in cache:
            cache[addr] = geocode_address(addr)
        return cache[addr]

    df[["lat", "lng"]] = df[address_col].apply(lambda a: pd.Series(_geocode(a)))
    return df
