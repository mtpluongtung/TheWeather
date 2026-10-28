import asyncio
import json
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
import httpx

from backend.config import settings
from backend.models import HourlyForecastSlot, SevereWeatherSummary, WeatherForecastItem

logger = logging.getLogger("weathercast.weather")
VN_TZ = timezone(timedelta(hours=7))

WMO_CODE_MAP_VI: Dict[int, str] = {
    0: "Trời quang mây, nắng ráo",
    1: "Ít mây, trời nắng",
    2: "Có mây rải rác",
    3: "Nhiều mây, âm u",
    45: "Có sương mù",
    48: "Sương mù dày đặc",
    51: "Mưa phùn nhẹ",
    53: "Mưa phùn vừa",
    55: "Mưa phùn dày hạt",
    61: "Mưa nhỏ",
    63: "Mưa vừa",
    65: "Mưa to",
    71: "Tuyết rơi nhẹ",
    73: "Tuyết rơi vừa",
    75: "Tuyết rơi dày",
    80: "Mưa rào nhẹ rải rác",
    81: "Mưa rào vừa",
    82: "Mưa rào gay gắt",
    95: "Mưa dông",
    96: "Mưa dông kèm mưa đá nhỏ",
    99: "Mưa dông mạnh kèm mưa đá",
}

WMO_SHORT_LABEL_VI: Dict[int, str] = {
    0: "Quang mây",
    1: "Nắng nhẹ",
    2: "Ít mây",
    3: "Nhiều mây",
    45: "Sương mù",
    48: "Sương mù dày",
    51: "Mưa phùn",
    53: "Mưa phùn",
    55: "Mưa phùn dày",
    61: "Mưa nhỏ",
    63: "Mưa vừa",
    65: "Mưa to",
    80: "Mưa rào nhẹ",
    81: "Mưa rào vừa",
    82: "Mưa rào lớn",
    95: "Mưa dông sét",
    96: "Dông & mưa đá",
    99: "Dông lốc mạnh",
}


def wind_kmh_to_beaufort_vi(wind_kmh: float) -> str:
    if wind_kmh >= 89.0:
        return "Cấp 10+ (Bão mạnh)"
    if wind_kmh >= 62.0:
        return "Cấp 8-9 (Bão / Áp thấp)"
    if wind_kmh >= 39.0:
        return "Cấp 6-7 (Giông lốc / Gió giật)"
    if wind_kmh >= 29.0:
        return "Cấp 5 (Gió khá mạnh)"
    if wind_kmh >= 12.0:
        return "Cấp 3-4 (Gió vừa)"
    return "Cấp 1-2 (Gió nhẹ)"


def compute_storm_squall_risk(wind_gusts_kmh: float, wind_speed_kmh: float, w_code: int, cape_jkg: float) -> int:
    eff_wind = max(wind_gusts_kmh, wind_speed_kmh * 1.25)
    if eff_wind >= 62.0:
        base = 78.0 + (eff_wind - 62.0) * 0.65
    elif eff_wind >= 39.0:
        base = 46.0 + (eff_wind - 39.0) * 1.35
    else:
        base = eff_wind * 1.15

    if w_code in (95, 96, 99):
        base += 24.0
    elif w_code in (81, 82, 65):
        base += 12.0
    if cape_jkg >= 1200.0:
        base += 12.0
    elif cape_jkg >= 600.0:
        base += 6.0

    return max(0, min(100, int(round(base))))


def compute_thunder_lightning_risk(w_code: int, cape_jkg: float, precip_prob_pct: int, precip_mm: float) -> int:
    if w_code == 99:
        return 96
    if w_code == 96:
        return 88
    if w_code == 95:
        return 78

    cape_score = min(55.0, cape_jkg / 24.0)
    rain_coupling = precip_prob_pct * (0.32 if (cape_jkg >= 180.0 or w_code >= 61) else 0.14)
    mm_boost = min(15.0, precip_mm * 1.8)
    code_boost = 14.0 if w_code in (80, 81, 82, 65) else 0.0

    return max(0, min(100, int(round(cape_score + rain_coupling + mm_boost + code_boost))))


