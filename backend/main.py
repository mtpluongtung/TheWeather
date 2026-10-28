import logging
from pathlib import Path
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
