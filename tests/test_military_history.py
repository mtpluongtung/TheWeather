import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db
from backend.models import BattleScenario, BattleTimelineStep
from backend.services.tts import tts_service, probe_audio_duration

client = TestClient(app)


def test_list_scenarios_and_builtin_data():
    resp = client.get("/api/scenarios")
    assert resp.status_code == 200
    data = resp.json()
    assert data["count"] >= 2
    scenarios = data["scenarios"]
    ids = [s["id"] for s in scenarios]
    assert "dien_bien_phu_1954" in ids
    assert "rach_gam_xoai_mut_1785" in ids


def test_get_dien_bien_phu_scenario_details():
    resp = client.get("/api/scenarios/dien_bien_phu_1954")
    assert resp.status_code == 200
    scenario = resp.json()

    # Validate high tactical structure
    assert scenario["id"] == "dien_bien_phu_1954"
    assert "ĐIỆN BIÊN PHỦ" in scenario["title"].upper()
    assert len(scenario["factions"]) == 2
    assert len(scenario["units"]) >= 10
    assert len(scenario["arrows"]) >= 5
    assert len(scenario["timeline_steps"]) >= 4

    # Validate Factions
    factions_map = {f["id"]: f for f in scenario["factions"]}
    assert "viet_minh" in factions_map
    assert "french_army" in factions_map
    assert "Võ Nguyên Giáp" in factions_map["viet_minh"]["commander"]
    assert "de Castries" in factions_map["french_army"]["commander"]
    assert factions_map["viet_minh"]["initial_manpower"] > 50000
    assert factions_map["french_army"]["initial_manpower"] > 15000

    # Validate Units
    unit_ids = [u["id"] for u in scenario["units"]]
    assert "unit_f312" in unit_ids
    assert "unit_beatrice" in unit_ids
    assert "unit_de_castries_hq" in unit_ids

    # Validate Coordinates in Dien Bien Phu valley
    for u in scenario["units"]:
        coords = u["coordinates"]
        assert 102.8 <= coords[0] <= 103.2
        assert 21.2 <= coords[1] <= 21.6


def test_get_rach_gam_xoai_mut_scenario():
    resp = client.get("/api/scenarios/rach_gam_xoai_mut_1785")
    assert resp.status_code == 200
    scenario = resp.json()
    assert "RẠCH GẦM - XOÀI MÚT" in scenario["title"]
    assert len(scenario["factions"]) == 2
    factions_map = {f["id"]: f for f in scenario["factions"]}
    assert "tay_son" in factions_map
    assert "siamese_allies" in factions_map
    assert "Nguyễn Huệ" in factions_map["tay_son"]["commander"]


@pytest.mark.asyncio
async def test_military_tts_audio_synthesis_and_duration(tmp_path):
    steps = [
        BattleTimelineStep(
            step_id="test_step_01",
            step_index=0,
            timestamp_label="13/03/1954",
            title="Him Lam Mở Màn",
            phase_name="Đợt 1",
            tactical_objective="Đột phá Him Lam",
            camera={
                "center": [103.045, 21.408],
                "zoom": 13.0,
                "pitch": 55.0,
                "bearing": -30.0,
            },
            start_time=0.0,
            end_time=5.0,
            duration_sec=5.0,
            narration_text="17 giờ ngày 13 tháng 3 năm 1954, trận quyết chiến lịch sử chính thức bắt đầu.",
        )
    ]

    tts_res = await tts_service.synthesize_scenario_steps(
        scenario_id="test_military_unit_run",
        steps=steps,
        voice_id="vi-VN-NamMinhNeural",
        enable_bgm=True,
    )

    assert tts_res["total_duration_sec"] > 2.0
    assert "master_audio_path" in tts_res
    assert "srt_path" in tts_res
    assert len(tts_res["subtitle_chunks"]) >= 1


def test_scenario_render_endpoint():
    # Test triggering render via API endpoint
    res = client.post(
        "/api/scenarios/rach_gam_xoai_mut_1785/render",
        json={"aspect_ratio": "16:9", "resolution": "720p", "fps": 30},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["scenario_id"] == "rach_gam_xoai_mut_1785"
    assert "progress" in data
    assert data["progress"]["status"] in ("preparing_audio", "syncing_timeline", "rendering_map", "completed")
