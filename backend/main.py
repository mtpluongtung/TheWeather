import logging
import sys
from pathlib import Path

# Ensure root directory is in sys.path even when running 'python backend/main.py' directly
_ROOT_DIR = Path(__file__).resolve().parent.parent
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

# Fix for Windows: Ensure ProactorEventLoop is used so Playwright Chromium sub-processes work
# properly under Uvicorn even when running with `--reload`
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    import asyncio
    try:
        import uvicorn.loops.asyncio
        uvicorn.loops.asyncio.asyncio_loop_factory = lambda use_subprocess=False: asyncio.ProactorEventLoop
    except Exception:
        pass
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.api.routes import router as api_router
from backend.config import BASE_DIR, settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(
    title="WeatherCast Studio API",
    description=(
        "Hệ thống tạo video dự báo thời tiết Việt Nam tự động với bản đồ địa lý thật MapLibre GL JS, "
        "dữ liệu khí tượng Open-Meteo & tham chiếu NCHMF, lời dẫn tiếng Việt, giọng đọc Neural TTS "
        "và xuất video MP4 (Playwright Chromium + FFmpeg)."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

FRONTEND_DIST = BASE_DIR / "frontend" / "dist"
if (FRONTEND_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="frontend_assets")


@app.get("/", include_in_schema=False)
async def serve_spa_root():
    index_html = FRONTEND_DIST / "index.html"
    if index_html.exists():
        return FileResponse(str(index_html))
    return JSONResponse(
        {
            "app": "WeatherCast Studio Backend",
            "status": "running",
            "docs_url": "/docs",
            "frontend_dev_url": settings.frontend_url,
            "note": "Chạy frontend bằng 'npm run dev' trong thư mục frontend/ hoặc build bằng 'npm run build'.",
        }
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host=settings.app_host, port=settings.app_port, reload=False)
