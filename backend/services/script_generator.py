import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import httpx

from backend.config import settings
from backend.models import (
    CameraSpec,
    LocationInfo,
    SceneItem,
    ScriptGenerationRequest,
    ScriptGenerationResponse,
    WeatherForecastItem,
)
from backend.services.weather import weather_service

logger = logging.getLogger("weathercast.script")
VN_TZ = timezone(timedelta(hours=7))


def _fmt_num(val: Optional[float], unit: str = "", decimals: int = 1) -> str:
    if val is None:
        return "chưa có dữ liệu"
    if decimals == 0 or float(val).is_integer():
        return f"{int(round(val))}{unit}"
    return f"{val:.{decimals}f}{unit}".replace(".", ",")


def _estimate_speaking_duration(text: str, words_per_sec: float = 3.1) -> float:
    words = [w for w in text.strip().split() if w]
    return max(4.5, round(len(words) / words_per_sec + 0.8, 1))


def _compose_place_narration(item: WeatherForecastItem, tone: str, target_duration_sec: int) -> str:
    name = item.place_name
    desc = item.weather_description_vi.lower()
    t_cur = _fmt_num(item.temperature_c, " độ C", 0)
    t_min = _fmt_num(item.temp_min_c, " độ", 0)
    t_max = _fmt_num(item.temp_max_c, " độ C", 0)
    rain_prob = item.precipitation_probability_pct
    rain_mm = item.precipitation_mm
    wind_spd = item.wind_speed_kmh
    uv = item.uv_index
    hum = item.relative_humidity_pct

    rain_phrase = ""
    if rain_prob is not None and rain_prob >= 50:
        if rain_mm is not None and rain_mm > 0:
            rain_phrase = f"xác suất mưa khoảng {rain_prob}% với tổng lượng mưa dự báo {_fmt_num(rain_mm, ' mi-li-mét')}"
        else:
            rain_phrase = f"khả năng có mưa ở mức {rain_prob}%"
    elif rain_mm is not None and rain_mm >= 1.0:
        rain_phrase = f"lượng mưa dự báo khoảng {_fmt_num(rain_mm, ' mi-li-mét')}"
    elif rain_prob is not None:
        rain_phrase = f"xác suất mưa thấp ở mức {rain_prob}%"

    if tone == "concise" or target_duration_sec <= 30:
        parts = [f"Tại {name}, thời tiết {desc}, nhiệt độ hiện tại {t_cur}, dao động từ {t_min} đến {t_max}."]
        if rain_phrase:
            parts.append(f"Ghi nhận {rain_phrase}.")
        return " ".join(parts)

    if tone == "friendly":
        parts = [
            f"Chuyển sang khu vực {name}, hôm nay bầu trời {desc}.",
            f"Nhiệt độ ghi nhận ở mức {t_cur}, biên độ nhiệt trong ngày từ {t_min} đến {t_max}.",
        ]
        if rain_phrase:
            parts.append(f"Quý vị lưu ý {rain_phrase}.")
        if uv is not None and uv >= 7:
            parts.append(f"Chỉ số tia UV đạt mức {_fmt_num(uv, '', 1)}, mọi người nên che chắn khi ra ngoài.")
        return " ".join(parts)

    if tone == "detailed":
        parts = [
            f"Theo số liệu khí tượng tại {name}, trạng thái thời tiết chủ đạo là {desc}.",
            f"Nhiệt độ đo được đạt {t_cur}, nhiệt độ thấp nhất {t_min} và cao nhất {t_max}.",
        ]
        if hum is not None:
            parts.append(f"Độ ẩm tương đối khoảng {hum}%.")
        if rain_phrase:
            parts.append(f"Về lượng mưa, mô hình ghi nhận {rain_phrase}.")
        if wind_spd is not None:
            parts.append(f"{item.wind_direction_label} với tốc độ {_fmt_num(wind_spd, ' ki-lô-mét trên giờ')}.")
        if uv is not None:
            parts.append(f"Chỉ số bức xạ tia cực tím UV tối đa ở mức {_fmt_num(uv, '', 1)}.")
        return " ".join(parts)

    # Default: "broadcast" (Truyền hình chuyên nghiệp)
    parts = [
        f"Tại khu vực {name}, thời tiết phổ biến {desc}.",
        f"Nhiệt độ ghi nhận ở mức {t_cur}, trong ngày dao động từ {t_min} đến {t_max}.",
    ]
    if rain_phrase:
        parts.append(f"Dữ liệu mô hình cho thấy {rain_phrase}.")
    if item.severe_weather_summary:
        sev = item.severe_weather_summary
        if sev.max_thunder_lightning_risk_pct >= 55 or sev.max_storm_squall_risk_pct >= 55:
            parts.append(
                f"Lưu ý quanh khung {sev.max_wind_gust_time} có nguy cơ dông sét {sev.max_thunder_lightning_risk_pct}% "
                f"và gió giật {_fmt_num(sev.max_wind_gust_kmh, ' ki-lô-mét trên giờ')}."
            )
        elif wind_spd is not None and wind_spd >= 20:
            parts.append(f"Gió hoạt động ở mức {_fmt_num(wind_spd, ' ki-lô-mét trên giờ')}.")
    elif wind_spd is not None and wind_spd >= 20:
        parts.append(f"Gió hoạt động ở mức {_fmt_num(wind_spd, ' ki-lô-mét trên giờ')}.")
    return " ".join(parts)


