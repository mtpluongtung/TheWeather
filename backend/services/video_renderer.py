import asyncio
import json
import logging
import re
import subprocess
import threading
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
import httpx
from playwright.async_api import async_playwright

from backend.config import settings
from backend.database import db
from backend.models import SceneItem
from backend.services.camera_timeline import camera_timeline_service
from backend.services.tts import tts_service

logger = logging.getLogger("weathercast.renderer")
VN_TZ = timezone(timedelta(hours=7))


def resolve_dimensions(aspect_ratio: str, resolution: str) -> Tuple[int, int]:
    is_1080 = resolution == "1080p"
    if aspect_ratio == "9:16":
        return (1080, 1920) if is_1080 else (720, 1280)
    if aspect_ratio == "1:1":
        return (1080, 1080) if is_1080 else (720, 720)
    # Default 16:9
    return (1920, 1080) if is_1080 else (1280, 720)


def slugify_filename(text: str) -> str:
    clean = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE).strip().lower()
    clean = re.sub(r"[-\s]+", "_", clean)
    return clean[:48] or "vietnam"


def verify_mp4_file(mp4_path: Path) -> Dict[str, Any]:
    """Use ffprobe to verify that the generated MP4 file exists, has H.264 video, AAC audio, and valid duration."""
    if not mp4_path.exists() or mp4_path.stat().st_size < 1024:
        raise RuntimeError(f"File MP4 không tồn tại hoặc kích thước không hợp lệ: {mp4_path}")

    cmd = [
        settings.ffprobe_binary,
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,bit_rate:stream=codec_name,codec_type,width,height,r_frame_rate",
        "-of",
        "json",
        str(mp4_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=20)
    info = json.loads(res.stdout)

    streams = info.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if not video_stream:
        raise RuntimeError("File MP4 thiếu luồng video hợp lệ.")
    if not audio_stream:
        raise RuntimeError("File MP4 thiếu luồng âm thanh (AAC) hợp lệ.")

    fmt = info.get("format", {})
    duration = float(fmt.get("duration", 0.0))
    if duration <= 0.5:
        raise RuntimeError(f"Thời lượng video quá ngắn hoặc lỗi: {duration}s")

    return {
        "file_name": mp4_path.name,
        "file_size_bytes": int(fmt.get("size", mp4_path.stat().st_size)),
        "duration_sec": round(duration, 2),
        "video_codec": video_stream.get("codec_name"),
        "audio_codec": audio_stream.get("codec_name"),
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "r_frame_rate": video_stream.get("r_frame_rate"),
    }


class VideoRendererService:
    def __init__(self) -> None:
        self._render_lock = asyncio.Semaphore(settings.max_concurrent_renders)
        self._active_projects: set[str] = set()

    def is_rendering(self, project_id: str) -> bool:
        return project_id in self._active_projects

    async def _detect_frontend_base_url(self) -> str:
        """Check if Vite dev server is running; otherwise fall back to FastAPI's built-in static server."""
        candidates = [
            settings.frontend_url.rstrip("/"),
            f"http://{settings.app_host}:{settings.app_port}",
            "http://127.0.0.1:5173",
            "http://127.0.0.1:8000",
        ]
        async with httpx.AsyncClient(timeout=2.5) as client:
            for url in candidates:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200 and "<div id=\"root\">" in resp.text:
                        return url
                except Exception:
                    continue
        return settings.frontend_url.rstrip("/")

    async def prepare_preview_timeline(self, project_id: str) -> Dict[str, Any]:
        """
        Generate TTS audio for all scenes, measure exact audio durations, and synchronize
        the camera timeline so the user can preview the exact synchronized journey in the browser.
        """
        project = db.get_project(project_id)
        if not project:
            raise ValueError(f"Không tìm thấy dự án '{project_id}'")

        self._update_state(project_id, "preparing_audio", 15.0, "Đang tạo giọng đọc tiếng Việt (TTS) cho từng phân cảnh...")
        scenes = [SceneItem(**s) for s in project.get("scenes", [])]
        if not scenes:
            raise ValueError("Dự án chưa có phân cảnh nào để tạo bản xem trước.")

        tts_info = await tts_service.synthesize_project_scenes(
            project_id=project_id,
            scenes=scenes,
            voice_id=project.get("voice_id", settings.default_tts_voice),
            voice_rate=project.get("voice_rate", settings.default_tts_rate),
            enable_bgm=bool(project.get("enable_bgm", True)),
        )

        self._update_state(project_id, "syncing_timeline", 80.0, "Đang đồng bộ hành trình camera với thời lượng âm thanh thực tế...")
        synced_scenes = camera_timeline_service.synchronize_scenes_timeline(
            scenes=scenes,
            camera_style=project.get("camera_style", "cinematic_fly"),
        )

        project["scenes"] = [s.model_dump() for s in synced_scenes]
        project["audio_info"] = tts_info
        project["total_duration_sec"] = tts_info["total_duration_sec"]
        project["progress"] = {
            "project_id": project_id,
            "status": "idle",
            "progress_pct": 100.0,
            "current_step": f"Đã đồng bộ giọng đọc & camera ({tts_info['total_duration_sec']:.1f}s)",
            "frames_rendered": 0,
            "total_frames": 0,
            "output_file": project.get("output_file"),
            "download_url": f"/api/projects/{project_id}/download" if project.get("output_file") else None,
        }
        db.save_project(project)
        return project

    def _update_state(
        self,
        project_id: str,
        status: str,
        progress_pct: float,
        step_msg: str,
        frames_rendered: int = 0,
        total_frames: int = 0,
        error_message: Optional[str] = None,
        output_file: Optional[str] = None,
        video_metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        progress = {
            "project_id": project_id,
            "status": status,
            "progress_pct": round(progress_pct, 1),
            "current_step": step_msg,
            "frames_rendered": frames_rendered,
            "total_frames": total_frames,
            "error_message": error_message,
            "output_file": output_file,
            "download_url": f"/api/projects/{project_id}/download" if output_file else None,
            "video_metadata": video_metadata,
        }
        db.update_progress(project_id, progress, output_file=output_file)

    async def render_project_mp4(self, project_id: str) -> Dict[str, Any]:
        """Full 13-step broadcast video rendering pipeline using Playwright Chromium + MapLibre GL JS + FFmpeg."""
        if project_id in self._active_projects:
            raise RuntimeError("Dự án này đang trong quá trình render. Vui lòng đợi tiến trình hiện tại hoàn tất.")

        async with self._render_lock:
            self._active_projects.add(project_id)
            try:
                return await self._execute_render_pipeline(project_id)
            except Exception as exc:
                logger.exception("Lỗi trong quá trình render dự án %s", project_id)
                err_msg = str(exc).strip() or exc.__class__.__name__
                self._update_state(
                    project_id,
                    status="failed",
                    progress_pct=0.0,
                    step_msg=f"Lỗi render: {err_msg}",
                    error_message=err_msg,
                )
                raise
            finally:
                self._active_projects.discard(project_id)

    async def _execute_render_pipeline(self, project_id: str) -> Dict[str, Any]:
        project = db.get_project(project_id)
        if not project:
            raise ValueError(f"Không tìm thấy dự án '{project_id}'")

        # Step 1-4: Generate TTS audio & measure exact timestamps
        self._update_state(
            project_id,
            status="preparing_audio",
            progress_pct=8.0,
            step_msg="Bước 1/4: Đang tổng hợp giọng đọc tiếng Việt (TTS) và phụ đề...",
        )
        scenes = [SceneItem(**s) for s in project.get("scenes", [])]
        if not scenes:
            raise ValueError("Dự án không có phân cảnh nào để xuất video.")

        tts_info = await tts_service.synthesize_project_scenes(
            project_id=project_id,
            scenes=scenes,
            voice_id=project.get("voice_id", settings.default_tts_voice),
            voice_rate=project.get("voice_rate", settings.default_tts_rate),
            enable_bgm=bool(project.get("enable_bgm", True)),
        )

        # Step 5: Build synchronized camera timeline
        self._update_state(
            project_id,
            status="syncing_timeline",
            progress_pct=20.0,
            step_msg="Bước 2/4: Đang đồng bộ đường bay camera 3D khớp với thời lượng âm thanh...",
        )
        synced_scenes = camera_timeline_service.synchronize_scenes_timeline(
            scenes=scenes,
            camera_style=project.get("camera_style", "cinematic_fly"),
        )
        project["scenes"] = [s.model_dump() for s in synced_scenes]
        project["audio_info"] = tts_info
        total_duration = min(float(settings.max_render_duration_sec), float(tts_info["total_duration_sec"]))
        project["total_duration_sec"] = total_duration
        db.save_project(project)

        width, height = resolve_dimensions(
            project.get("aspect_ratio", "16:9"),
            project.get("resolution", "720p"),
        )
        output_fps = int(project.get("fps", settings.render_fps))
        # Capture rate: 20 unique WebGL frames/sec upsampled cleanly to 30 FPS H.264 for fast, fluid rendering
        capture_fps = 20 if total_duration > 20 else output_fps
        total_frames = max(1, int(round(total_duration * capture_fps)))

        base_url = await self._detect_frontend_base_url()
        render_url = f"{base_url}/?renderMode=1&projectId={project_id}"
        logger.info("Mở trình duyệt render MapLibre tại: %s (%dx%d @ %dfps)", render_url, width, height, output_fps)

        self._update_state(
            project_id,
            status="rendering_map",
            progress_pct=25.0,
            step_msg="Bước 3/4: Đang khởi động Chromium & tải bản đồ địa lý thật MapLibre GL JS...",
            frames_rendered=0,
            total_frames=total_frames,
        )

        project_dir = settings.output_dir / f"project_{project_id}"
        project_dir.mkdir(parents=True, exist_ok=True)

        timestamp_str = datetime.now(VN_TZ).strftime("%Y%m%d_%H%M%S")
        place_slug = slugify_filename("_".join(project.get("place_ids", ["vietnam"])[:3]))
        ratio_slug = project.get("aspect_ratio", "16:9").replace(":", "x")
        final_mp4_name = f"weathercast_{place_slug}_{ratio_slug}_{project.get('resolution', '720p')}_{timestamp_str}.mp4"
        final_mp4_path = settings.output_dir / final_mp4_name

        master_audio_path = Path(tts_info["master_audio_path"])

        browser_args = [
            "--enable-webgl",
            "--ignore-gpu-blocklist",
            "--disable-gpu-sandbox",
            "--no-sandbox",
            "--disable-dev-shm-usage",
            f"--window-size={width},{height}",
        ]
        if settings.playwright_gl_backend == "swiftshader":
            browser_args.extend(["--use-gl=angle", "--use-angle=swiftshader"])
        else:
            browser_args.extend(["--use-gl=angle", "--use-angle=d3d11"])

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=settings.playwright_headless,
                args=browser_args,
            )
            context = await browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
            )
            page = await context.new_page()

            await page.goto(render_url, wait_until="domcontentloaded", timeout=45000)

            # Wait for MapLibre GL JS instance and project data to finish loading
            await page.wait_for_function("window.__WEATHERCAST_READY__ === true", timeout=45000)

            self._update_state(
                project_id,
                status="rendering_map",
                progress_pct=32.0,
                step_msg="Đang nạp trước các ô bản đồ (Map Tiles) dọc theo hành trình camera...",
                frames_rendered=0,
                total_frames=total_frames,
            )

            # Pre-warm tiles along all scenes so every flyTo frame has sharp tiles loaded
            try:
                await page.evaluate("window.__prewarmWeatherCastTiles__ && window.__prewarmWeatherCastTiles__()")
            except Exception as exc:
                logger.warning("Prewarm tiles warning: %s", exc)

            # Launch FFmpeg process reading JPEG frames from stdin and mixing with master TTS audio
            ffmpeg_cmd = [
                settings.ffmpeg_binary,
                "-y",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-framerate",
                str(capture_fps),
                "-i",
                "-",
                "-i",
                str(master_audio_path),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "20",
                "-pix_fmt",
                "yuv420p",
                "-r",
                str(output_fps),
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "44100",
                "-shortest",
                "-movflags",
                "+faststart",
                str(final_mp4_path),
            ]

            ffmpeg_proc = subprocess.Popen(
                ffmpeg_cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )

            stderr_chunks: list[bytes] = []

            def _drain_stderr() -> None:
                try:
                    if ffmpeg_proc.stderr:
                        while True:
                            chunk = ffmpeg_proc.stderr.read(4096)
                            if not chunk:
                                break
                            stderr_chunks.append(chunk)
                except Exception:
                    pass

            drain_thread = threading.Thread(target=_drain_stderr, daemon=True)
            drain_thread.start()

            try:
                for frame_idx in range(total_frames):
                    if ffmpeg_proc.poll() is not None:
                        err_tail = b"".join(stderr_chunks).decode("utf-8", errors="replace")[-500:]
                        raise RuntimeError(f"FFmpeg dừng đột ngột (mã thoát {ffmpeg_proc.returncode}): {err_tail}")

                    t_sec = frame_idx / float(capture_fps)
                    await page.evaluate(f"window.__seekWeatherCastFrame__({t_sec:.4f})")
                    frame_bytes = await page.screenshot(type="jpeg", quality=90, animations="allow")
                    if ffmpeg_proc.stdin:
                        await asyncio.to_thread(ffmpeg_proc.stdin.write, frame_bytes)

                    if frame_idx % max(1, total_frames // 20) == 0 or frame_idx == total_frames - 1:
                        pct = 35.0 + (frame_idx + 1) / float(total_frames) * 55.0
                        self._update_state(
                            project_id,
                            status="rendering_map",
                            progress_pct=pct,
                            step_msg=(
                                f"Bước 3/4: Đang quay bản đồ MapLibre 3D ({frame_idx + 1}/{total_frames} khung hình - "
                                f"{t_sec:.1f}s/{total_duration:.1f}s)..."
                            ),
                            frames_rendered=frame_idx + 1,
                            total_frames=total_frames,
                        )
            finally:
                if ffmpeg_proc.stdin:
                    try:
                        ffmpeg_proc.stdin.flush()
                        ffmpeg_proc.stdin.close()
                    except Exception:
                        pass
                await context.close()
                await browser.close()

            self._update_state(
                project_id,
                status="encoding_video",
                progress_pct=93.0,
                step_msg="Bước 4/4: FFmpeg đang đóng gói luồng H.264 + AAC và kiểm tra file MP4...",
                frames_rendered=total_frames,
                total_frames=total_frames,
            )

            await asyncio.to_thread(ffmpeg_proc.wait, timeout=120)
            drain_thread.join(timeout=5)
            if ffmpeg_proc.returncode != 0:
                stderr_bytes = b"".join(stderr_chunks)
                err_txt = stderr_bytes.decode("utf-8", errors="replace")[-600:]
                raise RuntimeError(f"FFmpeg trả về mã lỗi {ffmpeg_proc.returncode}: {err_txt}")

        # Step 12: Verify generated MP4 file with ffprobe
        video_meta = verify_mp4_file(final_mp4_path)

        project["output_file"] = final_mp4_name
        project["video_metadata"] = video_meta
        self._update_state(
            project_id,
            status="completed",
            progress_pct=100.0,
            step_msg=f"Hoàn tất! Video MP4 ({video_meta['width']}x{video_meta['height']}, {video_meta['duration_sec']}s) sẵn sàng tải xuống.",
            frames_rendered=total_frames,
            total_frames=total_frames,
            output_file=final_mp4_name,
            video_metadata=video_meta,
        )
        return db.get_project(project_id) or project


video_renderer_service = VideoRendererService()
