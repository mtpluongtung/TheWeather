import os
from pathlib import Path
from typing import Dict, Any
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    def __init__(self) -> None:
        self.app_host: str = os.getenv("APP_HOST", "127.0.0.1")
        self.app_port: int = int(os.getenv("APP_PORT", "8000"))
        self.frontend_url: str = os.getenv("FRONTEND_URL", "http://127.0.0.1:5173")

        db_rel = os.getenv("DATABASE_PATH", "backend/data/weathercast.db")
        self.database_path: Path = (BASE_DIR / db_rel).resolve()

        out_rel = os.getenv("OUTPUT_DIR", "backend/output")
        self.output_dir: Path = (BASE_DIR / out_rel).resolve()
        self.places_path: Path = (BASE_DIR / "backend/data/places.json").resolve()

        self.default_map_provider: str = os.getenv("DEFAULT_MAP_PROVIDER", "openfreemap_liberty")
        self.maptiler_api_key: str = os.getenv("MAPTILER_API_KEY", "").strip()
        self.enable_real_3d_terrain: bool = os.getenv("ENABLE_REAL_3D_TERRAIN", "true").lower() == "true"

        self.open_meteo_base_url: str = os.getenv(
            "OPEN_METEO_BASE_URL", "https://api.open-meteo.com/v1/forecast"
        )
        self.rainviewer_api_url: str = os.getenv(
            "RAINVIEWER_API_URL", "https://api.rainviewer.com/public/weather-maps.json"
        )
        self.nchmf_reference_url: str = os.getenv(
            "NCHMF_REFERENCE_URL", "https://www.nchmf.gov.vn/kttv/"
        )
        self.weather_api_timeout_sec: float = float(os.getenv("WEATHER_API_TIMEOUT_SEC", "15"))
        self.weather_api_max_retries: int = int(os.getenv("WEATHER_API_MAX_RETRIES", "3"))
        self.weather_cache_ttl_seconds: int = int(os.getenv("WEATHER_CACHE_TTL_SECONDS", "600"))

        self.llm_provider: str = os.getenv("LLM_PROVIDER", "none").strip().lower()
        self.llm_api_key: str = os.getenv("LLM_API_KEY", "").strip()
        self.llm_model: str = os.getenv("LLM_MODEL", "gemini-2.5-flash").strip()
        self.llm_base_url: str = os.getenv(
            "LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta"
        ).strip()

        self.default_tts_voice: str = os.getenv("DEFAULT_TTS_VOICE", "vi-VN-HoaiMyNeural")
        self.default_tts_rate: str = os.getenv("DEFAULT_TTS_RATE", "+0%")

        self.ffmpeg_binary: str = os.getenv("FFMPEG_BINARY", "ffmpeg")
        self.ffprobe_binary: str = os.getenv("FFPROBE_BINARY", "ffprobe")
        self.playwright_headless: bool = os.getenv("PLAYWRIGHT_HEADLESS", "true").lower() == "true"
        self.playwright_gl_backend: str = os.getenv("PLAYWRIGHT_GL_BACKEND", "d3d11")
        self.render_fps: int = int(os.getenv("RENDER_FPS", "30"))
        self.max_render_duration_sec: int = int(os.getenv("MAX_RENDER_DURATION_SEC", "180"))
        self.max_concurrent_renders: int = int(os.getenv("MAX_CONCURRENT_RENDERS", "1"))

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.database_path.parent.mkdir(parents=True, exist_ok=True)

    def get_map_providers_metadata(self) -> Dict[str, Any]:
        """Return real MapLibre-compatible tile/style providers without exposing raw keys in code."""
        providers = {
            "openfreemap_liberty": {
                "id": "openfreemap_liberty",
                "name": "OpenFreeMap Liberty (Vector 3D - Khuyên dùng)",
                "type": "vector",
                "style_url": "https://tiles.openfreemap.org/styles/liberty",
                "attribution": "© OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
                "requires_key": False,
                "available": True,
            },
            "openfreemap_bright": {
                "id": "openfreemap_bright",
                "name": "OpenFreeMap Bright (Vector Sáng)",
                "type": "vector",
                "style_url": "https://tiles.openfreemap.org/styles/bright",
                "attribution": "© OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
                "requires_key": False,
                "available": True,
            },
            "carto_dark": {
                "id": "carto_dark",
                "name": "Carto Dark Matter (Vector Studio Truyền Hình Tối)",
                "type": "vector",
                "style_url": "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                "attribution": "© OpenStreetMap contributors © CARTO",
                "requires_key": False,
                "available": True,
            },
            "carto_voyager": {
                "id": "carto_voyager",
                "name": "Carto Voyager (Vector Màu Địa Lý)",
                "type": "vector",
                "style_url": "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
                "attribution": "© OpenStreetMap contributors © CARTO",
                "requires_key": False,
                "available": True,
            },
            "osm_raster": {
                "id": "osm_raster",
                "name": "OpenStreetMap Standard (Raster Tiles)",
                "type": "raster",
                "tile_url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                "attribution": "© OpenStreetMap contributors",
                "requires_key": False,
                "available": True,
            },
            "maptiler_hybrid": {
                "id": "maptiler_hybrid",
                "name": "MapTiler Satellite Hybrid (Yêu cầu MAPTILER_API_KEY)",
                "type": "vector",
                "style_url": (
                    f"https://api.maptiler.com/maps/hybrid/style.json?key={self.maptiler_api_key}"
                    if self.maptiler_api_key
                    else None
                ),
                "attribution": "© MapTiler © OpenStreetMap contributors",
                "requires_key": True,
                "available": bool(self.maptiler_api_key),
            },
        }
        return {
            "default_provider": self.default_map_provider,
            "enable_real_3d_terrain": self.enable_real_3d_terrain,
            "terrain_dem_source": {
                "name": "AWS Open Data Terrain Tiles (Terrarium DEM)",
                "tiles": ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
                "encoding": "terrarium",
                "tileSize": 256,
                "maxzoom": 15,
                "attribution": "Terrain DEM © Mapzen / AWS Open Data Registry",
            },
            "providers": providers,
        }


settings = Settings()
