from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field


class CameraSpec(BaseModel):
    center: List[float] = Field(..., description="[longitude, latitude] theo chuẩn MapLibre GL JS")
    zoom: float = Field(default=6.0, ge=2.0, le=18.0)
    pitch: float = Field(default=45.0, ge=0.0, le=85.0)
    bearing: float = Field(default=0.0, ge=-180.0, le=180.0)
    duration_sec: Optional[float] = None
    easing: Optional[str] = "easeInOutCubic"


# ==========================================
# ⚔️ MILITARY HISTORY MAP SCENARIO SCHEMAS
# ==========================================

class MilitaryFaction(BaseModel):
    id: str = Field(..., description="Mã định danh phe (ví dụ: viet_minh, french_army)")
    name: str = Field(..., description="Tên đầy đủ của lực lượng")
    short_name: str = Field(..., description="Tên viết tắt hiển thị trên nhãn/HUD")
    color: str = Field(default="#e11d48", description="Mã màu HEX đại diện")
    secondary_color: str = Field(default="#9f1239", description="Mã màu viền/phụ")
    commander: str = Field(..., description="Tướng chỉ huy cao nhất")
    flag_icon: str = Field(default="⚔️", description="Biểu tượng cờ hoặc emoji")
    initial_manpower: int = Field(default=10000, ge=0, description="Tổng quân số ban đầu")
    current_manpower: int = Field(default=10000, ge=0, description="Quân số hiện tại")
    infantry_count: int = Field(default=8000, ge=0)
    artillery_count: int = Field(default=50, ge=0)
    tanks_count: int = Field(default=0, ge=0)
    aircraft_count: int = Field(default=0, ge=0)
    casualties: int = Field(default=0, ge=0, description="Thương vong tích lũy")


class MilitaryUnit(BaseModel):
    id: str = Field(..., description="Mã định danh đơn vị (ví dụ: unit_f312)")
    faction_id: str = Field(..., description="Thuộc phe nào")
    name: str = Field(..., description="Tên phiên hiệu đầy đủ (Đại đoàn 312)")
    short_name: str = Field(..., description="Tên viết tắt trên biểu tượng (F312)")
    type: Literal["infantry", "cavalry", "artillery", "armor", "headquarters", "naval", "air", "fortification"] = Field(
        default="infantry", description="Loại binh chủng theo chuẩn quân sự"
    )
    echelon: Literal["corps", "division", "brigade", "regiment", "battalion", "company"] = Field(
        default="division", description="Cấp bậc đơn vị (quân đoàn, sư đoàn, trung đoàn...)"
    )
    coordinates: List[float] = Field(..., description="Tọa độ [longitude, latitude]")
    elevation_m: Optional[float] = Field(default=None, description="Độ cao địa hình (mét)")
    strength_initial: int = Field(default=1000, ge=0, description="Quân số ban đầu của đơn vị")
    strength_current: int = Field(default=1000, ge=0, description="Quân số hiện tại")
    status: Literal["active", "moving", "engaging", "defending", "fortified", "routing", "destroyed", "surrendered"] = Field(
        default="active", description="Trạng thái chiến đấu"
    )
    facing_deg: float = Field(default=0.0, description="Góc xoay hướng mũi tên/hướng nhìn (0-360 độ)")
    waypoints: Optional[List[Dict[str, Any]]] = Field(
        default=None, description="Danh sách các điểm di chuyển theo thời gian: [{'time': 12.0, 'coords': [lon, lat]}]"
    )


