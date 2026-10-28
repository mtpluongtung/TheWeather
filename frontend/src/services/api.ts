import {
  BattleScenario,
  ScenarioRenderProgress,
} from '../types/military';
import {
  CameraPreset,
  HealthResponse,
  PlaceMeta,
  ProjectData,
  RenderProgress,
  SceneItem,
  WeatherForecastItem,
} from '../types/weathercast';

async function handleJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let errText = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body.detail) {
        errText = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
      }
    } catch {
      errText = await resp.text();
    }
    throw new Error(errText || `Lỗi máy chủ (${resp.status})`);
  }
  return resp.json() as Promise<T>;
}

export const api = {
  async getHealth(): Promise<HealthResponse> {
    const resp = await fetch('/api/health');
    return handleJson<HealthResponse>(resp);
  },

  async getPlaces(region?: string): Promise<{
    schema_version: string;
    last_updated: string;
    source_reference: string;
    admin_note: string;
    camera_presets: CameraPreset[];
    places: PlaceMeta[];
  }> {
    const q = region ? `?region=${encodeURIComponent(region)}` : '';
    const resp = await fetch(`/api/places${q}`);
    return handleJson(resp);
  },

  async getBoundaries(): Promise<GeoJSON.FeatureCollection> {
    const resp = await fetch('/api/boundaries');
    return handleJson<GeoJSON.FeatureCollection>(resp);
  },

  async getForecast(
    placeIds: string[],
    date?: string,
    refresh = false
  ): Promise<{
    count: number;
    fetched_at: string;
    timezone: string;
    source: string;
    official_reference_url: string;
    items: WeatherForecastItem[];
  }> {
    const params = new URLSearchParams({
      place: placeIds.join(','),
      refresh: String(refresh),
    });
    if (date) params.set('date', date);
    const resp = await fetch(`/api/forecast?${params.toString()}`);
    return handleJson(resp);
  },

  async getRadarMetadata(): Promise<{
    available: boolean;
    radar_tile_url: string | null;
    radar_timestamp?: number | null;
    satellite_tile_url: string | null;
    attribution: string;
  }> {
    const resp = await fetch('/api/radar');
    return handleJson(resp);
  },

  async createProject(payload: {
    name: string;
    scope: 'nationwide' | 'region' | 'custom_places';
    place_ids: string[];
    forecast_date?: string;
    target_duration_sec: number;
    aspect_ratio: '16:9' | '9:16' | '1:1';
    resolution: '720p' | '1080p';
    voice_id: string;
    voice_rate: string;
    tone: 'broadcast' | 'concise' | 'friendly' | 'detailed';
    camera_style: 'cinematic_fly' | 'broadcast_smooth' | 'dynamic_orbit' | 'direct_pan';
    map_provider: string;
    enable_3d_terrain: boolean;
    enable_subtitles: boolean;
    enable_bgm: boolean;
  }): Promise<ProjectData> {
    const resp = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleJson<ProjectData>(resp);
  },

  async getProject(projectId: string): Promise<ProjectData> {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
    return handleJson<ProjectData>(resp);
  },

  async updateProject(
    projectId: string,
    payload: Partial<{
      name: string;
      aspect_ratio: '16:9' | '9:16' | '1:1';
      resolution: '720p' | '1080p';
      voice_id: string;
      voice_rate: string;
      tone: 'broadcast' | 'concise' | 'friendly' | 'detailed';
      camera_style: 'cinematic_fly' | 'broadcast_smooth' | 'dynamic_orbit' | 'direct_pan';
      map_provider: string;
      enable_3d_terrain: boolean;
      enable_subtitles: boolean;
      enable_bgm: boolean;
      scenes: SceneItem[];
    }>
  ): Promise<ProjectData> {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return handleJson<ProjectData>(resp);
  },

  async preparePreview(projectId: string): Promise<ProjectData> {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/preview`, {
      method: 'POST',
    });
    return handleJson<ProjectData>(resp);
  },

  async startRender(projectId: string): Promise<{
    message: string;
    project_id: string;
    progress: RenderProgress;
  }> {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/render`, {
      method: 'POST',
    });
    return handleJson(resp);
  },

  async getRenderProgress(projectId: string): Promise<RenderProgress> {
    const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/progress`);
    return handleJson<RenderProgress>(resp);
  },

  // ==========================================
  // ⚔️ MILITARY HISTORY MAP SCENARIO METHODS
  // ==========================================

  async listScenarios(): Promise<{
    count: number;
    scenarios: Array<{
      id: string;
      title: string;
      subtitle: string;
      historical_date_range: string;
      location_name: string;
      total_duration_sec: number;
      timeline_steps_count: number;
      factions: any[];
      is_builtin: boolean;
      output_file?: string;
    }>;
  }> {
    const resp = await fetch('/api/scenarios');
    return handleJson(resp);
  },

  async getScenario(scenarioId: string): Promise<BattleScenario> {
    const resp = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}`);
    return handleJson<BattleScenario>(resp);
  },

  async saveScenario(scenario: BattleScenario): Promise<{
    message: string;
    scenario_id: string;
    scenario: BattleScenario;
  }> {
    const resp = await fetch('/api/scenarios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scenario),
    });
    return handleJson(resp);
  },

  async startScenarioRender(
    scenarioId: string,
    req?: {
      aspect_ratio?: '16:9' | '9:16' | '1:1';
      resolution?: '720p' | '1080p';
      fps?: number;
      voice_id?: string;
      voice_rate?: string;
      enable_bgm?: boolean;
      enable_subtitles?: boolean;
    }
  ): Promise<{
    message: string;
    scenario_id: string;
    progress: ScenarioRenderProgress;
  }> {
    const resp = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req || {}),
    });
    return handleJson(resp);
  },

  async getScenarioRenderProgress(scenarioId: string): Promise<ScenarioRenderProgress> {
    const resp = await fetch(`/api/scenarios/${encodeURIComponent(scenarioId)}/progress`);
    return handleJson<ScenarioRenderProgress>(resp);
  },
};