def _select_overlay_for_weather(item: WeatherForecastItem) -> str:
    if item.precipitation_mm is not None and item.precipitation_mm >= 5.0:
        return "precipitation"
    if item.precipitation_probability_pct is not None and item.precipitation_probability_pct >= 65:
        return "radar"
    if item.wind_speed_kmh is not None and item.wind_speed_kmh >= 28.0:
        return "wind"
    if item.uv_index is not None and item.uv_index >= 8.5:
        return "uv"
    return "temperature"


class ScriptGeneratorService:
    async def generate_script(self, req: ScriptGenerationRequest) -> ScriptGenerationResponse:
        today_str = datetime.now(VN_TZ).strftime("%Y-%m-%d")
        forecast_date = req.forecast_date or today_str

        catalog = weather_service.load_places_catalog()
        presets_by_id = {p["id"]: p for p in catalog.get("camera_presets", [])}
        places_by_id = {p["id"]: p for p in catalog.get("places", [])}

        if req.weather_forecasts and len(req.weather_forecasts) > 0:
            forecasts = req.weather_forecasts
        else:
            place_ids = req.place_ids if req.place_ids else ["ha_noi", "bac_ninh", "da_nang", "lam_dong", "tp_hcm"]
            forecasts = await weather_service.fetch_multiple_places(place_ids, forecast_date=forecast_date)

        forecasts_by_id = {f.place_id: f for f in forecasts}

        scenes: List[SceneItem] = []
        current_time = 0.0
        order_idx = 0

        # Scene 1: Mở đầu - Toàn cảnh Việt Nam
        vn_preset = presets_by_id.get("vietnam_overview", {
            "id": "vietnam_overview",
            "name": "Toàn cảnh Việt Nam",
            "lat": 16.2,
            "lon": 106.8,
            "zoom": 5.3,
            "pitch": 35,
            "bearing": -8,
        })

        all_temps = [f.temperature_c for f in forecasts if f.temperature_c is not None]
        min_all = min([f.temp_min_c for f in forecasts if f.temp_min_c is not None], default=None)
        max_all = max([f.temp_max_c for f in forecasts if f.temp_max_c is not None], default=None)

        date_display = forecast_date
        try:
            dt_obj = datetime.strptime(forecast_date, "%Y-%m-%d")
            date_display = dt_obj.strftime("%d/%m/%Y")
        except ValueError:
            pass

        if min_all is not None and max_all is not None:
            intro_narration = (
                f"Xin kính chào quý vị. Đây là bản tin dự báo thời tiết ngày {date_display} "
                f"trên toàn lãnh thổ Việt Nam, tổng hợp từ dữ liệu khí tượng Open-Meteo. "
                f"Nhiệt độ tại các khu vực khảo sát dao động từ {_fmt_num(min_all, ' độ', 0)} "
                f"đến {_fmt_num(max_all, ' độ C', 0)}."
            )
        else:
            intro_narration = (
                f"Xin kính chào quý vị. Mời quý vị theo dõi bản tin dự báo thời tiết ngày {date_display} "
                f"cập nhật theo dữ liệu thực tế từ hệ thống khí tượng Open-Meteo."
            )

        if req.tone == "concise":
            intro_narration = (
                f"Bản tin dự báo thời tiết ngày {date_display} từ dữ liệu thực tế Open-Meteo. "
                f"Nhiệt độ các điểm khảo sát từ {_fmt_num(min_all, ' độ', 0)} đến {_fmt_num(max_all, ' độ C', 0)}."
            )

        intro_dur = _estimate_speaking_duration(intro_narration)
        scenes.append(
            SceneItem(
                scene_id="scene_intro",
                order_index=order_idx,
                title="Mở đầu – Toàn cảnh Việt Nam",
                start_time=round(current_time, 2),
                end_time=round(current_time + intro_dur, 2),
                duration_sec=intro_dur,
                narration=intro_narration,
                subtitle=intro_narration,
                location=LocationInfo(
                    place_id="vietnam_overview",
                    name="Toàn cảnh Việt Nam",
                    region="all",
                    lat=vn_preset["lat"],
                    lon=vn_preset["lon"],
                    admin_2025_unit="Cộng hòa Xã hội Chủ nghĩa Việt Nam",
                ),
                camera=CameraSpec(
                    center=[vn_preset["lon"], vn_preset["lat"]],
                    zoom=vn_preset["zoom"],
                    pitch=vn_preset["pitch"],
                    bearing=vn_preset["bearing"],
                ),
                camera_start=CameraSpec(
                    center=[vn_preset["lon"], vn_preset["lat"]],
                    zoom=max(4.5, vn_preset["zoom"] - 0.6),
                    pitch=20.0,
                    bearing=0.0,
                ),
                weather_overlay="overview",
                transition="flyTo",
                weather_data=forecasts[0] if forecasts else None,
            )
        )
        current_time += intro_dur
        order_idx += 1

        prev_camera = scenes[-1].camera

        # Các cảnh chi tiết cho từng địa điểm/khu vực được chọn
        for f_item in forecasts:
            p_meta = places_by_id.get(f_item.place_id) or weather_service.get_place_by_id(f_item.place_id) or {
                "id": f_item.place_id,
                "name": f_item.place_name,
                "region": f_item.region,
                "lat": f_item.lat,
                "lon": f_item.lon,
                "zoom": 10.6,
                "pitch": 55.0,
                "bearing": 12.0,
                "admin_2025_unit": f_item.place_name,
            }

            narration_text = _compose_place_narration(f_item, req.tone, req.target_duration_sec)
            dur = _estimate_speaking_duration(narration_text)

            target_cam = CameraSpec(
                center=[float(p_meta["lon"]), float(p_meta["lat"])],
                zoom=float(p_meta.get("zoom", 10.5)),
                pitch=float(p_meta.get("pitch", 54.0)),
                bearing=float(p_meta.get("bearing", 12.0)),
            )

            overlay = _select_overlay_for_weather(f_item)

            scenes.append(
                SceneItem(
                    scene_id=f"scene_{f_item.place_id}_{order_idx}",
                    order_index=order_idx,
                    title=f"Dự báo: {f_item.place_name}",
                    start_time=round(current_time, 2),
                    end_time=round(current_time + dur, 2),
                    duration_sec=dur,
                    narration=narration_text,
                    subtitle=narration_text,
                    location=LocationInfo(
                        place_id=f_item.place_id,
                        name=f_item.place_name,
                        region=f_item.region,
                        lat=f_item.lat,
                        lon=f_item.lon,
                        admin_2025_unit=p_meta.get("admin_2025_unit", f_item.place_name),
                    ),
                    camera=target_cam,
                    camera_start=prev_camera,
                    weather_overlay=overlay,
                    transition="flyTo" if req.camera_style in ("cinematic_fly", "dynamic_orbit") else "easeTo",
                    weather_data=f_item,
                )
            )
            prev_camera = target_cam
            current_time += dur
            order_idx += 1

        # Cảnh Kết thúc: Tổng kết & khuyến nghị dựa trên số liệu thực tế
        rainy_places = [
            f.place_name
            for f in forecasts
            if (f.precipitation_probability_pct is not None and f.precipitation_probability_pct >= 60)
            or (f.precipitation_mm is not None and f.precipitation_mm >= 5.0)
        ]
        hot_places = [
            f.place_name
            for f in forecasts
            if f.temp_max_c is not None and f.temp_max_c >= 35.0
        ]

        outro_parts = ["Tổng kết bản tin:"]
        if rainy_places:
            outro_parts.append(
                f"Người dân tại {', '.join(rainy_places[:3])} lưu ý chuẩn bị áo mưa và theo dõi sát tình hình mưa."
            )
        elif hot_places:
            outro_parts.append(
                f"Khu vực {', '.join(hot_places[:3])} có mức nhiệt khá cao, quý vị lưu ý bổ sung nước và chống nắng."
            )
        else:
            outro_parts.append(
                "Thời tiết tại các khu vực nhìn chung thuận lợi cho các hoạt động sinh hoạt và giao thông."
            )
        outro_parts.append(
            "Để cập nhật các bản tin cảnh báo thiên tai chính thức, quý vị vui lòng tra cứu tại Trung tâm Dự báo Khí tượng Thủy văn Quốc gia. Xin kính chào và hẹn gặp lại."
        )
        outro_narration = " ".join(outro_parts)
        if req.tone == "concise":
            outro_narration = (
                "Cảm ơn quý vị đã theo dõi bản tin thời tiết từ dữ liệu Open-Meteo. "
                "Tra cứu cảnh báo chính thức tại Trung tâm Dự báo Khí tượng Thủy văn Quốc gia."
            )

        outro_dur = _estimate_speaking_duration(outro_narration)
        outro_cam = CameraSpec(
            center=[vn_preset["lon"], vn_preset["lat"]],
            zoom=vn_preset["zoom"],
            pitch=32.0,
            bearing=0.0,
        )
        scenes.append(
            SceneItem(
                scene_id="scene_outro",
                order_index=order_idx,
                title="Tổng kết & Khuyến nghị an toàn",
                start_time=round(current_time, 2),
                end_time=round(current_time + outro_dur, 2),
                duration_sec=outro_dur,
                narration=outro_narration,
                subtitle=outro_narration,
                location=LocationInfo(
                    place_id="vietnam_overview",
                    name="Toàn cảnh Việt Nam",
                    region="all",
                    lat=vn_preset["lat"],
                    lon=vn_preset["lon"],
                    admin_2025_unit="Toàn quốc",
                ),
                camera=outro_cam,
                camera_start=prev_camera,
                weather_overlay="overview",
                transition="flyTo",
                weather_data=forecasts[0] if forecasts else None,
            )
        )
        current_time += outro_dur

        generator_used = "controlled_broadcast_template_v2 (Dữ liệu thật 100%)"
        if settings.llm_provider != "none" and settings.llm_api_key:
            llm_enhanced = await self._try_llm_polish(scenes, req.tone)
            if llm_enhanced:
                generator_used = f"llm_adapter ({settings.llm_provider}:{settings.llm_model})"

        return ScriptGenerationResponse(
            title=f"Bản tin Dự báo Thời tiết Việt Nam ({date_display})",
            scope=req.scope,
            forecast_date=forecast_date,
            tone=req.tone,
            generator_used=generator_used,
            total_estimated_duration_sec=round(current_time, 2),
            data_source_summary=(
                f"Open-Meteo Forecast API ({len(forecasts)} điểm đo thực tế) | "
                f"Tham chiếu cảnh báo chính thức: NCHMF ({settings.nchmf_reference_url})"
            ),
            scenes=scenes,
        )

    async def _try_llm_polish(self, scenes: List[SceneItem], tone: str) -> bool:
        """Optional LLM adapter configured via environment variables without exposing keys."""
        if settings.llm_provider == "gemini" and settings.llm_api_key:
            try:
                url = f"{settings.llm_base_url}/models/{settings.llm_model}:generateContent"
                headers = {"x-goog-api-key": settings.llm_api_key, "Content-Type": "application/json"}
                for scene in scenes:
                    prompt = (
                        "Bạn là biên tập viên thời tiết truyền hình Việt Nam. "
                        "Hãy viết lại câu lời dẫn sau cho mượt mà theo phong cách "
                        f"'{tone}', giữ NGUYÊN VẸN 100% các con số nhiệt độ, lượng mưa, xác suất mưa, gió, UV. "
                        "Tuyệt đối không thêm hoặc bịa bất kỳ số liệu hay cảnh báo bão/lũ nào không có trong bản gốc. "
                        "Chỉ trả về đúng câu lời dẫn (1-3 câu ngắn gọn):\n\n"
                        f"{scene.narration}"
                    )
                    async with httpx.AsyncClient(timeout=10.0) as client:
                        resp = await client.post(
                            url,
                            headers=headers,
                            json={"contents": [{"parts": [{"text": prompt}]}]},
                        )
                        if resp.status_code == 200:
                            data = resp.json()
                            candidates = data.get("candidates", [])
                            if candidates:
                                text = (
                                    candidates[0]
                                    .get("content", {})
                                    .get("parts", [{}])[0]
                                    .get("text", "")
                                    .strip()
                                )
                                if text:
                                    scene.narration = text
                                    scene.subtitle = text
                return True
            except Exception as exc:
                logger.warning("LLM adapter fallback về template có kiểm soát: %s", exc)
        return False


script_generator = ScriptGeneratorService()
