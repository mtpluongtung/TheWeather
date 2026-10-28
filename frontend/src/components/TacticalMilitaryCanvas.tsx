import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  BattleScenario,
  MilitaryUnit,
  CombatEvent,
  CameraWaypoint,
} from '../types/military';
import {
  buildDynamicArrowsGeoJSON,
  buildTerritoriesGeoJSON,
} from '../services/tacticalArrowMath';

interface TacticalMilitaryCanvasProps {
  scenario: BattleScenario;
  currentTime: number;
  camera: CameraWaypoint;
  activeUnitIds: Set<string>;
  activeCombatEvents: CombatEvent[];
  activeTerritoryIds: Set<string>;
  onMapLoaded?: () => void;
  onMapMove?: (center: [number, number], zoom: number, pitch: number, bearing: number) => void;
  isInteractive?: boolean;
}

const CARTO_DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const DEM_TERRARIUM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// NATO Echelon symbols
function getEchelonSymbol(echelon: string): string {
  switch (echelon) {
    case 'corps':
      return 'XXX';
    case 'division':
      return 'XX';
    case 'brigade':
      return 'X';
    case 'regiment':
      return 'III';
    case 'battalion':
      return 'II';
    case 'company':
      return 'I';
    default:
      return '•';
  }
}

// NATO Military Symbol SVGs
function renderNATOSymbol(type: string): React.ReactNode {
  switch (type) {
    case 'artillery':
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 fill-current">
          <circle cx="20" cy="12" r="4.5" />
        </svg>
      );
    case 'armor':
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 fill-none stroke-current" strokeWidth="2.5">
          <ellipse cx="20" cy="12" rx="14" ry="7" />
        </svg>
      );
    case 'headquarters':
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 fill-current stroke-current" strokeWidth="1.5">
          <line x1="8" y1="2" x2="8" y2="22" strokeWidth="3" />
          <polygon points="8,3 28,9 8,15" />
        </svg>
      );
    case 'naval':
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 fill-none stroke-current" strokeWidth="2">
          <path d="M6 14 C12 20, 28 20, 34 14" />
          <line x1="20" y1="4" x2="20" y2="17" />
          <line x1="13" y1="8" x2="27" y2="8" />
        </svg>
      );
    case 'fortification':
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 fill-none stroke-current" strokeWidth="2.5">
          <path d="M4 18 L10 6 L16 6 L20 10 L24 6 L30 6 L36 18 Z" />
        </svg>
      );
    case 'infantry':
    default:
      return (
        <svg viewBox="0 0 40 24" className="w-6 h-3.5 stroke-current" strokeWidth="2.5">
          <line x1="4" y1="4" x2="36" y2="20" />
          <line x1="4" y1="20" x2="36" y2="4" />
        </svg>
      );
  }
}

