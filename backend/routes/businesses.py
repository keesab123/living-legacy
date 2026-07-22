from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from pathlib import Path
import pandas as pd
from scoring.risk_scorer import run as score_run

router = APIRouter()

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
SCORED_FILE = PROCESSED_DIR / "scored_businesses.csv"

RESOURCES = [
    {
        "name": "SBA Succession & Transition Planning",
        "org": "U.S. Small Business Administration",
        "url": "https://www.sba.gov/business-guide/manage-your-business/transfer-ownership",
        "description": "Federal guidance and loan programs for business ownership transitions.",
    },
    {
        "name": "SCORE Mentorship — Bay Area Chapter",
        "org": "SCORE",
        "url": "https://www.score.org/find-location/chapter/score-san-francisco-bay-area",
        "description": "Free mentorship from retired executives for small business owners planning exit strategies.",
    },
    {
        "name": "Alameda County Small Business Development Center",
        "org": "SBDC",
        "url": "https://www.eastbaysbdc.org",
        "description": "Free advising on business succession, valuation, and buyer matching for Alameda County businesses.",
    },
    {
        "name": "Fremont Chamber of Commerce",
        "org": "City of Fremont",
        "url": "https://www.fremontbusiness.com",
        "description": "Local network for connecting retiring owners with buyers and community investors.",
    },
    {
        "name": "California Office of the Small Business Advocate",
        "org": "State of California",
        "url": "https://calosba.ca.gov",
        "description": "State-level resources for immigrant-owned and underserved small businesses.",
    },
]


def load_scored() -> pd.DataFrame:
    if not SCORED_FILE.exists():
        raise HTTPException(status_code=503, detail="Scored data not yet generated. Run the ingestion pipeline first.")
    df = pd.read_csv(SCORED_FILE)
    # Replace NaN and inf with None for JSON compliance
    df = df.replace([float('inf'), float('-inf')], None)
    df = df.where(pd.notna(df), other=None)
    return df


class BusinessSummary(BaseModel):
    name: str
    address: str
    lat: Optional[float]
    lng: Optional[float]
    risk_score: float
    risk_tier: str


class BusinessDetail(BusinessSummary):
    years_in_operation: Optional[float]
    months_until_lease_expires: Optional[float]
    review_count_current: Optional[float]
    staleness_days: Optional[float]
    has_sba_loan: bool
    owner_occupied: Optional[bool]
    signal_years_in_operation: float
    signal_lease_expiry: float
    signal_review_decline: float
    signal_website_staleness: float
    signal_no_sba_enrollment: float
    signal_renting: float


class BusinessBrief(BaseModel):
    name: str
    address: str
    years_in_operation: Optional[float]
    risk_score: float
    risk_tier: str
    summary: str
    signals: dict
    resources: list[dict]


@router.get("/businesses", response_model=list[BusinessSummary])
def list_businesses(
    tier: Optional[str] = Query(None, description="Filter by risk tier: high, medium, low"),
    limit: int = Query(100, le=500),
):
    df = load_scored()
    if tier:
        df = df[df["risk_tier"] == tier]
    df = df.head(limit)
    records = df[["name", "address", "lat", "lng", "risk_score", "risk_tier"]].to_dict(orient="records")
    return [{k: (None if isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf')) else v) for k, v in r.items()} for r in records]


@router.get("/businesses/{name}/brief", response_model=BusinessBrief)
def get_business_brief(name: str):
    df = load_scored()
    match = df[df["name"].str.lower() == name.lower()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Business not found")

    row = match.iloc[0]
    years = row.get("years_in_operation")
    score = row.get("risk_score", 0)
    tier = row.get("risk_tier", "unknown")

    years_str = f"{years:.0f} years" if pd.notna(years) else "an unknown number of years"
    tier_str = {"high": "high succession risk", "medium": "moderate succession risk", "low": "low succession risk"}.get(tier, "unknown risk")

    summary = (
        f"{row['name']} is a {tier_str} business located at {row['address']} in Fremont, CA. "
        f"It has been in operation for {years_str} and received a succession risk score of {score:.0f}/100. "
        f"This score is based on structural signals including license age and SBA program enrollment, "
        f"and behavioral signals including online review trends and digital presence. "
        f"This business may benefit from proactive succession planning support."
    )

    signals = {
        "Years in operation": row.get("signal_years_in_operation"),
        "Lease expiry risk": row.get("signal_lease_expiry"),
        "Review decline": row.get("signal_review_decline"),
        "Website staleness": row.get("signal_website_staleness"),
        "No SBA enrollment": row.get("signal_no_sba_enrollment"),
        "Renting (not owner-occupied)": row.get("signal_renting"),
    }

    return {
        "name": row["name"],
        "address": row["address"],
        "years_in_operation": years if pd.notna(years) else None,
        "risk_score": score,
        "risk_tier": tier,
        "summary": summary,
        "signals": {k: round(float(v), 2) for k, v in signals.items() if pd.notna(v)},
        "resources": RESOURCES,
    }


@router.get("/businesses/{name}", response_model=BusinessDetail)
def get_business(name: str):
    df = load_scored()
    match = df[df["name"].str.lower() == name.lower()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Business not found")
    row = match.iloc[0].where(pd.notna(match.iloc[0]), other=None)
    return row.to_dict()


@router.get("/resources")
def get_resources():
    return RESOURCES


@router.post("/pipeline/run")
def run_pipeline():
    try:
        from ingest.merge import run as merge_run
        merged = merge_run()
        scored = score_run(merged)
        return {"status": "ok", "businesses_scored": len(scored)}
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
