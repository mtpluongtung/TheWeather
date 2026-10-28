import asyncio
import socket
import threading
import time
from pathlib import Path
import pytest
import uvicorn

from backend.config import settings
from backend.database import db
from backend.main import app
from backend.models import ProjectCreateRequest
from backend.api.routes import create_project
from backend.services.video_renderer import video_renderer_service, verify_mp4_file


def _get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.mark.asyncio
async def test_full_end_to_end_mp4_render_pipeline():
    """
    End-to-end verification of the complete pipeline:
    Real MapLibre GL JS frontend -> Real Open-Meteo Forecast -> Vietnamese Script ->
    Edge Neural TTS -> Synchronized Camera Timeline -> Playwright Chromium Capture ->
    FFmpeg H.264 + AAC MP4 encoding -> ffprobe validation.
    """
    port = _get_free_port()
    orig_port = settings.app_port
    orig_frontend_url = settings.frontend_url
    settings.app_port = port
    settings.frontend_url = f"http://127.0.0.1:{port}"

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    # Wait for server to listen
    for _ in range(30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                break
        await asyncio.sleep(0.2)

    try:
        proj_dict = await create_project(
            ProjectCreateRequest(
                name="Bản tin Kiểm thử E2E MP4",
                scope="custom_places",
                place_ids=["ha_noi", "da_nang"],
                target_duration_sec=20,
                aspect_ratio="16:9",
                resolution="720p",
                tone="concise",
                camera_style="cinematic_fly",
                enable_3d_terrain=False,
                enable_subtitles=True,
                enable_bgm=True,
            )
        )
        project_id = proj_dict["id"]

        # Keep only Intro + Ha Noi scenes (~12s) so E2E render test completes swiftly while testing real transitions
        short_scenes = proj_dict["scenes"][:2]
        proj_dict["scenes"] = short_scenes
        db.save_project(proj_dict)

        rendered_proj = await video_renderer_service.render_project_mp4(project_id)
        output_file = rendered_proj.get("output_file")
        assert output_file is not None

        mp4_path = settings.output_dir / output_file
        assert mp4_path.exists()
        meta = verify_mp4_file(mp4_path)
        assert meta["video_codec"] == "h264"
        assert meta["audio_codec"] == "aac"
        assert meta["width"] == 1280
        assert meta["height"] == 720
        assert meta["duration_sec"] >= 5.0
        assert meta["file_size_bytes"] > 50000
    finally:
        server.should_exit = True
        settings.app_port = orig_port
        settings.frontend_url = orig_frontend_url
