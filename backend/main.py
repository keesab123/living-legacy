from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from routes import businesses, comments
import traceback

app = FastAPI(title="Living Legacy API")

@app.get("/")
def health():
    return {"status": "ok"}

@app.middleware("http")
async def log_exceptions(request: Request, call_next):
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        print(f"EXCEPTION on {request.url.path}: {e}")
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={"detail": str(e)})

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
app.include_router(comments.router, prefix="/api")
