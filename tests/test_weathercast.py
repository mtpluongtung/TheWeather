from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import ScriptGenerationRequest
from backend.services.camera_timeline import camera_timeline_service
from backend.services.script_generator import script_generator
from backend.services.tts import tts_service, probe_audio_duration
from backend.services.video_renderer import resolve_dimensions
from backend.services.weather import weather_service

client = TestClient(app)


def test_health_and_places_coordinates():
    """Verify system health endpoint and accurate WGS84 coordinates for Ha Noi, Bac Ninh, Da Nang, TP.HCM."""
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["components"]["ffmpeg_available"] is True
    assert data["components"]["ffprobe_available"] is True
    assert "openfreemap_liberty" in data["map_config"]["providers"]

    places_resp = client.get("/api/places")
    assert places_resp.status_code == 200
    p_data = places_resp.json()
    assert p_data["schema_version"] == "2025.2-VN-ADMIN"

    places_by_id = {p["id"]: p for p in p_data["places"]}
    for required_id in ("ha_noi", "bac_ninh", "da_nang", "tp_hcm", "hoang_sa", "truong_sa"):
        assert required_id in places_by_id, f"Missing required place {required_id}"

    # Verify real geographic coordinates (lat, lon)
    assert 20.9 <= places_by_id["ha_noi"]["lat"] <= 21.2
    assert 105.7 <= places_by_id["ha_noi"]["lon"] <= 106.0

    assert 21.0 <= places_by_id["bac_ninh"]["lat"] <= 21.3
    assert 105.9 <= places_by_id["bac_ninh"]["lon"] <= 106.3

    assert 15.9 <= places_by_id["da_nang"]["lat"] <= 16.2
    assert 108.0 <= places_by_id["da_nang"]["lon"] <= 108.4

    assert 10.6 <= places_by_id["tp_hcm"]["lat"] <= 10.9
    assert 106.5 <= places_by_id["tp_hcm"]["lon"] <= 106.9


def test_real_open_meteo_forecast_and_error_handling():
    """Verify real weather forecast retrieval from Open-Meteo API and proper error handling."""
    resp = client.get("/api/forecast?place=ha_noi,bac_ninh,da_nang,tp_hcm")
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["count"] == 4
    items = payload["items"]

    for item in items:
        assert item["temperature_c"] is not None
        assert -10.0 <= item["temperature_c"] <= 50.0
        assert item["temp_max_c"] is not None
        assert item["temp_min_c"] is not None
        assert item["source_name"].startswith("Open-Meteo")
        assert "nchmf.gov.vn" in item["reference_agency_url"]

    # Verify error handling when an invalid place is queried
    err_resp = client.get("/api/forecast?place=khong_ton_tai_xyz")
    assert err_resp.status_code == 404
    assert "Không tìm thấy địa điểm" in err_resp.json()["detail"]


@pytest.mark.asyncio
async def test_script_generator_uses_real_api_numbers():
    """Verify script generator embeds actual weather metrics from API and does not invent fake numbers."""
    forecasts = await weather_service.fetch_multiple_places(["ha_noi", "bac_ninh"])
    req = ScriptGenerationRequest(
        scope="custom_places",
        place_ids=["ha_noi", "bac_ninh"],
        target_duration_sec=45,
        tone="broadcast",
        weather_forecasts=forecasts,
    )
    res = await script_generator.generate_script(req)
    assert len(res.scenes) == 4  # Intro + Ha Noi + Bac Ninh + Outro

    hn_scene = res.scenes[1]
    hn_temp_int = str(int(round(forecasts[0].temperature_c)))
    assert "Hà Nội" in hn_scene.narration
    assert hn_temp_int in hn_scene.narration

    bn_scene = res.scenes[2]
    bn_temp_int = str(int(round(forecasts[1].temperature_c)))
    assert "Bắc Ninh" in bn_scene.narration
    assert bn_temp_int in bn_scene.narration


@pytest.mark.asyncio
async def test_tts_audio_generation_and_duration_probing(tmp_path: Path):
    """Verify Vietnamese TTS generates valid, audible audio and ffprobe extracts accurate duration."""
    out_mp3 = tmp_path / "test_vi_tts.mp3"
    audio_file, dur, engine = await tts_service.synthesize_scene_audio(
        text="Xin kính chào quý vị, tại Thủ đô Hà Nội nhiệt độ hiện tại là 27 độ C.",
        output_path=out_mp3,
        voice_id="vi-VN-HoaiMyNeural",
        rate="+0%",
    )
    assert audio_file.exists()
    assert audio_file.stat().st_size > 500
    assert dur > 1.5
    probed = probe_audio_duration(audio_file)
    assert probed > 1.0


@pytest.mark.asyncio
async def test_camera_timeline_and_aspect_ratios():
    """Verify camera timeline synchronization, frame interpolation, and 16:9 / 9:16 / 1:1 dimensions."""
    assert resolve_dimensions("16:9", "720p") == (1280, 720)
    assert resolve_dimensions("16:9", "1080p") == (1920, 1080)
    assert resolve_dimensions("9:16", "720p") == (720, 1280)
    assert resolve_dimensions("9:16", "1080p") == (1080, 1920)
    assert resolve_dimensions("1:1", "720p") == (720, 720)

    forecasts = await weather_service.fetch_multiple_places(["ha_noi", "da_nang", "tp_hcm"])
    script_res = await script_generator.generate_script(
        ScriptGenerationRequest(
            scope="custom_places",
            place_ids=["ha_noi", "da_nang", "tp_hcm"],
            weather_forecasts=forecasts,
        )
    )
    synced = camera_timeline_service.synchronize_scenes_timeline(script_res.scenes, "cinematic_fly")
    assert len(synced) == 5

    # Check camera arrives at Ha Noi in scene 1
    hn_scene = synced[1]
    mid_hn_time = (hn_scene.start_time + hn_scene.end_time) / 2.0
    cam_frame = camera_timeline_service.compute_camera_frame(synced, mid_hn_time, "cinematic_fly")
    assert cam_frame["scene_id"] == hn_scene.scene_id
    assert abs(cam_frame["center"][0] - 105.8542) < 0.05
    assert abs(cam_frame["center"][1] - 21.0285) < 0.05


def test_security_validation_and_download_guard():
    """Verify path traversal protection and download guard before render completion."""
    bad_resp = client.get("/api/projects/../../etc/passwd")
    assert bad_resp.status_code in (400, 404)

    # Create a quick project and verify download returns 409 before rendering completes
    create_resp = client.post(
        "/api/projects",
        json={
            "name": "Test Security Project",
            "scope": "custom_places",
            "place_ids": ["ha_noi"],
            "target_duration_sec": 20,
            "aspect_ratio": "16:9",
            "resolution": "720p",
        },
    )
    assert create_resp.status_code == 200
    pid = create_resp.json()["id"]

    dl_resp = client.get(f"/api/projects/{pid}/download")
    assert dl_resp.status_code == 409
