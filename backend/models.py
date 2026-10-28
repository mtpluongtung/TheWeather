from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field


class CameraSpec(BaseModel):
    center: List[float] = Field(..., description="[longitude, latitude] theo chuẩn MapLibre GL JS")
    zoom: float = Field(default=6.0, ge=2.0, le=18.0)
    pitch: float = Field(default=45.0, ge=0.0, le=85.0)
    bearing: float = Field(default=0.0, ge=-180.0, le=180.0)


class LocationInfo(BaseModel):
    place_id: str
    name: str
    region: str = "all"
    lat: float
    lon: float
    admin_2025_unit: Optional[str] = None


class HourlyForecastSlot(BaseModel):
    time_iso: str
    time_label: str = Field(..., description="Khung giờ hiển thị (00h, 03h, 06h, 09h, 12h, 15h, 18h, 21h)")
    hour: int
    temperature_c: float
    precipitation_probability_pct: int = 0
    precipitation_mm: float = 0.0
    wind_speed_kmh: float = 0.0
    wind_gusts_kmh: float = 0.0
    cape_jkg: float = 0.0
    weather_code: int = 0
    weather_label_vi: str = "Bình thường"
    storm_squall_risk_pct: int = Field(default=0, description="Nguy cơ bão / giông lốc / gió giật mạnh (%)")
    thunder_lightning_risk_pct: int = Field(default=0, description="Nguy cơ sấm sét / mưa dông đối lưu (%)")
    hazard_label: str = Field(default="Ổn định", description="Nhãn cảnh báo ngắn gọn theo khung giờ")


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
    official_warnings: str = "Chưa có dữ liệu (Xem bản tin chính thức tại nchmf.gov.vn)"
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
    start_time: float = Field(..., description="Thời gian bắt đầu (giây)")
    end_time: float = Field(..., description="Thời gian kết thúc (giây)")
    duration_sec: float = Field(..., description="Thời lượng cảnh (giây)")
    narration: str = Field(..., description="Lời dẫn tiếng Việt")
    voice_audio: Optional[str] = Field(default=None, description="Đường dẫn URL/file âm thanh TTS của cảnh")
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
    forecast_date: Optional[str] = Field(default=None, description="YYYY-MM-DD, mặc định hôm nay")
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
