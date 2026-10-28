/**
 * Mathematical utilities for rendering dynamic animated military arrows,
 * Bezier curves, and tactical polygons on MapLibre GL JS 3D maps.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Evaluates a De Casteljau algorithm for a general Bezier curve with any number of control points.
 * t ranges from 0.0 to 1.0.
 */
export function deCasteljau(points: Array<[number, number]>, t: number): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];

  let current = points.map((p) => [p[0], p[1]] as [number, number]);
  while (current.length > 1) {
    const next: Array<[number, number]> = [];
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      next.push([
        p0[0] + (p1[0] - p0[0]) * t,
        p0[1] + (p1[1] - p0[1]) * t,
      ]);
    }
    current = next;
  }
  return current[0];
}

/**
 * Samples a smooth curve from control points using Bezier interpolation.
 */
export function sampleBezierPath(
  controlPoints: Array<[number, number]>,
  samples: number = 60
): Array<[number, number]> {
  if (controlPoints.length <= 2) {
    return controlPoints;
  }
  const result: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    result.push(deCasteljau(controlPoints, t));
  }
  return result;
}

/**
 * Calculates cumulative distance along a coordinate path.
 */
export function getPathDistances(path: Array<[number, number]>): number[] {
  const dists: number[] = [0];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    total += Math.sqrt(dx * dx + dy * dy);
    dists.push(total);
  }
  return dists;
}

/**
 * Interpolates a sub-path along a curve up to a progress fraction `progress` in [0, 1].
 * Returns the trimmed coordinate array and the tangent heading at the tip in degrees.
 */
export function trimPathByProgress(
  sampledPath: Array<[number, number]>,
  progress: number
): { path: Array<[number, number]>; headingDeg: number; tip: [number, number] } {
  if (sampledPath.length < 2) {
    const single = sampledPath[0] || [0, 0];
    return { path: sampledPath, headingDeg: 0, tip: single };
  }

  const clamped = Math.max(0.01, Math.min(1.0, progress));
  const distances = getPathDistances(sampledPath);
  const totalDist = distances[distances.length - 1];
  const targetDist = totalDist * clamped;

  const result: Array<[number, number]> = [sampledPath[0]];
  let tip: [number, number] = sampledPath[0];
  let headingDeg = 0;

  for (let i = 1; i < sampledPath.length; i++) {
    const d0 = distances[i - 1];
    const d1 = distances[i];

    if (d1 <= targetDist) {
      result.push(sampledPath[i]);
      tip = sampledPath[i];
    } else {
      // Interpolate inside this segment
      const segLen = d1 - d0;
      const frac = segLen > 0 ? (targetDist - d0) / segLen : 0;
      const p0 = sampledPath[i - 1];
      const p1 = sampledPath[i];
      const interX = p0[0] + (p1[0] - p0[0]) * frac;
      const interY = p0[1] + (p1[1] - p0[1]) * frac;
      tip = [interX, interY];
      result.push(tip);

      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      headingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
      break;
    }
  }

  if (result.length >= 2) {
    const pPrev = result[result.length - 2];
    const pLast = result[result.length - 1];
    const dx = pLast[0] - pPrev[0];
    const dy = pLast[1] - pPrev[1];
    headingDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  }

  return { path: result, headingDeg, tip };
}

/**
 * Generates a tactical arrowhead polygon geometry at the tip of an attack arrow.
 * Uses geographic offsets scaled by headScale.
 */
