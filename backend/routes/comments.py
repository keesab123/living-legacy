"""
Community comments — local, human intel a scrape can't pick up ("owner
mentioned retiring", "new sign went up") stored separately from the scored
CSV so it survives pipeline re-runs.
"""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

router = APIRouter()

DB_PATH = Path(__file__).parent.parent / "data" / "comments.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

MAX_COMMENT_LENGTH = 500


def _conn():
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS comments (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            business_name TEXT NOT NULL,
            author        TEXT,
            text          TEXT NOT NULL,
            created_at    TEXT NOT NULL
        )
    """)
    con.commit()
    return con


class CommentIn(BaseModel):
    business_name: str
    author: Optional[str] = Field(default=None, max_length=80)
    text: str = Field(min_length=1, max_length=MAX_COMMENT_LENGTH)


class Comment(BaseModel):
    id: int
    business_name: str
    author: Optional[str]
    text: str
    created_at: str


@router.get("/businesses/comments", response_model=list[Comment])
def list_comments(business_name: str = Query(...)):
    con = _conn()
    rows = con.execute(
        "SELECT id, business_name, author, text, created_at FROM comments "
        "WHERE business_name = ? ORDER BY created_at DESC",
        (business_name,),
    ).fetchall()
    con.close()
    return [
        {"id": r[0], "business_name": r[1], "author": r[2], "text": r[3], "created_at": r[4]}
        for r in rows
    ]


@router.post("/businesses/comments", response_model=Comment, status_code=201)
def create_comment(comment: CommentIn):
    text = comment.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Comment can't be empty")

    author = (comment.author or "").strip() or "Anonymous"
    created_at = datetime.now(timezone.utc).isoformat()

    con = _conn()
    cur = con.execute(
        "INSERT INTO comments (business_name, author, text, created_at) VALUES (?, ?, ?, ?)",
        (comment.business_name, author, text, created_at),
    )
    con.commit()
    new_id = cur.lastrowid
    con.close()

    return {
        "id": new_id,
        "business_name": comment.business_name,
        "author": author,
        "text": text,
        "created_at": created_at,
    }
