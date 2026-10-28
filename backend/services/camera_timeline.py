import math
from typing import List, Dict, Any
from backend.models import CameraSpec, SceneItem


def ease_in_out_cubic(x: float) -> float:
    x = max(0.0, min(1.0, x))
    return 4.0 * x * x * x if x < 0.5 else 1.0 - pow(-2.0 * x + 2.0, 3) / 2.0


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp_angle_deg(a: float, b: float, t: float) -> float:
    diff = ((b - a + 180.0) % 360.0) - 180.0
    return a + diff * t


class CameraTimelineService:
    def synchronize_scenes_timeline(
        self,
        scenes: List[SceneItem],
        camera_style: str = "cinematic_fly",
    ) -> List[SceneItem]:
        """
        Ensure continuous start_time/end_time chain and link each scene's camera_start
        to the previous scene's final camera state so transitions are seamless.
        """
        cursor = 0.0
        prev_cam: CameraSpec | None = None

        for idx, scene in enumerate(scenes):
            dur = max(2.0, float(scene.duration_sec or (scene.end_time - scene.start_time) or 6.0))
            scene.order_index = idx
            scene.start_time = round(cursor, 3)
            scene.duration_sec = round(dur, 3)
            scene.end_time = round(cursor + dur, 3)

            if prev_cam is not None:
                scene.camera_start = CameraSpec(
                    center=list(prev_cam.center),
                    zoom=prev_cam.zoom,
                    pitch=prev_cam.pitch,
                    bearing=prev_cam.bearing,
                )
            elif scene.camera_start is None:
                scene.camera_start = CameraSpec(
                    center=list(scene.camera.center),
                    zoom=max(4.5, scene.camera.zoom - 0.8),
                    pitch=max(20.0, scene.camera.pitch - 15.0),
                    bearing=scene.camera.bearing - 10.0,
                )

            if camera_style == "direct_pan":
                scene.transition = "easeTo"
            elif camera_style == "broadcast_smooth":
                scene.transition = "smooth_pan"
            elif camera_style == "dynamic_orbit":
                scene.transition = "cinematic_arc"
            else:
                scene.transition = "flyTo"

            prev_cam = CameraSpec(
                center=list(scene.camera.center),
                zoom=scene.camera.zoom,
                pitch=scene.camera.pitch,
                bearing=scene.camera.bearing,
            )
            cursor = scene.end_time

        return scenes

    def compute_camera_frame(
        self,
        scenes: List[SceneItem],
        time_sec: float,
        camera_style: str = "cinematic_fly",
    ) -> Dict[str, Any]:
        """
        Compute the exact camera parameters (center, zoom, pitch, bearing) and active scene
        at any timestamp `time_sec` (seconds).
        """
        if not scenes:
            return {
                "center": [106.8, 16.2],
                "zoom": 5.3,
                "pitch": 35.0,
                "bearing": 0.0,
                "scene_index": 0,
                "scene_id": "none",
                "weather_overlay": "overview",
            }

        active_scene = scenes[-1]
        active_idx = len(scenes) - 1
        for idx, sc in enumerate(scenes):
            if sc.start_time <= time_sec <= sc.end_time or idx == len(scenes) - 1:
                if time_sec <= sc.end_time:
                    active_scene = sc
                    active_idx = idx
                    break

        dur = max(0.1, active_scene.end_time - active_scene.start_time)
        local_t = max(0.0, min(dur, time_sec - active_scene.start_time))
        progress = local_t / dur

        cam_from = active_scene.camera_start or active_scene.camera
        cam_to = active_scene.camera

        # Flight phase occupies the first ~35% of the scene (capped between 1.6s and 3.4s)
        flight_sec = min(3.4, max(1.6, dur * 0.38))
        flight_ratio = min(0.55, flight_sec / dur)

        lon0, lat0 = cam_from.center[0], cam_from.center[1]
        lon1, lat1 = cam_to.center[0], cam_to.center[1]
        dist_deg = math.hypot(lon1 - lon0, lat1 - lat0)

        if progress <= flight_ratio:
            u = ease_in_out_cubic(progress / max(0.01, flight_ratio))
            lon = lerp(lon0, lon1, u)
            lat = lerp(lat0, lat1, u)

            base_zoom = lerp(cam_from.zoom, cam_to.zoom, u)
            # Parabolic zoom-out dip when flying across long geographic distances
            arc_dip = 0.0
            if camera_style in ("cinematic_fly", "dynamic_orbit") and dist_deg > 1.2:
                arc_dip = min(2.6, dist_deg * 0.28) * math.sin(math.pi * u)
            zoom = max(4.2, base_zoom - arc_dip)

            pitch = lerp(cam_from.pitch, cam_to.pitch, u)
            bearing = lerp_angle_deg(cam_from.bearing, cam_to.bearing, u)
        else:
            # Subtle cinematic hover & orbit while narrator speaks about the location
            hover_u = (progress - flight_ratio) / max(0.01, 1.0 - flight_ratio)
            lon = lon1
            lat = lat1
            zoom_drift = 0.22 * hover_u if camera_style != "direct_pan" else 0.08 * hover_u
            orbit_deg = 7.5 * hover_u if camera_style == "dynamic_orbit" else 3.5 * hover_u
            pitch_wave = 2.0 * math.sin(math.pi * hover_u)

            zoom = min(14.5, cam_to.zoom + zoom_drift)
            pitch = max(0.0, min(75.0, cam_to.pitch + pitch_wave))
            bearing = cam_to.bearing + orbit_deg

        return {
            "center": [round(lon, 5), round(lat, 5)],
            "zoom": round(zoom, 3),
            "pitch": round(pitch, 2),
            "bearing": round(bearing, 2),
            "scene_index": active_idx,
            "scene_id": active_scene.scene_id,
            "scene_title": active_scene.title,
            "weather_overlay": active_scene.weather_overlay,
            "location": active_scene.location.model_dump(),
        }


camera_timeline_service = CameraTimelineService()