def build_hourly_timeline_and_summary(
    hourly_block: Dict[str, Any],
    target_date: str,
) -> Tuple[List[HourlyForecastSlot], SevereWeatherSummary]:
    times: List[str] = hourly_block.get("time", []) or []
    temps: List[Any] = hourly_block.get("temperature_2m", []) or []
    probs: List[Any] = hourly_block.get("precipitation_probability", []) or []
    precips: List[Any] = hourly_block.get("precipitation", []) or []
    codes: List[Any] = hourly_block.get("weather_code", []) or []
    winds: List[Any] = hourly_block.get("wind_speed_10m", []) or []
    gusts: List[Any] = hourly_block.get("wind_gusts_10m", []) or []
    capes: List[Any] = hourly_block.get("cape", []) or []

    day_indices = [i for i, t in enumerate(times) if isinstance(t, str) and t.startswith(target_date)]
    if not day_indices and len(times) >= 24:
        day_indices = list(range(24))

    def _safe_float(arr: List[Any], idx: int, default: float = 0.0) -> float:
        if 0 <= idx < len(arr) and arr[idx] is not None:
            return float(arr[idx])
        return default

    def _safe_int(arr: List[Any], idx: int, default: int = 0) -> int:
        if 0 <= idx < len(arr) and arr[idx] is not None:
            return int(round(float(arr[idx])))
        return default

    slots: List[HourlyForecastSlot] = []
    target_hours = [0, 3, 6, 9, 12, 15, 18, 21]

    for h in target_hours:
        win_indices = [day_indices[k] for k in range(h, min(h + 3, len(day_indices)))] if h < len(day_indices) else []
        if not win_indices:
            continue
        primary_idx = win_indices[0]
        t_iso = times[primary_idx] if primary_idx < len(times) else f"{target_date}T{h:02d}:00"
        t_c = round(_safe_float(temps, primary_idx, 26.0), 1)
        p_prob = max(_safe_int(probs, idx, 0) for idx in win_indices)
        p_mm = round(sum(_safe_float(precips, idx, 0.0) for idx in win_indices), 1)
        w_spd = round(max(_safe_float(winds, idx, 0.0) for idx in win_indices), 1)
        w_gst = round(max(_safe_float(gusts, idx, w_spd) for idx in win_indices), 1)
        cape_val = round(max(_safe_float(capes, idx, 0.0) for idx in win_indices), 0)
        w_code = max(_safe_int(codes, idx, 0) for idx in win_indices)

        storm_risk = compute_storm_squall_risk(w_gst, w_spd, w_code, cape_val)
        thunder_risk = compute_thunder_lightning_risk(w_code, cape_val, p_prob, p_mm)

        if w_gst >= 62.0 or storm_risk >= 78:
            hazard = "🌀 Cảnh báo Bão/Gió mạnh"
        elif w_code in (95, 96, 99) or thunder_risk >= 62:
            hazard = "⚡ Dông & Sấm sét"
        elif w_gst >= 39.0 or storm_risk >= 50:
            hazard = "🌪️ Giông lốc / Gió giật"
        elif p_prob >= 65 or p_mm >= 4.0:
            hazard = "🌧️ Khả năng mưa cao"
        else:
            hazard = "☀️ Thời tiết ổn định"

        slots.append(
            HourlyForecastSlot(
                time_iso=t_iso,
                time_label=f"{h:02d}h",
                hour=h,
                temperature_c=t_c,
                precipitation_probability_pct=p_prob,
                precipitation_mm=p_mm,
                wind_speed_kmh=w_spd,
                wind_gusts_kmh=w_gst,
                cape_jkg=cape_val,
                weather_code=w_code,
                weather_label_vi=WMO_SHORT_LABEL_VI.get(w_code, WMO_CODE_MAP_VI.get(w_code, "Có mây")),
                storm_squall_risk_pct=storm_risk,
                thunder_lightning_risk_pct=thunder_risk,
                hazard_label=hazard,
            )
        )

    if not slots:
        return [], SevereWeatherSummary()

    max_gust_slot = max(slots, key=lambda s: s.wind_gusts_kmh)
    max_temp_slot = max(slots, key=lambda s: s.temperature_c)
    max_rain_slot = max(slots, key=lambda s: (s.precipitation_probability_pct, s.precipitation_mm))
    max_cape = max(s.cape_jkg for s in slots)
    max_storm_risk = max(s.storm_squall_risk_pct for s in slots)
    max_thunder_risk = max(s.thunder_lightning_risk_pct for s in slots)
    beaufort_str = wind_kmh_to_beaufort_vi(max_gust_slot.wind_gusts_kmh)

    if max_gust_slot.wind_gusts_kmh >= 62.0 or max_storm_risk >= 80:
        alert_level: Any = "severe"
        summary_vi = (
            f"Cảnh báo gió giật mạnh {max_gust_slot.wind_gusts_kmh:.1f} km/h ({beaufort_str}) "
            f"lúc {max_gust_slot.time_label}, nguy cơ giông lốc/bão {max_storm_risk}%."
        )
    elif max_thunder_risk >= 60 or max_storm_risk >= 55:
        alert_level = "warning"
        summary_vi = (
            f"Lưu ý khả năng xuất hiện mưa dông, sấm sét ({max_thunder_risk}%) và gió giật "
            f"{max_gust_slot.wind_gusts_kmh:.1f} km/h quanh khung {max_rain_slot.time_label}–{max_gust_slot.time_label}."
        )
    elif max_rain_slot.precipitation_probability_pct >= 55 or max_gust_slot.wind_gusts_kmh >= 30.0:
        alert_level = "watch"
        summary_vi = (
            f"Khả năng mưa cao nhất {max_rain_slot.precipitation_probability_pct}% lúc {max_rain_slot.time_label}; "
            f"gió giật tối đa {max_gust_slot.wind_gusts_kmh:.1f} km/h ({beaufort_str})."
        )
    else:
        alert_level = "normal"
        summary_vi = (
            f"Ít nguy cơ bão/giông lốc hay sấm sét; đỉnh nhiệt lúc {max_temp_slot.time_label} ({max_temp_slot.temperature_c}°C), "
            f"gió giật tối đa {max_gust_slot.wind_gusts_kmh:.1f} km/h ({beaufort_str})."
        )

    summary = SevereWeatherSummary(
        max_wind_gust_kmh=max_gust_slot.wind_gusts_kmh,
        max_wind_gust_time=max_gust_slot.time_label,
        beaufort_scale=beaufort_str,
        max_cape_jkg=max_cape,
        max_storm_squall_risk_pct=max_storm_risk,
        max_thunder_lightning_risk_pct=max_thunder_risk,
        peak_temp_time=max_temp_slot.time_label,
        peak_rain_time=max_rain_slot.time_label,
        storm_alert_level=alert_level,
        summary_vi=summary_vi,
    )
    return slots, summary


