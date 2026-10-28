export type FactionId = string;

export interface MilitaryFaction {
  id: FactionId;
  name: string;
  short_name: string;
  color: string;
  secondary_color: string;
  commander: string;
  flag_icon: string;
  initial_manpower: number;
  current_manpower: number;
  infantry_count: number;
  artillery_count: number;
  tanks_count: number;
  aircraft_count: number;
  casualties: number;
}

export type UnitType =
  | 'infantry'
  | 'cavalry'
  | 'artillery'
  | 'armor'
  | 'headquarters'
  | 'naval'
  | 'air'
  | 'fortification';

export type UnitEchelon =
  | 'corps'
  | 'division'
  | 'brigade'
  | 'regiment'
  | 'battalion'
  | 'company';

export type UnitStatus =
  | 'active'
  | 'moving'
  | 'engaging'
  | 'defending'
  | 'fortified'
  | 'routing'
  | 'destroyed'
  | 'surrendered';

export interface MilitaryUnit {
  id: string;
  faction_id: FactionId;
  name: string;
  short_name: string;
  type: UnitType;
  echelon: UnitEchelon;
  coordinates: [number, number]; // [lng, lat]
  elevation_m?: number;
  strength_initial: number;
  strength_current: number;
  status: UnitStatus;
  facing_deg: number;
  waypoints?: Array<{ time: number; coords: [number, number] }>;
}

export type ArrowType =
  | 'main_thrust'
  | 'flanking'
  | 'encirclement'
  | 'feint'
  | 'artillery_barrage';

export interface TacticalArrowAction {
  id: string;
  faction_id: FactionId;
  name: string;
  path_coordinates: Array<[number, number]>;
  curve_type: 'bezier' | 'waypoint_polyline';
  arrow_type: ArrowType;
  color: string;
  stroke_width: number;
  start_time: number;
  end_time: number;
  dashed?: boolean;
  head_size?: number;
  label?: string;
}

export interface TerritorialPocket {
  id: string;
  faction_id: FactionId;
  name: string;
  polygon_coordinates: Array<[number, number]>;
  color: string;
  fill_opacity: number;
  stroke_color: string;
  stroke_width: number;
  dashed_stroke?: boolean;
  active_time_start: number;
  active_time_end: number;
}

export interface CombatEvent {
  id: string;
  name: string;
  coordinates: [number, number];
  event_type: 'artillery_strike' | 'breakthrough' | 'clash' | 'air_drop' | 'siege_tunnel';
  start_time: number;
  end_time: number;
  intensity: number; // 1 to 5
  description?: string;
}

export interface CameraWaypoint {
  center: [number, number]; // [lng, lat]
  zoom: number;
  pitch: number;
  bearing: number;
  duration_sec?: number;
  easing?: string;
}

export interface BattleTimelineStep {
  step_id: string;
  step_index: number;
  timestamp_label: string;
  title: string;
  phase_name: string;
  tactical_objective: string;
  camera: CameraWaypoint;
  start_time: number;
  end_time: number;
  duration_sec: number;
  narration_text: string;
  voice_audio?: string;
  active_unit_ids: string[];
  active_arrow_ids: string[];
  active_combat_ids: string[];
  active_territory_ids: string[];
  factions_status?: Record<
    FactionId,
    { current_manpower: number; casualties: number }
  >;
}

export interface BattleScenario {
  id: string;
  title: string;
  subtitle: string;
  historical_date_range: string;
  location_name: string;
  center: [number, number];
  default_zoom: number;
  default_pitch: number;
  default_bearing: number;
  terrain_elevation: boolean;
  map_style: string;
  factions: MilitaryFaction[];
  units: MilitaryUnit[];
  arrows: TacticalArrowAction[];
  territories: TerritorialPocket[];
  combat_events: CombatEvent[];
  timeline_steps: BattleTimelineStep[];
  total_duration_sec: number;
  output_file?: string;
}

export interface ScenarioRenderProgress {
  scenario_id: string;
  status: 'idle' | 'preparing_audio' | 'syncing_timeline' | 'rendering_map' | 'encoding_video' | 'completed' | 'failed';
  progress_pct: number;
  current_step: string;
  frames_rendered: number;
  total_frames: number;
  error_message?: string;
  output_file?: string;
  download_url?: string;
}
