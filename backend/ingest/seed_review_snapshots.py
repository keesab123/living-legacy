"""
Seeds a synthetic prior-year review snapshot so the decline signal
has something to compare against on the first real pipeline run.

Simulates what review counts "would have been" ~1 year ago by inflating
current counts by a random factor. Businesses with lower current ratings
get inflated more (they've declined faster).
"""
import pandas as pd
import numpy as np
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

RAW_DIR = Path(__file__).parent.parent / "data" / "raw"
DB_PATH = Path(__file__).parent.parent / "data" / "snapshots.db"

PRIOR_DATE = (datetime.now() - timedelta(days=380)).date().isoformat()


def seed():
    places_file = RAW_DIR / "google_places_raw.csv"
    if not places_file.exists():
        raise FileNotFoundError("Run google_places.run() first to generate google_places_raw.csv")

    df = pd.read_csv(places_file)
    df = df[["name", "address", "user_ratings_total", "rating"]].dropna(subset=["user_ratings_total"])

    np.random.seed(42)

    # Businesses with lower ratings get a higher inflation factor (declined more)
    def inflation_factor(rating):
        if pd.isna(rating) or rating >= 4.5:
            return np.random.uniform(1.05, 1.15)
        elif rating >= 4.0:
            return np.random.uniform(1.1, 1.3)
        elif rating >= 3.5:
            return np.random.uniform(1.2, 1.5)
        else:
            return np.random.uniform(1.3, 1.8)

    df["inflation"] = df["rating"].apply(inflation_factor)
    df["review_count"] = (df["user_ratings_total"] * df["inflation"]).round().astype(int)

    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS review_snapshots (
            name        TEXT,
            address     TEXT,
            review_count INTEGER,
            rating      REAL,
            snapshot_date TEXT,
            PRIMARY KEY (name, address, snapshot_date)
        )
    """)

    inserted = 0
    for _, row in df.iterrows():
        con.execute(
            "INSERT OR REPLACE INTO review_snapshots VALUES (?, ?, ?, ?, ?)",
            (row["name"], row["address"], row["review_count"], row.get("rating"), PRIOR_DATE),
        )
        inserted += 1

    con.commit()
    con.close()
    print(f"Seeded {inserted} prior-year snapshots dated {PRIOR_DATE}")


if __name__ == "__main__":
    seed()
