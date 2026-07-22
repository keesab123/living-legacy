"""
Stores periodic review count snapshots in SQLite so the scorer can
compute year-over-year decline without an external data warehouse.
"""
import sqlite3
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta

DB_PATH = Path(__file__).parent.parent / "data" / "snapshots.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


def _conn():
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
    con.commit()
    return con


def save_snapshot(df: pd.DataFrame):
    """Call this after each ingest run to record current review counts."""
    today = datetime.now().date().isoformat()
    con = _conn()
    for _, row in df.iterrows():
        con.execute(
            "INSERT OR REPLACE INTO review_snapshots VALUES (?, ?, ?, ?, ?)",
            (row.get("name"), row.get("address"), row.get("review_count"), row.get("rating"), today),
        )
    con.commit()
    con.close()


def get_prior_counts(df: pd.DataFrame, days_ago: int = 365) -> pd.DataFrame:
    """Return review counts from ~1 year ago to compute YoY decline."""
    cutoff = (datetime.now() - timedelta(days=days_ago)).date().isoformat()
    con = _conn()
    prior = pd.read_sql(
        """
        SELECT name, address, review_count as review_count_prior
        FROM review_snapshots
        WHERE snapshot_date <= ?
        ORDER BY snapshot_date DESC
        """,
        con,
        params=(cutoff,),
    )
    con.close()
    # Keep only the most recent snapshot before the cutoff per business
    prior = prior.drop_duplicates(subset=["name", "address"], keep="first")
    return prior