export const TacticalMilitaryCanvas: React.FC<TacticalMilitaryCanvasProps> = ({
  scenario,
  currentTime,
  camera,
  activeUnitIds,
  activeCombatEvents,
  activeTerritoryIds,
  onMapLoaded,
  onMapMove,
  isInteractive = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const isLoadedRef = useRef(false);
  const unitMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const combatMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  // Initialize MapLibre
  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: CARTO_DARK_STYLE,
      center: scenario.center,
      zoom: scenario.default_zoom,
      pitch: scenario.default_pitch,
      bearing: scenario.default_bearing,
      interactive: isInteractive,
      preserveDrawingBuffer: true, // Crucial for Playwright frame capture!
      antialias: true,
      maxPitch: 82,
    });

    mapRef.current = map;

    map.on('load', () => {
      // 1. Add 3D DEM Terrain
      if (scenario.terrain_elevation) {
        try {
          if (!map.getSource('aws-dem')) {
            map.addSource('aws-dem', {
              type: 'raster-dem',
              tiles: [DEM_TERRARIUM_TILES],
              encoding: 'terrarium',
              tileSize: 256,
              maxzoom: 15,
            });
            map.setTerrain({ source: 'aws-dem', exaggeration: 1.6 });

            // Hillshading layer
            if (!map.getLayer('hills')) {
              map.addLayer({
                id: 'hills',
                type: 'hillshade',
                source: 'aws-dem',
                paint: {
                  'hillshade-exaggeration': 0.7,
                  'hillshade-shadow-color': '#020617',
                  'hillshade-highlight-color': '#475569',
                  'hillshade-accent-color': '#1e293b',
                },
              });
            }
          }
        } catch (err) {
          console.warn('Terrain DEM setup notice:', err);
        }
      }

      // 2. Add Tactical Territories Source & Layers
      if (!map.getSource('tactical-territories-src')) {
        map.addSource('tactical-territories-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'tactical-territories-fill',
          type: 'fill',
          source: 'tactical-territories-src',
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'fill_opacity'],
          },
        });

        map.addLayer({
          id: 'tactical-territories-outline',
          type: 'line',
          source: 'tactical-territories-src',
          paint: {
            'line-color': ['get', 'stroke_color'],
            'line-width': ['get', 'stroke_width'],
            'line-opacity': 0.85,
          },
        });
      }

      // 3. Add Tactical Arrows Source & Layers
      if (!map.getSource('tactical-arrows-src')) {
        map.addSource('tactical-arrows-src', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Glow casing for high legibility on dark background
        map.addLayer({
          id: 'tactical-arrows-glow',
          type: 'line',
          source: 'tactical-arrows-src',
          filter: ['==', '$type', 'LineString'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#000000',
            'line-width': ['+', ['get', 'stroke_width'], 4.0],
            'line-opacity': 0.75,
          },
        });

        // Arrow Stem Layer
        map.addLayer({
          id: 'tactical-arrows-stem',
          type: 'line',
          source: 'tactical-arrows-src',
          filter: ['==', '$type', 'LineString'],
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': ['get', 'stroke_width'],
            'line-opacity': ['get', 'opacity'],
          },
        });

        // Arrow Head Fill Layer
        map.addLayer({
          id: 'tactical-arrows-heads',
          type: 'fill',
          source: 'tactical-arrows-src',
          filter: ['==', '$type', 'Polygon'],
          paint: {
            'fill-color': ['get', 'color'],
            'fill-opacity': ['get', 'opacity'],
          },
        });

        // Arrow Head White/Gold Outline
        map.addLayer({
          id: 'tactical-arrows-heads-stroke',
          type: 'line',
          source: 'tactical-arrows-src',
          filter: ['==', '$type', 'Polygon'],
          layout: {
            'line-join': 'round',
          },
          paint: {
            'line-color': '#ffffff',
            'line-width': 1.5,
            'line-opacity': ['get', 'opacity'],
          },
        });
      }

      isLoadedRef.current = true;
      if (onMapLoaded) onMapLoaded();
    });

    if (onMapMove) {
      map.on('move', () => {
        const c = map.getCenter();
        onMapMove([c.lng, c.lat], map.getZoom(), map.getPitch(), map.getBearing());
      });
    }

    return () => {
      // Remove markers
      unitMarkersRef.current.forEach((m) => m.remove());
      unitMarkersRef.current.clear();
      combatMarkersRef.current.forEach((m) => m.remove());
      combatMarkersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [scenario.id]);

  // Update Camera
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !camera) return;

    map.jumpTo({
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch,
      bearing: camera.bearing,
    });
  }, [camera.center[0], camera.center[1], camera.zoom, camera.pitch, camera.bearing]);

  // Update Dynamic Arrows & Territories GeoJSON per frame
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;

    try {
      const arrowSource = map.getSource('tactical-arrows-src') as maplibregl.GeoJSONSource;
      if (arrowSource) {
        const arrowData = buildDynamicArrowsGeoJSON(scenario.arrows, currentTime);
        arrowSource.setData(arrowData);
      }

      const terrSource = map.getSource('tactical-territories-src') as maplibregl.GeoJSONSource;
      if (terrSource) {
        const terrData = buildTerritoriesGeoJSON(scenario.territories, currentTime);
        terrSource.setData(terrData);
      }
    } catch (e) {
      console.warn('Error updating tactical GeoJSON:', e);
    }
  }, [currentTime, scenario]);

  // Render & Update NATO Military Unit Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;

    scenario.units.forEach((unit: MilitaryUnit) => {
      let marker = unitMarkersRef.current.get(unit.id);
      const isActive = activeUnitIds.has(unit.id);
      const faction = scenario.factions.find((f) => f.id === unit.faction_id);
      const factionColor = faction ? faction.color : '#e11d48';

      const healthPct = Math.max(
        0,
        Math.min(100, Math.round((unit.strength_current / (unit.strength_initial || 1)) * 100))
      );

      if (!marker) {
        const el = document.createElement('div');
        el.className = 'nato-counter-marker-wrapper';
        el.id = `unit-${unit.id}`;

        el.innerHTML = `
          <div class="nato-counter ${isActive ? 'is-active' : ''}" style="--faction-color: ${factionColor}">
            <div class="nato-echelon">${getEchelonSymbol(unit.echelon)}</div>
            <div class="nato-box">
              <div class="nato-symbol-icon" data-type="${unit.type}"></div>
            </div>
            <div class="nato-label">
              <span class="unit-code">${unit.short_name}</span>
            </div>
            <div class="nato-health-bar">
              <div class="health-fill" style="width: ${healthPct}%; background-color: ${healthPct < 40 ? '#ef4444' : healthPct < 70 ? '#f59e0b' : '#22c55e'}"></div>
            </div>
          </div>
        `;

        // Insert SVG icon into marker DOM
        const iconContainer = el.querySelector('.nato-symbol-icon');
        if (iconContainer) {
          iconContainer.innerHTML = getNATOSymbolSVGString(unit.type);
        }

        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(unit.coordinates)
          .addTo(map);

        unitMarkersRef.current.set(unit.id, marker);
      } else {
        // Update marker state
        marker.setLngLat(unit.coordinates);
        const el = marker.getElement();
        const counterEl = el.querySelector('.nato-counter');
        if (counterEl) {
          if (isActive) {
            counterEl.classList.add('is-active');
          } else {
            counterEl.classList.remove('is-active');
          }
        }
        const healthFill = el.querySelector('.health-fill') as HTMLElement;
        if (healthFill) {
          healthFill.style.width = `${healthPct}%`;
          healthFill.style.backgroundColor =
            healthPct < 40 ? '#ef4444' : healthPct < 70 ? '#f59e0b' : '#22c55e';
        }
      }
    });
  }, [scenario.units, activeUnitIds]);

  // Render & Update Combat Events (Artillery, Clash, Breakthrough Bursts)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;

    // Remove expired combat markers
    const currentActiveIds = new Set(activeCombatEvents.map((c) => c.id));
    combatMarkersRef.current.forEach((marker, id) => {
      if (!currentActiveIds.has(id)) {
        marker.remove();
        combatMarkersRef.current.delete(id);
      }
    });

    // Add/update active combat events
    activeCombatEvents.forEach((combat) => {
      let marker = combatMarkersRef.current.get(combat.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'combat-event-marker';
        const isArtillery = combat.event_type === 'artillery_strike';
        el.innerHTML = `
          <div class="combat-burst-ring ${isArtillery ? 'is-artillery' : 'is-clash'}"></div>
          <div class="combat-burst-core">💥</div>
          <div class="combat-burst-label">${combat.name}</div>
        `;

        marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat(combat.coordinates)
          .addTo(map);

        combatMarkersRef.current.set(combat.id, marker);
      }
    });
  }, [activeCombatEvents]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950 select-none">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

