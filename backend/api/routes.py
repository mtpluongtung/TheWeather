import asyncio
import logging
import re
import shutil
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import FileResponse

from backend.config import settings
from backend.database import db
from backend.models import (
    ProjectCreateRequest,
    ProjectUpdateRequest,
    SceneItem,
    ScriptGenerationRequest,
    ScriptGenerationResponse,
    BattleScenario,
    ScenarioRenderRequest,
)
from backend.services.camera_timeline import camera_timeline_service
from backend.services.script_generator import script_generator
from backend.services.tts import AVAILABLE_VOICES
from backend.services.video_renderer import video_renderer_service
from backend.services.weather import weather_service

logger = logging.getLogger("weathercast.api")
router = APIRouter(prefix="/api", tags=["WeatherCast Studio API"])
VN_TZ = timezone(timedelta(hours=7))

SAFE_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{1,64}$")
SAFE_FILENAME_PATTERN = re.compile(r"^[a-zA-Z0-9_.-]{1,128}$")


def _validate_safe_id(val: str, field_name: str = "id") -> str:
    if not SAFE_ID_PATTERN.match(val):
        raise HTTPException(status_code=400, detail=f"Giá trị {field_name} không hợp lệ: '{val}'")
    return val


@router.get("/health", summary="Kiểm tra tình trạng hệ thống và các công cụ")
async def get_health() -> dict:
    ffmpeg_ok = shutil.which(settings.ffmpeg_binary) is not None
    ffprobe_ok = shutil.which(settings.ffprobe_binary) is not None
    catalog = weather_service.load_places_catalog()
    return {
        "status": "ok" if (ffmpeg_ok and ffprobe_ok) else "degraded",
        "timestamp": datetime.now(VN_TZ).isoformat(timespec="seconds"),
        "timezone": "Asia/Ho_Chi_Minh (UTC+7)",
        "components": {
            "ffmpeg_available": ffmpeg_ok,
            "ffprobe_available": ffprobe_ok,
            "sqlite_db": str(settings.database_path.name),
            "places_count": len(catalog.get("places", [])),
            "admin_schema_version": catalog.get("schema_version"),
            "llm_provider": settings.llm_provider,
            "llm_configured": bool(settings.llm_api_key and settings.llm_provider != "none"),
        },
        "map_config": settings.get_map_providers_metadata(),
        "voices": AVAILABLE_VOICES,
        "weather_sources": {
            "primary_forecast": {
                "name": "Open-Meteo Forecast API",
                "url": settings.open_meteo_base_url,
                "type": "Numerical Weather Prediction Model",
            },
            "official_warning_reference": {
                "name": "Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (NCHMF)",
                "url": settings.nchmf_reference_url,
                "type": "Cơ quan khí tượng chính thức Việt Nam",
            },
            "radar_overlay": {
                "name": "RainViewer Global Weather Radar API",
                "url": settings.rainviewer_api_url,
                "type": "Real-time Radar & Infrared Satellite Tiles",
            },
        },
    }


@router.get("/places", summary="Danh sách địa điểm, tọa độ thực và camera presets")
async def get_places(region: Optional[str] = Query(default=None, description="Lọc theo vùng: north, central, highlands, south")) -> dict:
    catalog = weather_service.load_places_catalog()
    places = catalog.get("places", [])
    if region and region != "all":
        places = [p for p in places if p.get("region") == region]
    return {
        "schema_version": catalog.get("schema_version"),
        "last_updated": catalog.get("last_updated"),
        "source_reference": catalog.get("source_reference"),
        "admin_note": catalog.get("admin_note"),
        "camera_presets": catalog.get("camera_presets", []),
        "places": places,
    }


@router.get("/boundaries", summary="Ranh giới địa lý hành chính Việt Nam (GeoJSON Polygon thực tế để highlight vùng)")
async def get_boundaries() -> dict:
    return weather_service.load_admin_boundaries()


