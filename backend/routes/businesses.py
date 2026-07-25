from __future__ import annotations
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
import re
import httpx
import pandas as pd
from scoring.risk_scorer import run as score_run
from scoring.next_steps import SIGNAL_INFO
from scoring.impact_estimate import estimate_impact
from scoring.risk_clusters import find_risk_clusters
from config import require

router = APIRouter()

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"
SCORED_FILE = PROCESSED_DIR / "scored_businesses.csv"
PHOTO_CACHE_DIR = Path(__file__).parent.parent / "data" / "photo_cache"
PHOTO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

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
    cuisine_cohort: Optional[str] = None


class BusinessDetail(BusinessSummary):
    years_in_operation: Optional[float] = None
    months_until_lease_expires: Optional[float] = None
    review_count_current: Optional[float] = None
    staleness_days: Optional[float] = None
    has_sba_loan: bool = False
    owner_occupied: Optional[bool] = None
    signal_years_in_operation: float
    signal_lease_expiry: float
    signal_review_decline: float
    signal_website_staleness: float
    signal_no_sba_enrollment: float
    signal_renting: float
    next_step_city_econ_dev: Optional[str] = None
    next_step_community_org: Optional[str] = None
    next_step_buyer: Optional[str] = None
    next_step_owner: Optional[str] = None
    next_step_high_school_program: Optional[str] = None
    needs_digital_refresh: bool = False


class BusinessBrief(BaseModel):
    name: str
    address: str
    years_in_operation: Optional[float]
    risk_score: float
    risk_tier: str
    summary: str
    signals: dict
    resources: list[dict]
    next_steps: dict


