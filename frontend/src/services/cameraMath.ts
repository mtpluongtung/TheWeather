import { CameraSpec, SceneItem, SubtitleChunk, WeatherOverlayType } from '../types/weathercast';

export function easeInOutCubic(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngleDeg(a: number, b: number, t: number): number {
  const diff = ((((b - a + 180) % 360) + 360) % 360) - 180;
  return a + diff * t;
}

export interface ComputedTimelineFrame {
  center: [number, number];
  zoom: number;
  pitch: number;
  bearing: number;
  sceneIndex: number;
  activeScene: SceneItem | null;
  weatherOverlay: WeatherOverlayType;
}

export function computeCameraAtTime(
  scenes: SceneItem[],
  timeSec: number,
  cameraStyle: string = 'cinematic_fly'
): ComputedTimelineFrame {
  if (!scenes || scenes.length === 0) {
    return {
      center: [106.8, 16.2],
      zoom: 5.3,
      pitch: 35,
      bearing: -8,
      sceneIndex: 0,
      activeScene: null,
      weatherOverlay: 'overview',
    };
  }

  let activeScene = scenes[scenes.length - 1];
  let activeIdx = scenes.length - 1;

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    if (timeSec <= sc.end_time || i === scenes.length - 1) {
      activeScene = sc;
      activeIdx = i;
      break;
    }
  }

  const dur = Math.max(0.1, activeScene.end_time - activeScene.start_time);
  const localT = Math.max(0, Math.min(dur, timeSec - activeScene.start_time));
  const progress = localT / dur;

  const camFrom: CameraSpec =
    activeScene.camera_start ||
    (activeIdx > 0 ? scenes[activeIdx - 1].camera : activeScene.camera);
  const camTo: CameraSpec = activeScene.camera;

  const flightSec = Math.min(3.4, Math.max(1.6, dur * 0.38));
  const flightRatio = Math.min(0.55, flightSec / dur);

  const [lon0, lat0] = camFrom.center;
  const [lon1, lat1] = camTo.center;
  const distDeg = Math.hypot(lon1 - lon0, lat1 - lat0);

  let lon = lon1;
  let lat = lat1;
  let zoom = camTo.zoom;
  let pitch = camTo.pitch;
  let bearing = camTo.bearing;

  if (progress <= flightRatio) {
    const u = easeInOutCubic(progress / Math.max(0.01, flightRatio));
    lon = lerp(lon0, lon1, u);
    lat = lerp(lat0, lat1, u);

    const baseZoom = lerp(camFrom.zoom, camTo.zoom, u);
    let arcDip = 0;
    if ((cameraStyle === 'cinematic_fly' || cameraStyle === 'dynamic_orbit') && distDeg > 1.2) {
      arcDip = Math.min(2.6, distDeg * 0.28) * Math.sin(Math.PI * u);
    }
    zoom = Math.max(4.2, baseZoom - arcDip);
    pitch = lerp(camFrom.pitch, camTo.pitch, u);
    bearing = lerpAngleDeg(camFrom.bearing, camTo.bearing, u);
  } else {
    const hoverU = (progress - flightRatio) / Math.max(0.01, 1.0 - flightRatio);
    lon = lon1;
    lat = lat1;
    const zoomDrift = cameraStyle !== 'direct_pan' ? 0.22 * hoverU : 0.08 * hoverU;
    const orbitDeg = cameraStyle === 'dynamic_orbit' ? 7.5 * hoverU : 3.5 * hoverU;
    const pitchWave = 2.0 * Math.sin(Math.PI * hoverU);

    zoom = Math.min(14.5, camTo.zoom + zoomDrift);
    pitch = Math.max(0, Math.min(75, camTo.pitch + pitchWave));
    bearing = camTo.bearing + orbitDeg;
  }

  return {
    center: [Number(lon.toFixed(5)), Number(lat.toFixed(5))],
    zoom: Number(zoom.toFixed(3)),
    pitch: Number(pitch.toFixed(2)),
    bearing: Number(bearing.toFixed(2)),
    sceneIndex: activeIdx,
    activeScene,
    weatherOverlay: activeScene.weather_overlay || 'temperature',
  };
}

export function findActiveSubtitle(
  scenes: SceneItem[],
  subtitleChunks: SubtitleChunk[] | undefined,
  timeSec: number
): string {
  if (subtitleChunks && subtitleChunks.length > 0) {
    const matched = subtitleChunks.find(
      (c) => timeSec >= c.start_time && timeSec <= c.end_time + 0.05
    );
    if (matched) return matched.text;
  }
  for (const sc of scenes) {
    if (timeSec >= sc.start_time && timeSec <= sc.end_time) {
      return sc.subtitle || sc.narration;
    }
  }
  return '';
}

export function formatTimeMMSS(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