@router.get("/forecast", summary="Lấy dữ liệu dự báo thời tiết thực tế từ Open-Meteo")
async def get_forecast(
    place: str = Query(
        default="ha_noi",
        description="Mã địa điểm (ví dụ: ha_noi, bac_ninh, da_nang, tp_hcm) hoặc danh sách phân cách bằng dấu phẩy",
    ),
    date: Optional[str] = Query(default=None, description="Ngày dự báo định dạng YYYY-MM-DD (tối đa 7 ngày tới)"),
    refresh: bool = Query(default=False, description="Bỏ qua bộ nhớ đệm để lấy dữ liệu mới nhất"),
) -> dict:
    raw_ids = [p.strip() for p in place.split(",") if p.strip()]
    if not raw_ids:
        raise HTTPException(status_code=400, detail="Vui lòng cung cấp ít nhất một mã địa điểm (tham số 'place').")
    if len(raw_ids) > 20:
        raise HTTPException(status_code=400, detail="Tối đa 20 địa điểm trong một lần truy vấn.")

    for pid in raw_ids:
        _validate_safe_id(pid, "place")
        if not weather_service.get_place_by_id(pid):
            raise HTTPException(status_code=404, detail=f"Không tìm thấy địa điểm '{pid}' trong danh mục.")

    try:
        items = await weather_service.fetch_multiple_places(
            place_ids=raw_ids,
            forecast_date=date,
            force_refresh=refresh,
        )
        return {
            "count": len(items),
            "fetched_at": datetime.now(VN_TZ).isoformat(timespec="seconds"),
            "timezone": "Asia/Ho_Chi_Minh",
            "source": "Open-Meteo Forecast API",
            "official_reference_url": settings.nchmf_reference_url,
            "items": [it.model_dump() for it in items],
        }
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as exc:
        logger.error("Lỗi lấy dữ liệu thời tiết: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Không thể kết nối tới API thời tiết thực tế (Open-Meteo): {exc}",
        )


@router.get("/radar", summary="Lấy lớp bản đồ Radar mưa và Mây vệ tinh thực tế từ RainViewer")
async def get_radar_tiles() -> dict:
    return await weather_service.fetch_rainviewer_metadata()


@router.post("/script", response_model=ScriptGenerationResponse, summary="Sinh kịch bản lời dẫn tiếng Việt từ dữ liệu thời tiết thực tế")
async def create_script(req: ScriptGenerationRequest) -> ScriptGenerationResponse:
    try:
        return await script_generator.generate_script(req)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as exc:
        logger.exception("Lỗi sinh kịch bản")
        raise HTTPException(status_code=502, detail=f"Lỗi khi tạo kịch bản từ dữ liệu thời tiết: {exc}")


@router.post("/projects", summary="Tạo dự án video thời tiết mới")
async def create_project(req: ProjectCreateRequest) -> dict:
    project_id = uuid.uuid4().hex[:12]
    today_str = datetime.now(VN_TZ).strftime("%Y-%m-%d")
    forecast_date = req.forecast_date or today_str

    try:
        if req.scenes and len(req.scenes) > 0:
            scenes = camera_timeline_service.synchronize_scenes_timeline(req.scenes, req.camera_style)
        else:
            script_res = await script_generator.generate_script(
                ScriptGenerationRequest(
                    scope=req.scope,
                    place_ids=req.place_ids,
                    forecast_date=forecast_date,
                    target_duration_sec=req.target_duration_sec,
                    tone=req.tone,
                    camera_style=req.camera_style,
                )
            )
            scenes = camera_timeline_service.synchronize_scenes_timeline(script_res.scenes, req.camera_style)
    except Exception as exc:
        logger.exception("Lỗi khởi tạo dự án")
        raise HTTPException(status_code=502, detail=f"Không thể khởi tạo dự án do lỗi nguồn dữ liệu thời tiết: {exc}")

    total_dur = scenes[-1].end_time if scenes else float(req.target_duration_sec)
    project_data = {
        "id": project_id,
        "name": req.name,
        "scope": req.scope,
        "place_ids": req.place_ids,
        "forecast_date": forecast_date,
        "target_duration_sec": req.target_duration_sec,
        "total_duration_sec": round(total_dur, 2),
        "aspect_ratio": req.aspect_ratio,
        "resolution": req.resolution,
        "fps": req.fps,
        "voice_id": req.voice_id,
        "voice_rate": req.voice_rate,
        "tone": req.tone,
        "camera_style": req.camera_style,
        "map_provider": req.map_provider,
        "enable_3d_terrain": req.enable_3d_terrain,
        "enable_subtitles": req.enable_subtitles,
        "enable_bgm": req.enable_bgm,
        "scenes": [s.model_dump() for s in scenes],
        "progress": {
            "project_id": project_id,
            "status": "idle",
            "progress_pct": 0.0,
            "current_step": "Dự án đã khởi tạo. Sẵn sàng xem trước hoặc render MP4.",
            "frames_rendered": 0,
            "total_frames": 0,
            "output_file": None,
            "download_url": None,
        },
        "output_file": None,
    }
    return db.save_project(project_data)


