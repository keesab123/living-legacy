# Small independent restaurants aren't individually reported to any public
# revenue/employment database, so there's no per-business figure to sum.
# These are national small-independent-restaurant averages (National
# Restaurant Association / industry benchmarks: ~$250K-$1M annual revenue,
# under 50 employees for independents) used only to give judges/officials a
# ballpark of what's at stake — not a precise measurement.
EST_ANNUAL_REVENUE_PER_RESTAURANT = 500_000
EST_JOBS_PER_RESTAURANT = 12


def estimate_impact(business_count: int) -> dict:
    return {
        "estimated_jobs_at_risk": business_count * EST_JOBS_PER_RESTAURANT,
        "estimated_annual_revenue_at_risk": business_count * EST_ANNUAL_REVENUE_PER_RESTAURANT,
    }
