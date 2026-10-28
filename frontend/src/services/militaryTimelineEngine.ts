import {
  BattleScenario,
  BattleTimelineStep,
  CameraWaypoint,
  MilitaryFaction,
  MilitaryUnit,
  CombatEvent,
} from '../types/military';

export interface InterpolatedTimelineState {
  currentTimeSec: number;
  totalDurationSec: number;
  currentStepIndex: number;
  currentStep: BattleTimelineStep | null;
  camera: CameraWaypoint;
  factionsStatus: Record<string, { current_manpower: number; casualties: number }>;
  activeUnitIds: Set<string>;
  activeArrowIds: Set<string>;
  activeCombatEvents: CombatEvent[];
  activeTerritoryIds: Set<string>;
  subtitleText: string;
  phaseName: string;
  timestampLabel: string;
  tacticalObjective: string;
}

/**
 * Smooth cubic Hermite / ease-in-out interpolation factor between 0.0 and 1.0.
 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Linearly interpolates between two angles in degrees taking the shortest arc.
 */
export function lerpAngleDeg(a: number, b: number, t: number): number {
  let diff = (b - a) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

/**
 * Linearly interpolates two numbers.
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Interpolates full camera waypoint between fromCam and toCam with given easing.
 */
export function interpolateCamera(
  fromCam: CameraWaypoint,
  toCam: CameraWaypoint,
  fraction: number
): CameraWaypoint {
  const t = easeInOutCubic(Math.max(0, Math.min(1, fraction)));
  return {
    center: [
      lerp(fromCam.center[0], toCam.center[0], t),
      lerp(fromCam.center[1], toCam.center[1], t),
    ],
    zoom: lerp(fromCam.zoom, toCam.zoom, t),
    pitch: lerp(fromCam.pitch, toCam.pitch, t),
    bearing: lerpAngleDeg(fromCam.bearing, toCam.bearing, t),
  };
}

/**
 * Evaluates the full documentary tactical state of a scenario at a specific timestamp `timeSec`.
 */
export function evaluateTimelineAtTime(
  scenario: BattleScenario,
  timeSec: number
): InterpolatedTimelineState {
  const totalDuration = scenario.total_duration_sec || 60.0;
  const clampedTime = Math.max(0, Math.min(totalDuration, timeSec));
  const steps = scenario.timeline_steps;

  if (!steps || steps.length === 0) {
    const defaultCam: CameraWaypoint = {
      center: scenario.center,
      zoom: scenario.default_zoom,
      pitch: scenario.default_pitch,
      bearing: scenario.default_bearing,
    };
    return {
      currentTimeSec: clampedTime,
      totalDurationSec: totalDuration,
      currentStepIndex: 0,
      currentStep: null,
      camera: defaultCam,
      factionsStatus: {},
      activeUnitIds: new Set(scenario.units.map((u) => u.id)),
      activeArrowIds: new Set(),
      activeCombatEvents: [],
      activeTerritoryIds: new Set(),
      subtitleText: '',
      phaseName: scenario.subtitle,
      timestampLabel: scenario.historical_date_range,
      tacticalObjective: scenario.location_name,
    };
  }

  // Find active step
  let activeIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    if (clampedTime >= steps[i].start_time) {
      activeIdx = i;
    }
  }

  const currentStep = steps[activeIdx];
  const prevStep = activeIdx > 0 ? steps[activeIdx - 1] : null;

  // Calculate camera transition
  const stepStart = currentStep.start_time;
  const stepDur = Math.max(0.5, currentStep.duration_sec);
  const timeIntoStep = clampedTime - stepStart;

  // Transition camera during first 35% of the step duration
  const transDuration = Math.min(4.0, stepDur * 0.45);
  const camProgress = Math.min(1.0, timeIntoStep / transDuration);

  const startCam = prevStep ? prevStep.camera : {
    center: scenario.center,
    zoom: scenario.default_zoom,
    pitch: scenario.default_pitch,
    bearing: scenario.default_bearing,
  };

  const targetCam = currentStep.camera;
  const interpolatedCam = interpolateCamera(startCam, targetCam, camProgress);

  // Active units & arrows
  const activeUnitIds = new Set<string>(currentStep.active_unit_ids || []);
  const activeArrowIds = new Set<string>();
  for (const arrow of scenario.arrows) {
    if (clampedTime >= arrow.start_time && clampedTime <= arrow.end_time + 10.0) {
      activeArrowIds.add(arrow.id);
    }
  }

  // Active combat events
  const activeCombatEvents: CombatEvent[] = [];
  for (const combat of scenario.combat_events) {
    if (clampedTime >= combat.start_time && clampedTime <= combat.end_time) {
      activeCombatEvents.push(combat);
    }
  }

  // Active territories
  const activeTerritoryIds = new Set<string>(currentStep.active_territory_ids || []);

  // Factions force manpower status
  const factionsStatus: Record<string, { current_manpower: number; casualties: number }> = {};
  for (const fac of scenario.factions) {
    const curStatus = currentStep.factions_status?.[fac.id];
    if (curStatus) {
      factionsStatus[fac.id] = {
        current_manpower: curStatus.current_manpower,
        casualties: curStatus.casualties,
      };
    } else {
      factionsStatus[fac.id] = {
        current_manpower: fac.current_manpower,
        casualties: fac.casualties,
      };
    }
  }

  return {
    currentTimeSec: clampedTime,
    totalDurationSec: totalDuration,
    currentStepIndex: activeIdx,
    currentStep,
    camera: interpolatedCam,
    factionsStatus,
    activeUnitIds,
    activeArrowIds,
    activeCombatEvents,
    activeTerritoryIds,
    subtitleText: currentStep.narration_text,
    phaseName: currentStep.phase_name,
    timestampLabel: currentStep.timestamp_label,
    tacticalObjective: currentStep.tactical_objective,
  };
}