@router.get("/projects", summary="Danh sách các dự án gần đây")
async def list_projects() -> dict:
    items = db.list_projects(limit=20)
    return {"count": len(items), "projects": items}


@router.get("/projects/{project_id}", summary="Xem chi tiết dự án và danh sách phân cảnh")
async def get_project(project_id: str) -> dict:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")
    return proj


@router.put("/projects/{project_id}", summary="Cập nhật cấu hình dự án hoặc chỉnh sửa lời dẫn thủ công")
async def update_project(project_id: str, req: ProjectUpdateRequest) -> dict:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")

    update_dict = req.model_dump(exclude_unset=True)
    for k, v in update_dict.items():
        if k == "scenes" and v is not None:
            scene_objs = [SceneItem(**s) if isinstance(s, dict) else s for s in v]
            for s in scene_objs:
                s.subtitle = s.narration
            synced = camera_timeline_service.synchronize_scenes_timeline(
                scene_objs,
                update_dict.get("camera_style") or proj.get("camera_style", "cinematic_fly"),
            )
            proj["scenes"] = [s.model_dump() for s in synced]
            if synced:
                proj["total_duration_sec"] = synced[-1].end_time
        else:
            proj[k] = v

    return db.save_project(proj)


@router.post("/projects/{project_id}/preview", summary="Tạo TTS thật và đồng bộ hóa timeline camera cho bản xem trước")
async def preview_project(project_id: str) -> dict:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")
    try:
        updated_proj = await video_renderer_service.prepare_preview_timeline(project_id)
        return updated_proj
    except Exception as exc:
        logger.exception("Lỗi tạo bản xem trước cho dự án %s", project_id)
        raise HTTPException(status_code=500, detail=f"Lỗi khi tạo âm thanh xem trước: {exc}")


@router.post("/projects/{project_id}/render", summary="Bắt đầu tiến trình ghi hình bản đồ MapLibre 3D và xuất video MP4")
async def start_render_project(project_id: str, background_tasks: BackgroundTasks) -> dict:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")

    if video_renderer_service.is_rendering(project_id):
        return {
            "message": "Dự án đang được render. Vui lòng theo dõi tiến độ.",
            "project_id": project_id,
            "progress": proj.get("progress"),
        }

    video_renderer_service._update_state(
        project_id,
        status="preparing_audio",
        progress_pct=3.0,
        step_msg="Đã đưa vào hàng đợi render. Đang khởi tạo giọng đọc tiếng Việt...",
    )

    async def _bg_job() -> None:
        try:
            await video_renderer_service.render_project_mp4(project_id)
        except Exception as e:
            logger.error("Background render task failed for %s: %s", project_id, e)

    background_tasks.add_task(_bg_job)
    updated = db.get_project(project_id)
    return {
        "message": "Đã bắt đầu tiến trình render video MP4.",
        "project_id": project_id,
        "progress": updated.get("progress") if updated else None,
    }


