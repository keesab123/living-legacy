import pandas as pd
from pathlib import Path
from dataclasses import dataclass

PROCESSED_DIR = Path(__file__).parent.parent / "data" / "processed"


@dataclass
class Weights:
    years_in_operation: float = 0.30
    review_activity: float = 0.25
    rating: float = 0.20
    website_staleness: float = 0.15
    review_decline: float = 0.10


WEIGHTS = Weights()


def score_years_in_operation(years: float) -> float:
    """More graduated within our 15-45yr range."""
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


def score_review_activity(review_count: float) -> float:
    """Low review count = low visibility = higher risk of closing unnoticed."""
    if pd.isna(review_count):
        return 0.7
    if review_count == 0:
        return 1.0
    if review_count < 20:
        return 0.85
    if review_count < 50:
        return 0.60
    if review_count < 150:
        return 0.35
    if review_count < 300:
        return 0.15
    return 0.0


def score_rating(rating: float) -> float:
    """Lower rating = struggling business = higher succession risk."""
    if pd.isna(rating):
        return 0.4
    if rating < 3.0:
        return 1.0
    if rating < 3.5:
        return 0.75
    if rating < 4.0:
        return 0.45
    if rating < 4.5:
        return 0.20
    return 0.05


def score_website_staleness(staleness_days: float) -> float:
    """No or stale website = disengaged owner."""
    if pd.isna(staleness_days):
        return 0.8
    if staleness_days >= 730:
        return 1.0
    if staleness_days >= 365:
        return 0.65
    if staleness_days >= 180:
        return 0.35
    return 0.05


def score_review_decline(current_count: float, prior_count: float) -> float:
    """YoY review count drop."""
    if pd.isna(current_count) or pd.isna(prior_count) or prior_count == 0:
        return 0.3
    decline_pct = (prior_count - current_count) / prior_count
    if decline_pct >= 0.4:
        return 1.0
    if decline_pct >= 0.2:
        return 0.65
    if decline_pct >= 0.05:
        return 0.30
    return 0.0


def compute_score(row: pd.Series) -> dict:
    components = {
        "years_in_operation": score_years_in_operation(row.get("years_in_operation")),
        "review_activity": score_review_activity(row.get("review_count_current")),
        "rating": score_rating(row.get("rating")),
        "website_staleness": score_website_staleness(row.get("staleness_days")),
        "review_decline": score_review_decline(row.get("review_count_current"), row.get("review_count_prior")),
    }

    weighted_score = (
        components["years_in_operation"] * WEIGHTS.years_in_operation
        + components["review_activity"] * WEIGHTS.review_activity
        + components["rating"] * WEIGHTS.rating
        + components["website_staleness"] * WEIGHTS.website_staleness
        + components["review_decline"] * WEIGHTS.review_decline
    )

    return {
        "risk_score": round(weighted_score * 100, 1),
        "risk_tier": "high" if weighted_score >= 0.55 else "medium" if weighted_score >= 0.30 else "low",
        **{f"signal_{k}": round(v, 2) for k, v in components.items()},
    }


def run(df: pd.DataFrame = None) -> pd.DataFrame:
    if df is None:
        df = pd.read_csv(PROCESSED_DIR / "full_merged.csv")

    scores = df.apply(compute_score, axis=1, result_type="expand")
    df = pd.concat([df, scores], axis=1)
    df = df.sort_values("risk_score", ascending=False)

    df.to_csv(PROCESSED_DIR / "scored_businesses.csv", index=False)
    return df