class TacticalArrowAction(BaseModel):
    id: str = Field(..., description="Mã định danh mũi tên")
    faction_id: str = Field(..., description="Mũi tấn công thuộc phe nào")
    name: str = Field(..., description="Mô tả hành động chiến thuật")
    path_coordinates: List[List[float]] = Field(..., description="Chuỗi tọa độ [[lon, lat], ...] tạo đường uốn lượn")
    curve_type: Literal["bezier", "waypoint_polyline"] = Field(default="bezier")
    arrow_type: Literal["main_thrust", "flanking", "encirclement", "feint", "artillery_barrage"] = Field(
        default="main_thrust", description="Loại mũi tên chiến thuật"
    )
    color: str = Field(default="#e11d48", description="Mã màu mũi tên")
    stroke_width: float = Field(default=6.0, ge=1.0, le=20.0)
    start_time: float = Field(..., ge=0.0, description="Giây bắt đầu vẽ mũi tên")
    end_time: float = Field(..., ge=0.0, description="Giây hoàn thành mũi tên")
    dashed: bool = Field(default=False, description="Đường nét đứt (thích hợp cho hỏa lực/hào vây)")
    head_size: float = Field(default=1.5, ge=0.5, le=5.0, description="Tỷ lệ kích thước đầu mũi tên")
    label: Optional[str] = Field(default=None, description="Nhãn hiển thị chạy dọc thân mũi tên")


class TerritorialPocket(BaseModel):
    id: str = Field(..., description="Mã vùng kiểm soát")
    faction_id: str = Field(..., description="Phe đang kiểm soát")
    name: str = Field(..., description="Tên cứ điểm/vùng chiếm đóng")
    polygon_coordinates: List[List[float]] = Field(..., description="Tọa độ vành Polygon GeoJSON [[lon, lat], ...]")
    color: str = Field(default="#2563eb", description="Màu tô vùng")
    fill_opacity: float = Field(default=0.25, ge=0.0, le=1.0)
    stroke_color: str = Field(default="#3b82f6")
    stroke_width: float = Field(default=2.0)
    dashed_stroke: bool = Field(default=False)
    active_time_start: float = Field(default=0.0)
    active_time_end: float = Field(default=999.0)


class CombatEvent(BaseModel):
    id: str = Field(..., description="Mã sự kiện giao tranh")
    name: str = Field(..., description="Tên trận đánh/bão lửa")
    coordinates: List[float] = Field(..., description="Tọa độ tâm va chạm [lon, lat]")
    event_type: Literal["artillery_strike", "breakthrough", "clash", "air_drop", "siege_tunnel"] = Field(
        default="clash"
    )
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    intensity: int = Field(default=3, ge=1, le=5, description="Mức độ ác liệt (1-5)")
    description: Optional[str] = None


class BattleTimelineStep(BaseModel):
    step_id: str
    step_index: int
    timestamp_label: str = Field(..., description="Mốc thời gian lịch sử (ví dụ: 13/03/1954 - 17:05)")
    title: str = Field(..., description="Tiêu đề bước tiến quân")
    phase_name: str = Field(..., description="Tên đợt / chiến dịch")
    tactical_objective: str = Field(..., description="Tóm tắt mục tiêu chiến thuật")
    camera: CameraSpec = Field(..., description="Góc máy 3D MapLibre cho bước này")
    start_time: float = Field(..., ge=0.0)
    end_time: float = Field(..., ge=0.0)
    duration_sec: float = Field(..., ge=0.5)
    narration_text: str = Field(..., description="Lời dẫn thuyết minh chi tiết cho TTS")
    voice_audio: Optional[str] = Field(default=None, description="Đường dẫn âm thanh TTS nếu có")
    active_unit_ids: List[str] = Field(default_factory=list)
    active_arrow_ids: List[str] = Field(default_factory=list)
    active_combat_ids: List[str] = Field(default_factory=list)
    active_territory_ids: List[str] = Field(default_factory=list)
    factions_status: Optional[Dict[str, Any]] = Field(default=None, description="Snapshot quân số/thương vong tại mốc này")