function getNATOSymbolSVGString(type: string): string {
  switch (type) {
    case 'artillery':
      return `<svg viewBox="0 0 40 24" width="24" height="14" fill="currentColor"><circle cx="20" cy="12" r="4.5" /></svg>`;
    case 'armor':
      return `<svg viewBox="0 0 40 24" width="24" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><ellipse cx="20" cy="12" rx="14" ry="7" /></svg>`;
    case 'headquarters':
      return `<svg viewBox="0 0 40 24" width="24" height="14" fill="currentColor" stroke="currentColor"><line x1="8" y1="2" x2="8" y2="22" stroke-width="3" /><polygon points="8,3 28,9 8,15" /></svg>`;
    case 'naval':
      return `<svg viewBox="0 0 40 24" width="24" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 14 C12 20, 28 20, 34 14" /><line x1="20" y1="4" x2="20" y2="17" /><line x1="13" y1="8" x2="27" y2="8" /></svg>`;
    case 'fortification':
      return `<svg viewBox="0 0 40 24" width="24" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 18 L10 6 L16 6 L20 10 L24 6 L30 6 L36 18 Z" /></svg>`;
    case 'infantry':
    default:
      return `<svg viewBox="0 0 40 24" width="24" height="14" stroke="currentColor" stroke-width="2.5"><line x1="4" y1="4" x2="36" y2="20" /><line x1="4" y1="20" x2="36" y2="4" /></svg>`;
  }
}