@router.get("/projects/{project_id}/progress", summary="Theo dõi tiến độ render video MP4")
async def get_render_progress(project_id: str) -> dict:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")
    return proj.get("progress", {"project_id": project_id, "status": "idle", "progress_pct": 0.0})


@router.get("/projects/{project_id}/download", summary="Tải xuống file video MP4 đã render hoàn chỉnh")
async def download_project_mp4(project_id: str) -> FileResponse:
    _validate_safe_id(project_id, "project_id")
    proj = db.get_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy dự án '{project_id}'")

    output_file = proj.get("output_file") or proj.get("progress", {}).get("output_file")
    if not output_file:
        raise HTTPException(
            status_code=409,
            detail="Dự án chưa được render hoặc quá trình render MP4 chưa hoàn tất.",
        )

    if not SAFE_FILENAME_PATTERN.match(output_file):
        raise HTTPException(status_code=400, detail="Tên file đầu ra không hợp lệ.")

    file_path = (settings.output_dir / output_file).resolve()
    if settings.output_dir.resolve() not in file_path.parents or not file_path.exists():
        raise HTTPException(status_code=404, detail="File MP4 không tồn tại trên máy chủ.")

    if file_path.stat().st_size < 1024:
        raise HTTPException(status_code=500, detail="File MP4 bị lỗi hoặc rỗng.")

    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=output_file,
    )


@router.get("/projects/{project_id}/media/{filename}", summary="Phát file âm thanh TTS hoặc phụ đề SRT của dự án")
async def get_project_media_file(project_id: str, filename: str) -> FileResponse:
    _validate_safe_id(project_id, "project_id")
    if not SAFE_FILENAME_PATTERN.match(filename):
        raise HTTPException(status_code=400, detail="Tên file media không hợp lệ.")

    project_dir = (settings.output_dir / f"project_{project_id}").resolve()
    target_path = (project_dir / filename).resolve()
    if project_dir not in target_path.parents or not target_path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy file media.")

    suffix = target_path.suffix.lower()
    media_type = "audio/wav"
    if suffix == ".mp3":
        media_type = "audio/mpeg"
    elif suffix == ".srt":
        media_type = "text/plain; charset=utf-8"

    return FileResponse(path=str(target_path), media_type=media_type, filename=filename)


# ==========================================
# ⚔️ MILITARY HISTORY MAP SCENARIO ENDPOINTS
# ==========================================

@router.get("/scenarios", summary="Danh sách các kịch bản trận đánh lịch sử")
async def list_battle_scenarios() -> dict:
    scenarios = db.list_scenarios()
    return {
        "count": len(scenarios),
        "scenarios": scenarios,
    }


@router.get("/scenarios/{scenario_id}", summary="Lấy chi tiết kịch bản trận đánh (đơn vị, mũi tên, thời gian, camera)")
async def get_battle_scenario(scenario_id: str) -> dict:
    _validate_safe_id(scenario_id, "scenario_id")
    scenario = db.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy kịch bản trận đánh '{scenario_id}'")
    return scenario


@router.post("/scenarios", summary="Lưu hoặc tạo mới kịch bản trận đánh")
async def create_or_save_scenario(scenario: BattleScenario) -> dict:
    saved = db.save_scenario(scenario.model_dump())
    return {
        "message": f"Đã lưu kịch bản trận đánh '{saved['title']}' thành công.",
        "scenario_id": saved["id"],
        "scenario": saved,
    }


@router.put("/scenarios/{scenario_id}", summary="Cập nhật kịch bản trận đánh")
async def update_battle_scenario(scenario_id: str, scenario: BattleScenario) -> dict:
    _validate_safe_id(scenario_id, "scenario_id")
    data = scenario.model_dump()
    data["id"] = scenario_id
    saved = db.save_scenario(data)
    return {
        "message": f"Đã cập nhật kịch bản '{saved['title']}' thành công.",
        "scenario_id": scenario_id,
        "scenario": saved,
    }


