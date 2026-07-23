import pandas as pd
from pathlib import Path
from .scraper_fremont import run as scrape
from .chains import is_chain

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)


def fetch() -> pd.DataFrame:
    return scrape()


def clean(df: pd.DataFrame) -> pd.DataFrame:
    column_map = {
        "Business Name": "name",
        "Start Date": "license_issued",
        "Expire Date": "license_expires",
        "Address": "address",
        "Account #": "account_id",
    }
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})

    df["license_issued"] = pd.to_datetime(df["license_issued"], errors="coerce")
    df["license_expires"] = pd.to_datetime(df["license_expires"], errors="coerce")
    df["years_in_operation"] = (pd.Timestamp.now() - df["license_issued"]).dt.days / 365

    # Normalize address to match Google Places format (strip zip+4, uppercase)
    df["address"] = df["address"].str.replace(r"-\d{4}", "", regex=True).str.strip()

    return df


# NAICS codes for food service / restaurants
FOOD_NAICS = {
    "722110",  # full-service restaurants
    "722211",  # limited-service restaurants
    "722212",  # cafeterias
    "722213",  # snack and nonalcoholic beverage bars
    "722310",  # food service contractors
    "722320",  # caterers
    "722330",  # mobile food services
    "445110",  # grocery stores (immigrant-owned corner stores)
    "445210",  # meat markets
    "445230",  # fruit & vegetable markets
    "445290",  # specialty food stores
}


def filter_food_businesses(df: pd.DataFrame) -> pd.DataFrame:
    if "naics" not in df.columns:
        return df
    return df[df["naics"].astype(str).str[:6].isin(FOOD_NAICS)]


def run() -> pd.DataFrame:
    raw = fetch()
    raw.to_csv(RAW_DIR / "business_licenses_raw.csv", index=False)
    cleaned = clean(raw)

    # Remove chains
    cleaned = cleaned[~cleaned["name"].apply(is_chain)]

    # Remove catering/corporate/holding companies
    corporate_keywords = ["catering", "management co", "investments", "holdings", "enterprises llc", "ventures llc", ".com inc"]
    cleaned = cleaned[~cleaned["name"].str.lower().apply(
        lambda n: any(kw in n for kw in corporate_keywords)
    )]

    # Remove businesses open less than 2 years total (opened and closed quickly)
    cleaned = cleaned[cleaned["years_in_operation"] >= 2]

    # Fremont addresses only, no --ON FILE--
    cleaned = cleaned[
        cleaned["address"].str.contains("FREMONT", case=False, na=False) &
        ~cleaned["address"].str.contains("ON FILE", case=False, na=False)
    ]

    # Remove businesses open less than 5 years — young businesses are
    # unlikely near-term succession risks, and this keeps the dataset
    # focused on established businesses this product targets.
    cleaned = cleaned[cleaned["years_in_operation"] >= 5]

    # Deduplicate — keep most recent license per address+name combo
    cleaned = cleaned.sort_values("license_issued", ascending=False)
    cleaned = cleaned.drop_duplicates(subset=["name", "address"], keep="first")

    cleaned.to_csv(RAW_DIR / "business_licenses_clean.csv", index=False)
    print(f"Business licenses after filtering: {len(cleaned)}")
    return cleaned
