import asyncio
import logging
import math
import struct
import subprocess
import wave
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import edge_tts

from backend.config import settings
from backend.models import SceneItem

logger = logging.getLogger("weathercast.tts")

AVAILABLE_VOICES = [
    {
        "id": "vi-VN-HoaiMyNeural",
        "name": "Hoài My (Nữ - Biên tập viên Truyền hình)",
        "gender": "Female",
        "provider": "Edge Neural TTS (vi-VN)",
    },
    {
        "id": "vi-VN-NamMinhNeural",
        "name": "Nam Minh (Nam - Biên tập viên Truyền hình)",
        "gender": "Male",
        "provider": "Edge Neural TTS (vi-VN)",
    },
]


def probe_audio_duration(file_path: Path) -> float:
    """Get exact audio duration in seconds using ffprobe."""
    try:
        cmd = [
            settings.ffprobe_binary,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=15)
        val = float(res.stdout.strip())
        if val > 0.1:
            return round(val, 3)
    except Exception as exc:
        logger.warning("ffprobe duration fallback cho %s: %s", file_path, exc)

    if file_path.suffix.lower() == ".wav" and file_path.exists():
        try:
            with wave.open(str(file_path), "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate()
                return round(frames / float(rate), 3)
        except Exception:
            pass
    return 5.0


def _generate_fallback_wav(output_wav: Path, duration_sec: float = 5.0) -> None:
    """Fallback WAV generator if offline and Edge TTS cannot be reached."""
    sample_rate = 24000
    n_samples = int(sample_rate * duration_sec)
    with wave.open(str(output_wav), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        buf = bytearray()
        for i in range(n_samples):
            t = i / sample_rate
            env = min(1.0, t * 4.0) * min(1.0, (duration_sec - t) * 4.0)
            sample = int(1200 * env * math.sin(2.0 * math.pi * 440.0 * t))
            buf.extend(struct.pack("<h", sample))
        wf.writeframes(bytes(buf))


def generate_ambient_bgm_wav(output_wav: Path, duration_sec: float) -> Path:
    """
    Generate a soft, broadcast-grade ambient weather background pad (warm Cmaj9 chord)
    at a low volume so voice narration remains crystal-clear.
    """
    sample_rate = 24000
    total_samples = int(sample_rate * max(1.0, duration_sec))
    freqs = [130.81, 196.00, 246.94, 293.66, 329.63]  # C3, G3, B3, D4, E4

    with wave.open(str(output_wav), "w") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        chunk_data = bytearray()
        for i in range(total_samples):
            t = i / sample_rate
            fade_in = min(1.0, t / 1.5)
            fade_out = min(1.0, max(0.0, (duration_sec - t) / 2.0))
            lfo = 0.85 + 0.15 * math.sin(2.0 * math.pi * 0.25 * t)
            val = 0.0
            for idx, f in enumerate(freqs):
                val += math.sin(2.0 * math.pi * f * t + idx * 0.4) * (0.35 / len(freqs))
            # Delicate chime pulse every 4 seconds
            beat_phase = t % 4.0
            chime = math.exp(-beat_phase * 3.5) * math.sin(2.0 * math.pi * 523.25 * t) * 0.06
            sample = int(32767 * (val * lfo + chime) * fade_in * fade_out * 0.18)
            sample = max(-32767, min(32767, sample))
            chunk_data.extend(struct.pack("<h", sample))
        wf.writeframes(bytes(chunk_data))
    return output_wav


def _format_srt_time(seconds: float) -> str:
    ms = int(round((seconds - int(seconds)) * 1000))
    total_sec = int(seconds)
    s = total_sec % 60
    m = (total_sec // 60) % 60
    h = total_sec // 3600
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def split_subtitle_chunks(text: str, start_time: float, end_time: float) -> List[Dict[str, Any]]:
    """Split a scene narration into natural TV subtitle chunks timed proportionally by word count."""
    words = text.strip().split()
    if not words:
        return []
    total_dur = max(0.5, end_time - start_time)
    max_words_per_chunk = 16
    chunks_words: List[List[str]] = []
    current: List[str] = []

    for w in words:
        current.append(w)
        if len(current) >= max_words_per_chunk or (len(current) >= 8 and w.endswith((".", ",", ";", ":"))):
            chunks_words.append(current)
            current = []
    if current:
        if chunks_words and len(current) <= 4:
            chunks_words[-1].extend(current)
        else:
            chunks_words.append(current)

    total_words = sum(len(c) for c in chunks_words)
    result = []
    cursor = start_time
    for idx, c_words in enumerate(chunks_words):
        ratio = len(c_words) / float(total_words)
        c_dur = total_dur * ratio
        c_end = end_time if idx == len(chunks_words) - 1 else cursor + c_dur
        result.append(
            {
                "start_time": round(cursor, 3),
                "end_time": round(c_end, 3),
                "text": " ".join(c_words),
            }
        )
        cursor = c_end
    return result


class TTSService:
    async def synthesize_scene_audio(
        self,
        text: str,
        output_path: Path,
        voice_id: str = "vi-VN-HoaiMyNeural",
        rate: str = "+0%",
    ) -> Tuple[Path, float, str]:
        """
        Synthesize Vietnamese speech for a single scene and return:
        (audio_file_path, exact_duration_sec, engine_used)
        """
        output_path.parent.mkdir(parents=True, exist_ok=True)
        clean_rate = rate.strip() if rate else "+0%"
        if not clean_rate.startswith(("+", "-")):
            clean_rate = f"+{clean_rate}"
        if not clean_rate.endswith("%"):
            clean_rate = f"{clean_rate}%"

        last_err: Optional[Exception] = None
        for attempt in range(1, 3):
            try:
                communicate = edge_tts.Communicate(text=text, voice=voice_id, rate=clean_rate)
                await communicate.save(str(output_path))
                if output_path.exists() and output_path.stat().st_size > 256:
                    dur = probe_audio_duration(output_path)
                    # Add a tiny 0.25s broadcast breathing pause at the end of each scene
                    return output_path, round(dur + 0.25, 3), f"edge-tts ({voice_id})"
            except Exception as exc:
                last_err = exc
                logger.warning("Edge TTS thử lần %d thất bại: %s", attempt, exc)
                await asyncio.sleep(0.5)

        logger.error("Edge TTS không khả dụng (%s), sử dụng fallback WAV", last_err)
        est_dur = max(4.0, round(len(text.split()) / 3.1, 2))
        wav_fallback = output_path.with_suffix(".wav")
        _generate_fallback_wav(wav_fallback, duration_sec=est_dur)
        return wav_fallback, est_dur, "fallback_wav_offline"

    async def synthesize_project_scenes(
        self,
        project_id: str,
        scenes: List[SceneItem],
        voice_id: str,
        voice_rate: str,
        enable_bgm: bool = True,
    ) -> Dict[str, Any]:
        """
        Generate TTS audio for every scene, recalculate exact scene start_time and end_time
        from real audio durations, build master audio track (with optional BGM), and write SRT file.
        """
        project_dir = settings.output_dir / f"project_{project_id}"
        project_dir.mkdir(parents=True, exist_ok=True)

        current_time = 0.0
        scene_audio_files: List[Tuple[Path, float]] = []
        engines_used = set()
        all_sub_chunks: List[Dict[str, Any]] = []

        for idx, scene in enumerate(scenes):
            raw_mp3 = project_dir / f"scene_{idx:02d}.mp3"
            audio_file, exact_dur, engine = await self.synthesize_scene_audio(
                text=scene.narration,
                output_path=raw_mp3,
                voice_id=voice_id,
                rate=voice_rate,
            )
            engines_used.add(engine)

            # Normalize each scene audio to 24kHz mono WAV with a 0.25s tail pad so concatenation is frame-accurate
            norm_wav = project_dir / f"scene_{idx:02d}_padded.wav"
            pad_cmd = [
                settings.ffmpeg_binary,
                "-y",
                "-i",
                str(audio_file),
                "-af",
                "apad=pad_dur=0.25",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(norm_wav),
            ]
            subprocess.run(pad_cmd, capture_output=True, check=True, timeout=30)
            measured_dur = probe_audio_duration(norm_wav)

            scene.start_time = round(current_time, 3)
            scene.duration_sec = round(measured_dur, 3)
            scene.end_time = round(current_time + measured_dur, 3)
            scene.voice_audio = f"/api/projects/{project_id}/media/{norm_wav.name}"

            chunks = split_subtitle_chunks(scene.subtitle or scene.narration, scene.start_time, scene.end_time)
            all_sub_chunks.extend(chunks)

            scene_audio_files.append((norm_wav, measured_dur))
            current_time += measured_dur

        total_duration = round(current_time, 3)

        # Write concat list for FFmpeg
        concat_txt = project_dir / "audio_concat.txt"
        with open(concat_txt, "w", encoding="utf-8") as f:
            for wav_path, _ in scene_audio_files:
                safe_p = str(wav_path.resolve()).replace("\\", "/")
                f.write(f"file '{safe_p}'\n")

        voice_master_wav = project_dir / "master_voice.wav"
        concat_cmd = [
            settings.ffmpeg_binary,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_txt),
            "-c:a",
            "pcm_s16le",
            str(voice_master_wav),
        ]
        subprocess.run(concat_cmd, capture_output=True, check=True, timeout=60)

        final_audio_wav = voice_master_wav
        if enable_bgm:
            bgm_wav = project_dir / "ambient_bgm.wav"
            generate_ambient_bgm_wav(bgm_wav, total_duration)
            mixed_wav = project_dir / "master_mixed.wav"
            mix_cmd = [
                settings.ffmpeg_binary,
                "-y",
                "-i",
                str(voice_master_wav),
                "-i",
                str(bgm_wav),
                "-filter_complex",
                "[0:a]volume=1.0[v];[1:a]volume=0.22[b];[v][b]amix=inputs=2:duration=first:dropout_transition=2[out]",
                "-map",
                "[out]",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(mixed_wav),
            ]
            subprocess.run(mix_cmd, capture_output=True, check=True, timeout=60)
            final_audio_wav = mixed_wav

        # Write SRT file
        srt_path = project_dir / "subtitles.srt"
        with open(srt_path, "w", encoding="utf-8") as f:
            for s_idx, ch in enumerate(all_sub_chunks, start=1):
                f.write(f"{s_idx}\n")
                f.write(f"{_format_srt_time(ch['start_time'])} --> {_format_srt_time(ch['end_time'])}\n")
                f.write(f"{ch['text']}\n\n")

        return {
            "total_duration_sec": probe_audio_duration(final_audio_wav),
            "master_audio_path": str(final_audio_wav),
            "master_audio_url": f"/api/projects/{project_id}/media/{final_audio_wav.name}",
            "srt_path": str(srt_path),
            "srt_url": f"/api/projects/{project_id}/media/{srt_path.name}",
            "subtitle_chunks": all_sub_chunks,
            "tts_engines": list(engines_used),
        }


tts_service = TTSService()