export function generateArrowHeadPolygon(
  tip: [number, number],
  headingDeg: number,
  headScale: number = 1.0,
  arrowType: string = 'main_thrust'
): Array<[number, number]> {
  const rad = (headingDeg * Math.PI) / 180;
  // Direction vectors
  const forwardX = Math.sin(rad);
  const forwardY = Math.cos(rad);
  const rightX = Math.cos(rad);
  const rightY = -Math.sin(rad);

  // Scaled dimensions in coordinate units (~0.003 to 0.006 deg)
  const baseLen = 0.0035 * headScale;
  const baseWidth = 0.0022 * headScale;

  const tipX = tip[0];
  const tipY = tip[1];

  // Base center point behind the tip
  const baseCenterX = tipX - forwardX * baseLen;
  const baseCenterY = tipY - forwardY * baseLen;

  // Left barb
  const leftX = baseCenterX - rightX * baseWidth;
  const leftY = baseCenterY - rightY * baseWidth;

  // Right barb
  const rightXCoord = baseCenterX + rightX * baseWidth;
  const rightYCoord = baseCenterY + rightY * baseWidth;

  if (arrowType === 'encirclement' || arrowType === 'artillery_barrage') {
    // Triangular arrow
    return [
      [tipX, tipY],
      [leftX, leftY],
      [rightXCoord, rightYCoord],
      [tipX, tipY],
    ];
  }

  // Tactical notched arrowhead (inward notch at rear)
  const notchX = tipX - forwardX * (baseLen * 0.7);
  const notchY = tipY - forwardY * (baseLen * 0.7);

  return [
    [tipX, tipY],
    [leftX, leftY],
    [notchX, notchY],
    [rightXCoord, rightYCoord],
    [tipX, tipY],
  ];
}

/**
 * Builds a dynamic GeoJSON FeatureCollection for active attack arrows at time `currentTime`.
 */
export function buildDynamicArrowsGeoJSON(
  arrows: any[],
  currentTime: number
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const arrow of arrows) {
    if (currentTime < arrow.start_time) continue;

    const duration = Math.max(0.1, arrow.end_time - arrow.start_time);
    const progress = Math.min(1.0, (currentTime - arrow.start_time) / duration);
    if (progress <= 0) continue;

    const sampled =
      arrow.curve_type === 'bezier'
        ? sampleBezierPath(arrow.path_coordinates, 50)
        : arrow.path_coordinates;

    const { path: subPath, headingDeg, tip } = trimPathByProgress(sampled, progress);

    if (subPath.length >= 2) {
      // 1. LineString feature for the arrow stem
      features.push({
        type: 'Feature',
        id: `${arrow.id}_stem`,
        properties: {
          id: arrow.id,
          color: arrow.color,
          stroke_width: arrow.stroke_width || 6.0,
          dashed: Boolean(arrow.dashed),
          label: arrow.label || '',
          faction_id: arrow.faction_id,
          opacity: Math.min(1.0, progress * 2.0),
        },
        geometry: {
          type: 'LineString',
          coordinates: subPath,
        },
      });

      // 2. Polygon feature for the tactical arrowhead
      if (progress > 0.05) {
        const headPoly = generateArrowHeadPolygon(
          tip,
          headingDeg,
          arrow.head_size || 1.4,
          arrow.arrow_type
        );
        features.push({
          type: 'Feature',
          id: `${arrow.id}_head`,
          properties: {
            id: arrow.id,
            color: arrow.color,
            faction_id: arrow.faction_id,
            opacity: Math.min(1.0, progress * 2.0),
          },
          geometry: {
            type: 'Polygon',
            coordinates: [headPoly],
          },
        });
      }
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}

/**
 * Builds a dynamic GeoJSON FeatureCollection for active territorial control pockets.
 */
export function buildTerritoriesGeoJSON(
  territories: any[],
  currentTime: number
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const terr of territories) {
    if (currentTime >= terr.active_time_start && currentTime <= terr.active_time_end) {
      features.push({
        type: 'Feature',
        id: terr.id,
        properties: {
          id: terr.id,
          name: terr.name,
          color: terr.color,
          fill_opacity: terr.fill_opacity,
          stroke_color: terr.stroke_color,
          stroke_width: terr.stroke_width,
          dashed_stroke: Boolean(terr.dashed_stroke),
        },
        geometry: {
          type: 'Polygon',
          coordinates: [terr.polygon_coordinates],
        },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features,
  };
}
