from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import businesses

app = FastAPI(title="Living Legacy API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(businesses.router, prefix="/api")
