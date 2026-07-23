import pandas as pd
from pathlib import Path
from dataclasses import dataclass
from .next_steps import add_next_steps

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"


@dataclass
class Weights:
    years_in_operation: float = 0.25
    lease_expiry: float = 0.20
    review_decline: float = 0.20
    website_staleness: float = 0.15
    no_sba_enrollment: float = 0.10
    renting: float = 0.10


WEIGHTS = Weights()


def score_years_in_operation(years: float) -> float:
    """High risk threshold: 15+ years. Graduated within our 10-45yr range."""
    if pd.isna(years):
        return 0.3
    if years >= 40:
        return 1.0
    if years >= 30:
        return 0.85
    if years >= 25:
        return 0.70
    if years >= 20:
        return 0.50
    if years >= 15:
        return 0.30
    return 0.1


def score_lease_expiry(months_until_lease_expires: float) -> float:
    """High risk threshold: < 18 months until lease expires.
    Neutral default when property records aren't available for this business."""
    if pd.isna(months_until_lease_expires):
        return 0.3
    if months_until_lease_expires < 6:
        return 1.0
    if months_until_lease_expires < 12:
        return 0.85
    if months_until_lease_expires < 18:
        return 0.65
    if months_until_lease_expires < 36:
        return 0.3
    return 0.05


def score_review_decline(current_count: float, prior_count: float) -> float:
    """High risk threshold: > 30% YoY drop."""
    if pd.isna(current_count) or pd.isna(prior_count) or prior_count == 0:
        return 0.3
    decline_pct = (prior_count - current_count) / prior_count
    if decline_pct >= 0.30:
        return 1.0
    if decline_pct >= 0.15:
        return 0.6
    if decline_pct >= 0.05:
        return 0.3
    return 0.0


def score_website_staleness(staleness_days: float) -> float:
    """High risk threshold: last updated > 2 years ago. No/unreachable site treated as risky."""
    if pd.isna(staleness_days):
        return 0.8
    if staleness_days >= 730:
        return 1.0
    if staleness_days >= 365:
        return 0.65
    if staleness_days >= 180:
        return 0.35
    return 0.05


def score_no_sba_enrollment(has_sba_loan) -> float:
    """High risk: business has never accessed an SBA transition/loan program."""
    return 0.0 if bool(has_sba_loan) else 1.0


def score_renting(owner_occupied) -> float:
    """High risk: renting rather than owning the property.
    Neutral default when property records aren't available for this business."""
    if pd.isna(owner_occupied):
        return 0.3
    return 0.0 if bool(owner_occupied) else 1.0


def compute_score(row: pd.Series) -> dict:
    components = {
        "years_in_operation": score_years_in_operation(row.get("years_in_operation")),
        "lease_expiry": score_lease_expiry(row.get("months_until_lease_expires")),
        "review_decline": score_review_decline(row.get("review_count_current"), row.get("review_count_prior")),
        "website_staleness": score_website_staleness(row.get("staleness_days")),
        "no_sba_enrollment": score_no_sba_enrollment(row.get("has_sba_loan")),
        "renting": score_renting(row.get("owner_occupied")),
    }

    weighted_score = (
        components["years_in_operation"] * WEIGHTS.years_in_operation
        + components["lease_expiry"] * WEIGHTS.lease_expiry
        + components["review_decline"] * WEIGHTS.review_decline
        + components["website_staleness"] * WEIGHTS.website_staleness
        + components["no_sba_enrollment"] * WEIGHTS.no_sba_enrollment
        + components["renting"] * WEIGHTS.renting
    )

    return {
        "risk_score": round(weighted_score * 100, 1),
        # Thresholds calibrated against the actual score distribution rather
        # than picked arbitrarily: with most businesses missing lease/owner
        # data (property_records isn't wired up yet), scores cluster tightly
        # around two bands (~0.395 and ~0.445) with a real gap between them —
        # 0.42 sits in that gap and separates them cleanly.
        "risk_tier": "high" if weighted_score >= 0.42 else "medium" if weighted_score >= 0.32 else "low",
        "signal_years_in_operation": round(components["years_in_operation"], 2),
        "signal_lease_expiry": round(components["lease_expiry"], 2),
        "signal_review_decline": round(components["review_decline"], 2),
        "signal_website_staleness": round(components["website_staleness"], 2),
        "signal_no_sba_enrollment": round(components["no_sba_enrollment"], 2),
        "signal_renting": round(components["renting"], 2),
    }


def run(df: pd.DataFrame = None) -> pd.DataFrame:
    if df is None:
        df = pd.read_csv(PROCESSED_DIR / "full_merged.csv")

    scores = df.apply(compute_score, axis=1, result_type="expand")
    df = pd.concat([df, scores], axis=1)
    df = add_next_steps(df)
    df = df.sort_values("risk_score", ascending=False)

    df.to_csv(PROCESSED_DIR / "scored_businesses.csv", index=False)
    return df