class BattleScenario(BaseModel):
    id: str = Field(..., description="Mã kịch bản (ví dụ: dien_bien_phu_1954)")
    title: str = Field(..., description="Tên trận đánh lịch sử")
    subtitle: str = Field(..., description="Phụ đề tóm lược trận đánh")
    historical_date_range: str = Field(..., description="Thời gian diễn ra trận đánh")
    location_name: str = Field(..., description="Địa danh lịch sử")
    center: List[float] = Field(..., description="Tọa độ trung tâm [lon, lat]")
    default_zoom: float = Field(default=12.0)
    default_pitch: float = Field(default=55.0)
    default_bearing: float = Field(default=0.0)
    terrain_elevation: bool = Field(default=True, description="Kích hoạt sa bàn 3D đồi núi")
    map_style: str = Field(default="carto_dark")
    factions: List[MilitaryFaction] = Field(default_factory=list)
    units: List[MilitaryUnit] = Field(default_factory=list)
    arrows: List[TacticalArrowAction] = Field(default_factory=list)
    territories: List[TerritorialPocket] = Field(default_factory=list)
    combat_events: List[CombatEvent] = Field(default_factory=list)
    timeline_steps: List[BattleTimelineStep] = Field(default_factory=list)
    total_duration_sec: float = Field(default=60.0)


class ScenarioRenderRequest(BaseModel):
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    resolution: Literal["720p", "1080p"] = "720p"
    fps: int = Field(default=30, ge=24, le=60)
    voice_id: str = Field(default="vi-VN-NamMinhNeural")
    voice_rate: str = Field(default="+0%")
    enable_bgm: bool = True
    enable_subtitles: bool = True


# ==========================================
# ⛅ LEGACY / WEATHERCAST TYPES (Preserved)
# ==========================================

class LocationInfo(BaseModel):
    place_id: str
    name: str
    region: str = "all"
    lat: float
    lon: float
    admin_2025_unit: Optional[str] = None


class HourlyForecastSlot(BaseModel):
    time_iso: str
    time_label: str
    hour: int
    temperature_c: float
    precipitation_probability_pct: int = 0
    precipitation_mm: float = 0.0
    wind_speed_kmh: float = 0.0
    wind_gusts_kmh: float = 0.0
    cape_jkg: float = 0.0
    weather_code: int = 0
    weather_label_vi: str = "Bình thường"
    storm_squall_risk_pct: int = 0
    thunder_lightning_risk_pct: int = 0
    hazard_label: str = "Ổn định"


class SevereWeatherSummary(BaseModel):
    max_wind_gust_kmh: float = 0.0
    max_wind_gust_time: str = "12h"
    beaufort_scale: str = "Cấp 2-3 (Gió nhẹ)"
    max_cape_jkg: float = 0.0
    max_storm_squall_risk_pct: int = 0
    max_thunder_lightning_risk_pct: int = 0
    peak_temp_time: str = "15h"
    peak_rain_time: str = "18h"
    storm_alert_level: Literal["normal", "watch", "warning", "severe"] = "normal"
    summary_vi: str = "Không có dấu hiệu bão hoặc giông lốc bất thường từ mô hình số trị."


class WeatherForecastItem(BaseModel):
    place_id: str
    place_name: str
    region: str
    lat: float
    lon: float
    admin_version: str = "2025.2-VN-ADMIN"
    fetched_at: str
    model_updated_at: Optional[str] = None
    forecast_date: str
    timezone: str = "Asia/Ho_Chi_Minh"
    data_type: Literal["current_and_daily", "daily_forecast"] = "current_and_daily"
    temperature_c: Optional[float] = None
    apparent_temperature_c: Optional[float] = None
    temp_max_c: Optional[float] = None
    temp_min_c: Optional[float] = None
    relative_humidity_pct: Optional[int] = None
    precipitation_probability_pct: Optional[int] = None
    precipitation_mm: Optional[float] = None
    wind_speed_kmh: Optional[float] = None
    wind_direction_deg: Optional[int] = None
    wind_direction_label: str = "Chưa có dữ liệu"
    uv_index: Optional[float] = None
    weather_code: Optional[int] = None
    weather_description_vi: str = "Chưa có dữ liệu"
    official_warnings: str = "Chưa có dữ liệu"
    model_advisory_note: Optional[str] = None
    hourly_timeline: List[HourlyForecastSlot] = Field(default_factory=list)
    severe_weather_summary: Optional[SevereWeatherSummary] = None
    source_name: str = "Open-Meteo Forecast API"
    source_url: str = "https://open-meteo.com/"
    reference_agency_name: str = "Trung tâm Dự báo KTTV Quốc gia (NCHMF)"
    reference_agency_url: str = "https://www.nchmf.gov.vn/kttv/"
    is_stale: bool = False
    data_status: str = "verified_api"


