import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from .impact_estimate import estimate_impact

EARTH_RADIUS_METERS = 6_371_000
CLUSTER_RADIUS_METERS = 400  # ~a 5-minute walk — a corridor, not the whole city
MIN_BUSINESSES_PER_CLUSTER = 3


def find_risk_clusters(df: pd.DataFrame, tier: str = "high") -> list[dict]:
    """Geographic hotspots of at-risk businesses — a different unit of
    intervention than a flat ranked list. A city can fund one corridor-level
    program a lot more easily than triaging 100 individual businesses one
    at a time, so surfacing *where risk concentrates* matters as much as
    *which businesses* are at risk. Real spatial clustering (DBSCAN over
    haversine distance), not a grid heuristic — a cluster only forms where
    businesses are geographically close to each other, not just in the same
    zip code."""
    subset = df[(df["risk_tier"] == tier) & df["lat"].notna() & df["lng"].notna()].copy()
    if len(subset) < MIN_BUSINESSES_PER_CLUSTER:
        return []

    coords_rad = np.radians(subset[["lat", "lng"]].to_numpy())
    eps = CLUSTER_RADIUS_METERS / EARTH_RADIUS_METERS
    labels = DBSCAN(eps=eps, min_samples=MIN_BUSINESSES_PER_CLUSTER, metric="haversine").fit_predict(coords_rad)
    subset["cluster"] = labels

    clusters = []
    for label, group in subset[subset["cluster"] != -1].groupby("cluster"):
        clusters.append({
            "business_count": len(group),
            "centroid_lat": float(group["lat"].mean()),
            "centroid_lng": float(group["lng"].mean()),
            "avg_risk_score": round(float(group["risk_score"].mean()), 1),
            "businesses": [
                {"name": r["name"], "address": r["address"], "risk_score": r["risk_score"]}
                for _, r in group.sort_values("risk_score", ascending=False).iterrows()
            ],
            **estimate_impact(len(group)),
        })

    clusters.sort(key=lambda c: c["business_count"], reverse=True)
    return clusters