def deg_to_compass_vi(deg: Optional[int]) -> str:
    if deg is None:
        return "Chưa có dữ liệu"
    directions = [
        "Bắc",
        "Bắc Đông Bắc",
        "Đông Bắc",
        "Đông Đông Bắc",
        "Đông",
        "Đông Đông Nam",
        "Đông Nam",
        "Nam Đông Nam",
        "Nam",
        "Nam Tây Nam",
        "Tây Nam",
        "Tây Tây Nam",
        "Tây",
        "Tây Tây Bắc",
        "Tây Bắc",
        "Bắc Tây Bắc",
    ]
    idx = int((deg + 11.25) / 22.5) % 16
    return f"Gió {directions[idx]} ({deg}°)"


def build_model_advisory(
    temp_max: Optional[float],
    temp_min: Optional[float],
    precip_mm: Optional[float],
    precip_prob: Optional[int],
    wind_kmh: Optional[float],
    uv_idx: Optional[float],
    weather_code: Optional[int],
) -> Optional[str]:
    notes: List[str] = []
    if weather_code in (95, 96, 99):
        notes.append("Mô hình dự báo có khả năng xảy ra mưa dông; lưu ý đề phòng gió giật trong cơn dông")
    if precip_mm is not None and precip_mm >= 25.0:
        notes.append(f"Lượng mưa dự báo từ mô hình khá lớn ({precip_mm:.1f} mm)")
    elif precip_prob is not None and precip_prob >= 75:
        notes.append(f"Xác suất có mưa cao ({precip_prob}%)")
    if temp_max is not None and temp_max >= 35.0:
        notes.append(f"Nhiệt độ cao nhất dự báo đạt mức nắng nóng ({temp_max:.1f}°C)")
    if temp_min is not None and temp_min <= 15.0:
        notes.append(f"Nhiệt độ thấp nhất giảm sâu ({temp_min:.1f}°C), trời rét")
    if wind_kmh is not None and wind_kmh >= 30.0:
        notes.append(f"Tốc độ gió dự báo khá mạnh ({wind_kmh:.1f} km/h)")
    if uv_idx is not None and uv_idx >= 8.0:
        notes.append(f"Chỉ số tia cực tím (UV) ở mức rất cao ({uv_idx:.1f})")

    if not notes:
        return "Các chỉ số dự báo từ mô hình số trị trong ngưỡng thời tiết thông thường."
    return "Lưu ý từ mô hình số trị Open-Meteo (không thay thế cảnh báo chính thức): " + "; ".join(notes) + "."


