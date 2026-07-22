import os
from dotenv import load_dotenv

load_dotenv()


def require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val


YELP_API_KEY = os.getenv("YELP_API_KEY")
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")
