import pandas as pd
from pathlib import Path

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

SBA_FILES = [
    RAW_DIR / "FOIA_7a_FY2010_FY2019_asof_260630.csv",
    RAW_DIR / "FOIA_7a_FY2020_Present_asof_260630.csv",
]


def fetch() -> pd.DataFrame:
    dfs = []
    for f in SBA_FILES:
        df = pd.read_csv(f, low_memory=False)
        dfs.append(df)
    combined = pd.concat(dfs, ignore_index=True)
    return combined[combined["BorrCity"].str.upper().str.strip() == "FREMONT"]


def clean(df: pd.DataFrame) -> pd.DataFrame:
    column_map = {
        "BorrName": "business_name",
        "BorrStreet": "address",
        "BorrCity": "city",
        "ApprovalDate": "loan_approved",
        "GrossApproval": "loan_amount",
        "SBAGuaranteedApproval": "sba_guaranteed",
        "LoanStatus": "loan_status",
        "ChargeOffDate": "charge_off_date",
    }
    df = df.rename(columns={k: v for k, v in column_map.items() if k in df.columns})

    if "loan_approved" in df.columns:
        df["loan_approved"] = pd.to_datetime(df["loan_approved"], errors="coerce")

    # Flag businesses that have accessed SBA programs
    df["has_sba_loan"] = True

    return df


def run() -> pd.DataFrame:
    raw = fetch()
    raw.to_csv(RAW_DIR / "sba_loans_raw.csv", index=False)
    cleaned = clean(raw)
    cleaned.to_csv(RAW_DIR / "sba_loans_clean.csv", index=False)
    return cleaned