class WeatherService:
    def __init__(self) -> None:
        self._cache: Dict[str, Tuple[float, WeatherForecastItem]] = {}
        self._radar_cache: Optional[Tuple[float, Dict[str, Any]]] = None
        self._boundaries_cache: Optional[Dict[str, Any]] = None

    def load_places_catalog(self) -> Dict[str, Any]:
        with open(settings.places_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def load_admin_boundaries(self) -> Dict[str, Any]:
        if self._boundaries_cache is not None:
            return self._boundaries_cache
        boundaries_path = settings.places_path.parent / "vn_admin_boundaries.geojson"
        if boundaries_path.exists():
            with open(boundaries_path, "r", encoding="utf-8") as f:
                self._boundaries_cache = json.load(f)
                return self._boundaries_cache
        return {"type": "FeatureCollection", "features": []}

    def get_place_by_id(self, place_id: str) -> Optional[Dict[str, Any]]:
        catalog = self.load_places_catalog()
        for p in catalog.get("places", []):
            if p["id"] == place_id:
                return p
        for preset in catalog.get("camera_presets", []):
            if preset["id"] == place_id:
                return {
                    "id": preset["id"],
                    "name": preset["name"],
                    "full_name": preset["name"],
                    "region": preset.get("region", "all"),
                    "region_label": preset["name"],
                    "admin_2025_unit": preset["name"],
                    "lat": preset["lat"],
                    "lon": preset["lon"],
                    "zoom": preset["zoom"],
                    "pitch": preset["pitch"],
                    "bearing": preset["bearing"],
                    "is_featured": False,
                }
        return None

    async def fetch_forecast_for_place(
        self,
        place_id: str,
        forecast_date: Optional[str] = None,
        force_refresh: bool = False,
    ) -> WeatherForecastItem:
        place = self.get_place_by_id(place_id)
        if not place:
            raise ValueError(f"Không tìm thấy địa điểm có mã '{place_id}' trong danh mục hành chính.")

        today_str = datetime.now(VN_TZ).strftime("%Y-%m-%d")
        target_date = forecast_date or today_str
        cache_key = f"{place_id}:{target_date}"

        now_ts = time.time()
        if not force_refresh and cache_key in self._cache:
            cached_ts, cached_item = self._cache[cache_key]
            if now_ts - cached_ts < settings.weather_cache_ttl_seconds:
                return cached_item

        params = {
            "latitude": place["lat"],
            "longitude": place["lon"],
            "current": (
                "temperature_2m,relative_humidity_2m,apparent_temperature,"
                "precipitation,weather_code,wind_speed_10m,wind_direction_10m"
            ),
            "hourly": (
                "temperature_2m,precipitation_probability,precipitation,"
                "weather_code,wind_speed_10m,wind_gusts_10m,cape"
            ),
            "daily": (
                "weather_code,temperature_2m_max,temperature_2m_min,"
                "precipitation_sum,precipitation_probability_max,"
                "wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max"
            ),
            "timezone": "Asia/Ho_Chi_Minh",
            "forecast_days": 7,
        }

        last_error: Optional[Exception] = None
        raw_data: Optional[Dict[str, Any]] = None

        for attempt in range(1, settings.weather_api_max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=settings.weather_api_timeout_sec) as client:
                    resp = await client.get(settings.open_meteo_base_url, params=params)
                    resp.raise_for_status()
                    raw_data = resp.json()
                    break
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "Lỗi gọi Open-Meteo lần %d/%d cho %s: %s",
                    attempt,
                    settings.weather_api_max_retries,
                    place_id,
                    exc,
                )
                if attempt < settings.weather_api_max_retries:
                    await asyncio.sleep(0.8 * attempt)

        if raw_data is None:
            raise RuntimeError(
                f"Không thể tải dữ liệu thời tiết thực tế từ Open-Meteo cho '{place['name']}' "
                f"sau {settings.weather_api_max_retries} lần thử: {last_error}"
            )

        current_block = raw_data.get("current", {})
        daily_block = raw_data.get("daily", {})
        daily_times: List[str] = daily_block.get("time", [])

        date_idx = 0
        if target_date in daily_times:
            date_idx = daily_times.index(target_date)
        elif daily_times:
            target_date = daily_times[0]

        def _daily_val(key: str, idx: int) -> Any:
            arr = daily_block.get(key, [])
            if isinstance(arr, list) and 0 <= idx < len(arr):
                return arr[idx]
            return None

        is_today = target_date == today_str
        temp_max = _daily_val("temperature_2m_max", date_idx)
        temp_min = _daily_val("temperature_2m_min", date_idx)

        if is_today and current_block.get("temperature_2m") is not None:
            temp_c = float(current_block["temperature_2m"])
            apparent_c = (
                float(current_block["apparent_temperature"])
                if current_block.get("apparent_temperature") is not None
                else None
            )
            humidity = (
                int(current_block["relative_humidity_2m"])
                if current_block.get("relative_humidity_2m") is not None
                else None
            )
            w_code = (
                int(current_block["weather_code"])
                if current_block.get("weather_code") is not None
                else _daily_val("weather_code", date_idx)
            )
            wind_speed = (
                float(current_block["wind_speed_10m"])
                if current_block.get("wind_speed_10m") is not None
                else _daily_val("wind_speed_10m_max", date_idx)
            )
            wind_dir = (
                int(current_block["wind_direction_10m"])
                if current_block.get("wind_direction_10m") is not None
                else _daily_val("wind_direction_10m_dominant", date_idx)
            )
            data_type = "current_and_daily"
        else:
            temp_c = (
                round((float(temp_max) + float(temp_min)) / 2.0, 1)
                if (temp_max is not None and temp_min is not None)
                else temp_max
            )
            apparent_c = None
            humidity = None
            w_code = _daily_val("weather_code", date_idx)
            wind_speed = _daily_val("wind_speed_10m_max", date_idx)
            wind_dir = _daily_val("wind_direction_10m_dominant", date_idx)
            data_type = "daily_forecast"

        precip_sum = _daily_val("precipitation_sum", date_idx)
        if is_today and precip_sum is None and current_block.get("precipitation") is not None:
            precip_sum = float(current_block["precipitation"])

        precip_prob = _daily_val("precipitation_probability_max", date_idx)
        uv_idx = _daily_val("uv_index_max", date_idx)

        w_code_int = int(w_code) if w_code is not None else None
        weather_desc_vi = (
            WMO_CODE_MAP_VI.get(w_code_int, f"Mã khí tượng WMO {w_code_int}")
            if w_code_int is not None
            else "Chưa có dữ liệu"
        )

        fetched_iso = datetime.now(VN_TZ).isoformat(timespec="seconds")
        model_time = current_block.get("time")
        hourly_block = raw_data.get("hourly", {})
        hourly_timeline, severe_summary = build_hourly_timeline_and_summary(hourly_block, target_date)

        item = WeatherForecastItem(
            place_id=place["id"],
            place_name=place["name"],
            region=place.get("region", "all"),
            lat=float(place["lat"]),
            lon=float(place["lon"]),
            admin_version=self.load_places_catalog().get("schema_version", "2025.2-VN-ADMIN"),
            fetched_at=fetched_iso,
            model_updated_at=model_time,
            forecast_date=target_date,
            timezone=raw_data.get("timezone", "Asia/Ho_Chi_Minh"),
            data_type=data_type,
            temperature_c=round(float(temp_c), 1) if temp_c is not None else None,
            apparent_temperature_c=round(float(apparent_c), 1) if apparent_c is not None else None,
            temp_max_c=round(float(temp_max), 1) if temp_max is not None else None,
            temp_min_c=round(float(temp_min), 1) if temp_min is not None else None,
            relative_humidity_pct=int(humidity) if humidity is not None else None,
            precipitation_probability_pct=int(precip_prob) if precip_prob is not None else None,
            precipitation_mm=round(float(precip_sum), 1) if precip_sum is not None else None,
            wind_speed_kmh=round(float(wind_speed), 1) if wind_speed is not None else None,
            wind_direction_deg=int(wind_dir) if wind_dir is not None else None,
            wind_direction_label=deg_to_compass_vi(int(wind_dir) if wind_dir is not None else None),
            uv_index=round(float(uv_idx), 1) if uv_idx is not None else None,
            weather_code=w_code_int,
            weather_description_vi=weather_desc_vi,
            official_warnings="Chưa có dữ liệu cảnh báo tự động (Tra cứu cảnh báo chính thức tại nchmf.gov.vn)",
            model_advisory_note=build_model_advisory(
                temp_max=temp_max,
                temp_min=temp_min,
                precip_mm=precip_sum,
                precip_prob=precip_prob,
                wind_kmh=wind_speed,
                uv_idx=uv_idx,
                weather_code=w_code_int,
            ),
            hourly_timeline=hourly_timeline,
            severe_weather_summary=severe_summary,
            source_name="Open-Meteo Forecast API (Dữ liệu mô hình khí tượng số trị)",
            source_url="https://open-meteo.com/en/docs",
            reference_agency_name="Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (NCHMF)",
            reference_agency_url=settings.nchmf_reference_url,
            is_stale=False,
            data_status="verified_api",
        )

        self._cache[cache_key] = (now_ts, item)
        return item

    async def fetch_multiple_places(
        self,
        place_ids: List[str],
        forecast_date: Optional[str] = None,
        force_refresh: bool = False,
    ) -> List[WeatherForecastItem]:
        tasks = [
            self.fetch_forecast_for_place(pid, forecast_date=forecast_date, force_refresh=force_refresh)
            for pid in place_ids
        ]
        return list(await asyncio.gather(*tasks))

    async def fetch_rainviewer_metadata(self) -> Dict[str, Any]:
        """Fetch real-time radar and satellite infrared tile metadata from RainViewer Public API."""
        now_ts = time.time()
        if self._radar_cache and (now_ts - self._radar_cache[0] < 300):
            return self._radar_cache[1]
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(settings.rainviewer_api_url)
                resp.raise_for_status()
                data = resp.json()
                host = data.get("host", "https://tilecache.rainviewer.com")
                radar_past = data.get("radar", {}).get("past", [])
                infrared_past = data.get("satellite", {}).get("infrared", [])
                latest_radar = radar_past[-1] if radar_past else None
                latest_ir = infrared_past[-1] if infrared_past else None

                result = {
                    "available": bool(latest_radar),
                    "host": host,
                    "radar_tile_url": (
                        f"{host}{latest_radar['path']}/256/{{z}}/{{x}}/{{y}}/2/1_1.png"
                        if latest_radar
                        else None
                    ),
                    "radar_timestamp": latest_radar["time"] if latest_radar else None,
                    "satellite_tile_url": (
                        f"{host}{latest_ir['path']}/256/{{z}}/{{x}}/{{y}}/0/0_0.png"
                        if latest_ir
                        else None
                    ),
                    "attribution": "© RainViewer API (Dữ liệu Radar & Vệ tinh thực tế)",
                }
                self._radar_cache = (now_ts, result)
                return result
        except Exception as exc:
            logger.warning("Không thể tải metadata radar từ RainViewer: %s", exc)
            return {
                "available": False,
                "radar_tile_url": None,
                "satellite_tile_url": None,
                "error": str(exc),
                "attribution": "RainViewer API (Tạm thời không khả dụng)",
            }


weather_service = WeatherService()