@router.post("/scenarios/{scenario_id}/render", summary="Bắt đầu render video MP4 diễn biến trận đánh")
async def start_scenario_render(
    scenario_id: str,
    background_tasks: BackgroundTasks,
    render_req: Optional[ScenarioRenderRequest] = None,
) -> dict:
    _validate_safe_id(scenario_id, "scenario_id")
    scenario = db.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy kịch bản '{scenario_id}'")

    req = render_req or ScenarioRenderRequest()
    if video_renderer_service.is_rendering(f"scenario_{scenario_id}"):
        raise HTTPException(status_code=409, detail="Kịch bản này đang được render trong một tiến trình khác.")

    db.update_scenario_progress(
        scenario_id,
        {
            "scenario_id": scenario_id,
            "status": "preparing_audio",
            "progress_pct": 5.0,
            "current_step": "Đang chuẩn bị tổng hợp thuyết minh & góc quay sa bàn 3D...",
            "frames_rendered": 0,
            "total_frames": 0,
        },
    )

    async def _bg_scenario_job() -> None:
        try:
            await video_renderer_service.render_scenario_mp4(scenario_id, req)
        except Exception as e:
            logger.error("Background render scenario failed for %s: %s", scenario_id, e)

    background_tasks.add_task(_bg_scenario_job)
    return {
        "message": "Đã bắt đầu tiến trình render video sa bàn quân sự MP4.",
        "scenario_id": scenario_id,
        "progress": db.get_scenario_progress(scenario_id),
    }


@router.get("/scenarios/{scenario_id}/progress", summary="Theo dõi tiến độ render video sa bàn quân sự")
async def get_scenario_render_progress(scenario_id: str) -> dict:
    _validate_safe_id(scenario_id, "scenario_id")
    return db.get_scenario_progress(scenario_id)


@router.get("/scenarios/{scenario_id}/download", summary="Tải xuống file video MP4 sa bàn lịch sử")
async def download_scenario_mp4(scenario_id: str) -> FileResponse:
    _validate_safe_id(scenario_id, "scenario_id")
    scenario = db.get_scenario(scenario_id)
    if not scenario:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy kịch bản '{scenario_id}'")

    prog = db.get_scenario_progress(scenario_id)
    output_file = scenario.get("output_file") or prog.get("output_file")
    if not output_file:
        raise HTTPException(
            status_code=409,
            detail="Kịch bản chưa được render hoặc quá trình render MP4 chưa hoàn tất.",
        )

    if not SAFE_FILENAME_PATTERN.match(output_file):
        raise HTTPException(status_code=400, detail="Tên file đầu ra không hợp lệ.")

    file_path = (settings.output_dir / output_file).resolve()
    if settings.output_dir.resolve() not in file_path.parents or not file_path.exists():
        raise HTTPException(status_code=404, detail="File MP4 không tồn tại trên máy chủ.")

    if file_path.stat().st_size < 1024:
        raise HTTPException(status_code=500, detail="File MP4 bị lỗi hoặc rỗng.")

    return FileResponse(
        path=str(file_path),
        media_type="video/mp4",
        filename=output_file,
    )


@router.get("/scenarios/{scenario_id}/media/{filename}", summary="Phát file âm thanh thuyết minh hoặc phụ đề SRT của trận đánh")
async def get_scenario_media_file(scenario_id: str, filename: str) -> FileResponse:
    _validate_safe_id(scenario_id, "scenario_id")
    if not SAFE_FILENAME_PATTERN.match(filename):
        raise HTTPException(status_code=400, detail="Tên file media không hợp lệ.")

    scenario_dir = (settings.output_dir / f"scenario_{scenario_id}").resolve()
    target_path = (scenario_dir / filename).resolve()
    if scenario_dir not in target_path.parents or not target_path.exists():
        raise HTTPException(status_code=404, detail="Không tìm thấy file media.")

    suffix = target_path.suffix.lower()
    media_type = "audio/wav"
    if suffix == ".mp3":
        media_type = "audio/mpeg"
    elif suffix == ".srt":
        media_type = "text/plain; charset=utf-8"

    return FileResponse(path=str(target_path), media_type=media_type, filename=filename)
