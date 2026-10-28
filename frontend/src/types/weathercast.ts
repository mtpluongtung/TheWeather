export interface CameraSpec {
  center: [number, number]; // [lon, lat]
  zoom: number;
  pitch: number;
  bearing: number;
}

export interface CameraPreset {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lon: number;
  zoom: number;
  pitch: number;
  bearing: number;
  description: string;
}

export interface PlaceMeta {
  id: string;
  name: string;
  full_name: string;
  region: 'north' | 'central' | 'highlands' | 'south' | 'all';
  region_label: string;
  admin_2025_unit: string;
  lat: number;
  lon: number;
  zoom: number;
  pitch: number;
  bearing: number;
  is_featured: boolean;
}

export interface HourlyForecastSlot {
  time_iso: string;
  time_label: string;
  hour: number;
  temperature_c: number;
  precipitation_probability_pct: number;
  precipitation_mm: number;
  wind_speed_kmh: number;
  wind_gusts_kmh: number;
  cape_jkg: number;
  weather_code: number;
  weather_label_vi: string;
  storm_squall_risk_pct: number;
  thunder_lightning_risk_pct: number;
  hazard_label: string;
}

export interface SevereWeatherSummary {
  max_wind_gust_kmh: number;
  max_wind_gust_time: string;
  beaufort_scale: string;
  max_cape_jkg: number;
  max_storm_squall_risk_pct: number;
  max_thunder_lightning_risk_pct: number;
  peak_temp_time: string;
  peak_rain_time: string;
  storm_alert_level: 'normal' | 'watch' | 'warning' | 'severe';
  summary_vi: string;
}

export interface WeatherForecastItem {
  place_id: string;
  place_name: string;
  region: string;
  lat: number;
  lon: number;
  admin_version: string;
  fetched_at: string;
  model_updated_at?: string | null;
  forecast_date: string;
  timezone: string;
  data_type: 'current_and_daily' | 'daily_forecast';
  temperature_c: number | null;
  apparent_temperature_c: number | null;
  temp_max_c: number | null;
  temp_min_c: number | null;
  relative_humidity_pct: number | null;
  precipitation_probability_pct: number | null;
  precipitation_mm: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg: number | null;
  wind_direction_label: string;
  uv_index: number | null;
  weather_code: number | null;
  weather_description_vi: string;
  official_warnings: string;
  model_advisory_note?: string | null;
  hourly_timeline?: HourlyForecastSlot[];
  severe_weather_summary?: SevereWeatherSummary | null;
  source_name: string;
  source_url: string;
  reference_agency_name: string;
  reference_agency_url: string;
  is_stale: boolean;
  data_status: string;
}

export type WeatherOverlayType =
  | 'overview'
  | 'temperature'
  | 'precipitation'
  | 'radar'
  | 'wind'
  | 'uv';

export interface SceneItem {
  scene_id: string;
  order_index: number;
  title: string;
  start_time: number;
  end_time: number;
  duration_sec: number;
  narration: string;
  voice_audio?: string | null;
  location: {
    place_id: string;
    name: string;
    region: string;
    lat: number;
    lon: number;
    admin_2025_unit?: string;
  };
  camera: CameraSpec;
  camera_start?: CameraSpec | null;
  weather_overlay: WeatherOverlayType;
  subtitle: string;
  transition: 'flyTo' | 'easeTo' | 'cinematic_arc' | 'smooth_pan';
  weather_data?: WeatherForecastItem | null;
}

export interface SubtitleChunk {
  start_time: number;
  end_time: number;
  text: string;
}

export interface AudioInfo {
  total_duration_sec: number;
  master_audio_path: string;
  master_audio_url: string;
  srt_path: string;
  srt_url: string;
  subtitle_chunks: SubtitleChunk[];
  tts_engines: string[];
}

export interface RenderProgress {
  project_id: string;
  status:
    | 'idle'
    | 'preparing_audio'
    | 'syncing_timeline'
    | 'rendering_map'
    | 'encoding_video'
    | 'completed'
    | 'failed';
  progress_pct: number;
  current_step: string;
  frames_rendered: number;
  total_frames: number;
  error_message?: string | null;
  output_file?: string | null;
  download_url?: string | null;
  video_metadata?: {
    file_name: string;
    file_size_bytes: number;
    duration_sec: number;
    video_codec: string;
    audio_codec: string;
    width: number;
    height: number;
    r_frame_rate: string;
  } | null;
  updated_at?: string | null;
}

export interface ProjectData {
  id: string;
  name: string;
  scope: 'nationwide' | 'region' | 'custom_places';
  place_ids: string[];
  forecast_date: string;
  target_duration_sec: number;
  total_duration_sec: number;
  aspect_ratio: '16:9' | '9:16' | '1:1';
  resolution: '720p' | '1080p';
  fps: number;
  voice_id: string;
  voice_rate: string;
  tone: 'broadcast' | 'concise' | 'friendly' | 'detailed';
  camera_style: 'cinematic_fly' | 'broadcast_smooth' | 'dynamic_orbit' | 'direct_pan';
  map_provider: string;
  enable_3d_terrain: boolean;
  enable_subtitles: boolean;
  enable_bgm: boolean;
  scenes: SceneItem[];
  audio_info?: AudioInfo;
  progress: RenderProgress;
  output_file?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface MapProviderMeta {
  id: string;
  name: string;
  type: 'vector' | 'raster';
  style_url?: string;
  tile_url?: string;
  attribution: string;
  requires_key: boolean;
  available: boolean;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  timezone: string;
  components: {
    ffmpeg_available: boolean;
    ffprobe_available: boolean;
    sqlite_db: string;
    places_count: number;
    admin_schema_version: string;
    llm_provider: string;
    llm_configured: boolean;
  };
  map_config: {
    default_provider: string;
    enable_real_3d_terrain: boolean;
    terrain_dem_source: {
      name: string;
      tiles: string[];
      encoding: 'terrarium' | 'mapbox';
      tileSize: number;
      maxzoom: number;
      attribution: string;
    };
    providers: Record<string, MapProviderMeta>;
  };
  voices: Array<{
    id: string;
    name: string;
    gender: string;
    provider: string;
  }>;
  weather_sources: {
    primary_forecast: { name: string; url: string; type: string };
    official_warning_reference: { name: string; url: string; type: string };
    radar_overlay: { name: string; url: string; type: string };
  };
}
