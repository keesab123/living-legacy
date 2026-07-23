from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import businesses

app = FastAPI(title="Handoff API")

app.add_middleware(
    CORSMiddleware,
    # Vite falls through to the next free port (5174, 5175, ...) whenever
    # 5173 is already taken by a stale dev server — a hardcoded single
    # origin here breaks the whole app with an opaque CORS error instead of
    # a clear "port in use" message.
    allow_origin_regex=r"http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(businesses.router, prefix="/api")