@router.get("/businesses", response_model=list[BusinessSummary])
def list_businesses(
    tier: Optional[str] = Query(None, description="Filter by risk tier: high, medium, low"),
    limit: int = Query(100, le=1000),
):
    df = load_scored()
    if tier:
        df = df[df["risk_tier"] == tier]
    df = df.head(limit)
    records = df[["name", "address", "lat", "lng", "risk_score", "risk_tier", "cuisine_cohort"]].to_dict(orient="records")
    return [{k: (None if isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf')) else v) for k, v in r.items()} for r in records]


@router.get("/businesses/brief", response_model=BusinessBrief)
def get_business_brief(name: str):
    df = load_scored()
    match = df[df["name"].str.lower() == name.lower()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Business not found")

    row = match.iloc[0]
    years = row.get("years_in_operation")
    score = row.get("risk_score", 0)
    tier = row.get("risk_tier", "unknown")

    # round half-up (not Python's default banker's rounding) so this matches
    # the frontend's Math.round() exactly — otherwise a score like 44.5 could
    # read "44" here and "45" in the score badge
    score_rounded = int(score + 0.5)

    years_str = f"{years:.0f} years" if pd.notna(years) else "an unknown number of years"
    tier_str = {"high": "high succession risk", "medium": "moderate succession risk", "low": "low succession risk"}.get(tier, "unknown risk")

    summary = (
        f"{row['name']} is a {tier_str} business located at {row['address']} in Fremont, CA. "
        f"It has been in operation for {years_str} and received a succession risk score of {score_rounded}/100. "
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

    next_steps = {
        "For city economic development": row.get("next_step_city_econ_dev"),
        "For community organizations": row.get("next_step_community_org"),
        "For potential buyers": row.get("next_step_buyer"),
        "For the business owner": row.get("next_step_owner"),
        "High school volunteer opportunity": row.get("next_step_high_school_program"),
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
        "next_steps": {k: v for k, v in next_steps.items() if pd.notna(v)},
    }


@router.get("/businesses/detail", response_model=BusinessDetail)
def get_business(name: str):
    df = load_scored()
    match = df[df["name"].str.lower() == name.lower()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Business not found")
    row = match.iloc[0].where(pd.notna(match.iloc[0]), other=None)
    return row.to_dict()


@router.get("/businesses/photo")
def get_business_photo(name: str, width: int = Query(480, le=1600)):
    safe_name = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    cache_file = PHOTO_CACHE_DIR / f"{safe_name}_{width}.jpg"
    # cached on disk after the first fetch — every list re-render or repeat
    # visit would otherwise re-hit Google live, which is what made photos
    # feel slow/laggy
    if cache_file.exists():
        return FileResponse(cache_file, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800"})

    df = load_scored()
    match = df[df["name"].str.lower() == name.lower()]
    if match.empty:
        raise HTTPException(status_code=404, detail="Business not found")

    ref = match.iloc[0].get("photo_reference")
    if not ref:
        raise HTTPException(status_code=404, detail="No photo available for this business")

    # proxy through the backend so the Google API key never reaches the browser
    resp = httpx.get(
        "https://maps.googleapis.com/maps/api/place/photo",
        params={"maxwidth": width, "photo_reference": ref, "key": require("GOOGLE_API_KEY")},
        follow_redirects=True,
    )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not fetch photo")

    cache_file.write_bytes(resp.content)
    return Response(
        content=resp.content,
        media_type=resp.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=604800"},
    )


@router.get("/resources")
def get_resources():
    return RESOURCES


def _top_reason(row: pd.Series) -> str:
    elevated = [
        (col, row.get(col)) for col in SIGNAL_INFO
        if pd.notna(row.get(col)) and row.get(col) >= 0.5
    ]
    if not elevated:
        return "elevated overall succession risk"
    top_col = max(elevated, key=lambda c: c[1])[0]
    return SIGNAL_INFO[top_col]["label"]


@router.get("/top-at-risk")
def get_top_at_risk(limit: int = Query(10, le=25)):
    """A standalone, shareable ranked list — not the exploratory map, a
    single artifact meant to be screenshotted, printed, or handed to a
    reporter/council member: the businesses actually most at risk, right now."""
    df = load_scored()
    top = df.sort_values("risk_score", ascending=False).head(limit)
    return {
        "generated_at": pd.Timestamp.now().strftime("%B %d, %Y"),
        "businesses": [
            {
                "name": row["name"],
                "address": row["address"],
                "risk_score": row["risk_score"],
                "risk_tier": row["risk_tier"],
                "years_in_operation": row["years_in_operation"] if pd.notna(row.get("years_in_operation")) else None,
                "reason": _top_reason(row),
            }
            for _, row in top.iterrows()
        ],
    }


@router.get("/stats")
def get_stats():
    df = load_scored()
    high = df[df["risk_tier"] == "high"]
    return {
        "total_businesses": len(df),
        "high_risk_count": len(high),
        "medium_risk_count": len(df[df["risk_tier"] == "medium"]),
        "low_risk_count": len(df[df["risk_tier"] == "low"]),
        **estimate_impact(len(high)),
        "estimate_methodology": (
            "Jobs and revenue are estimated using national small-independent-restaurant "
            "averages (~$500K annual revenue, ~12 employees), not per-business reported "
            "figures, and are meant as an order-of-magnitude civic-impact indicator."
        ),
    }


@router.get("/cohorts")
def get_cohorts():
    """Risk grouped by community/cuisine lineage instead of geography — a
    different lens than the map. Fremont's immigrant-owned restaurant scene
    isn't evenly distributed risk; some communities are losing a much larger
    share of their businesses than others, and that's invisible in a flat
    citywide count. Cohort is inferred from name keywords
    (ingest/cuisine_cohorts.py) — a maintained heuristic, not ground truth."""
    df = load_scored()
    citywide_pct_high = round((df["risk_tier"] == "high").mean() * 100, 1)

    cohorts = []
    for cohort, group in df.groupby("cuisine_cohort"):
        high_count = int((group["risk_tier"] == "high").sum())
        cohorts.append({
            "cohort": cohort,
            "business_count": len(group),
            "high_risk_count": high_count,
            "medium_risk_count": int((group["risk_tier"] == "medium").sum()),
            "low_risk_count": int((group["risk_tier"] == "low").sum()),
            "pct_high_risk": round(high_count / len(group) * 100, 1),
            "avg_risk_score": round(float(group["risk_score"].mean()), 1),
            "small_sample": len(group) < 5,
            "businesses": [
                {"name": r["name"], "address": r["address"], "risk_score": r["risk_score"], "risk_tier": r["risk_tier"]}
                for _, r in group.sort_values("risk_score", ascending=False).iterrows()
            ],
        })

    cohorts.sort(key=lambda c: c["pct_high_risk"], reverse=True)
    return {"citywide_pct_high_risk": citywide_pct_high, "cohorts": cohorts}


@router.get("/risk-clusters")
def get_risk_clusters(tier: str = Query("high", description="Risk tier to cluster: high, medium, low")):
    """Geographic hotspots — corridors where multiple at-risk businesses
    cluster together, a higher-leverage unit of intervention than a flat
    per-business list. Computed with real spatial clustering (DBSCAN over
    haversine distance), not a heuristic."""
    df = load_scored()
    return {"tier": tier, "clusters": find_risk_clusters(df, tier=tier)}


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