class SceneItem(BaseModel):
    scene_id: str
    order_index: int
    title: str
    start_time: float
    end_time: float
    duration_sec: float
    narration: str
    voice_audio: Optional[str] = None
    location: LocationInfo
    camera: CameraSpec
    camera_start: Optional[CameraSpec] = None
    weather_overlay: Literal["temperature", "precipitation", "wind", "radar", "uv", "overview"] = "temperature"
    subtitle: str
    transition: Literal["flyTo", "easeTo", "cinematic_arc", "smooth_pan"] = "flyTo"
    weather_data: Optional[WeatherForecastItem] = None


class ScriptGenerationRequest(BaseModel):
    scope: Literal["nationwide", "region", "custom_places"] = "nationwide"
    place_ids: List[str] = Field(default_factory=lambda: ["ha_noi", "bac_ninh", "da_nang", "lam_dong", "tp_hcm", "can_tho"])
    forecast_date: Optional[str] = None
    target_duration_sec: int = Field(default=60, ge=15, le=180)
    tone: Literal["broadcast", "concise", "friendly", "detailed"] = "broadcast"
    camera_style: Literal["cinematic_fly", "broadcast_smooth", "dynamic_orbit", "direct_pan"] = "cinematic_fly"
    weather_forecasts: Optional[List[WeatherForecastItem]] = None


class ScriptGenerationResponse(BaseModel):
    title: str
    scope: str
    forecast_date: str
    tone: str
    generator_used: str
    total_estimated_duration_sec: float
    data_source_summary: str
    scenes: List[SceneItem]


class ProjectCreateRequest(BaseModel):
    name: str = Field(default="Bản tin Dự báo Thời tiết Việt Nam")
    scope: Literal["nationwide", "region", "custom_places"] = "nationwide"
    place_ids: List[str] = Field(default_factory=lambda: ["ha_noi", "bac_ninh", "da_nang", "tp_hcm"])
    forecast_date: Optional[str] = None
    target_duration_sec: int = Field(default=45, ge=15, le=180)
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = "16:9"
    resolution: Literal["720p", "1080p"] = "720p"
    fps: int = Field(default=30, ge=24, le=60)
    voice_id: str = Field(default="vi-VN-HoaiMyNeural")
    voice_rate: str = Field(default="+0%")
    tone: Literal["broadcast", "concise", "friendly", "detailed"] = "broadcast"
    camera_style: Literal["cinematic_fly", "broadcast_smooth", "dynamic_orbit", "direct_pan"] = "cinematic_fly"
    map_provider: str = Field(default="openfreemap_liberty")
    enable_3d_terrain: bool = True
    enable_subtitles: bool = True
    enable_bgm: bool = True
    scenes: Optional[List[SceneItem]] = None


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    aspect_ratio: Optional[Literal["16:9", "9:16", "1:1"]] = None
    resolution: Optional[Literal["720p", "1080p"]] = None
    voice_id: Optional[str] = None
    voice_rate: Optional[str] = None
    tone: Optional[Literal["broadcast", "concise", "friendly", "detailed"]] = None
    camera_style: Optional[Literal["cinematic_fly", "broadcast_smooth", "dynamic_orbit", "direct_pan"]] = None
    map_provider: Optional[str] = None
    enable_3d_terrain: Optional[bool] = None
    enable_subtitles: Optional[bool] = None
    enable_bgm: Optional[bool] = None
    scenes: Optional[List[SceneItem]] = None


class RenderProgress(BaseModel):
    project_id: str
    status: Literal["idle", "preparing_audio", "syncing_timeline", "rendering_map", "encoding_video", "completed", "failed"] = "idle"
    progress_pct: float = 0.0
    current_step: str = "Sẵn sàng"
    frames_rendered: int = 0
    total_frames: int = 0
    error_message: Optional[str] = None
    output_file: Optional[str] = None
    download_url: Optional[str] = None
    video_metadata: Optional[Dict[str, Any]] = None
    updated_at: Optional[str] = None
