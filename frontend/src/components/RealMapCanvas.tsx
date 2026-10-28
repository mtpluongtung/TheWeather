import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  CameraSpec,
  MapProviderMeta,
  PlaceMeta,
  SceneItem,
  SubtitleChunk,
  WeatherForecastItem,
  WeatherOverlayType,
} from '../types/weathercast';
import {
  computeCameraAtTime,
  findActiveSubtitle,
  formatTimeMMSS,
} from '../services/cameraMath';
import { IntradayWeatherChart } from './IntradayWeatherChart';

declare global {
  interface Window {
    __WEATHERCAST_READY__?: boolean;
    __seekWeatherCastFrame__?: (timeSec: number) => Promise<boolean>;
    __prewarmWeatherCastTiles__?: () => Promise<boolean>;
  }
}

interface RealMapCanvasProps {
  scenes: SceneItem[];
  forecasts: WeatherForecastItem[];
  places: PlaceMeta[];
  adminBoundaries?: GeoJSON.FeatureCollection | null;
  highlightedPlaceIdOverride?: string | null;
  subtitleChunks?: SubtitleChunk[];
  mapProviderId: string;
  mapProviders: Record<string, MapProviderMeta>;
  enable3dTerrain: boolean;
  enableSubtitles: boolean;
  cameraStyle: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
  activeOverlayOverride: WeatherOverlayType | 'auto';
  radarTileUrl: string | null;
  currentTimeSec: number;
  totalDurationSec: number;
  isPlaying: boolean;
  isRenderMode: boolean;
  forecastDate: string;
  onCameraTelemetryChange?: (cam: CameraSpec) => void;
  onSelectPlaceFromMap?: (placeId: string) => void;
  onMapReady?: (map: maplibregl.Map) => void;
  onSeekTimeFromRender?: (timeSec: number) => void;
}

function buildStyleSpecification(
  providerId: string,
  providers: Record<string, MapProviderMeta>
): string | maplibregl.StyleSpecification {
  const meta = providers[providerId];
  if (meta && meta.type === 'vector' && meta.style_url && meta.available) {
    return meta.style_url;
  }
  if (providerId === 'osm_raster' || !meta || !meta.available) {
    return {
      version: 8,
      sources: {
        'osm-raster-tiles': {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [
        {
          id: 'osm-raster-layer',
          type: 'raster',
          source: 'osm-raster-tiles',
          minzoom: 0,
          maxzoom: 19,
        },
      ],
    };
  }
  return 'https://tiles.openfreemap.org/styles/liberty';
}

function getTempColorHex(temp: number | null): string {
  if (temp === null) return '#38bdf8';
  if (temp <= 15) return '#3b82f6';
  if (temp <= 22) return '#06b6d4';
  if (temp <= 28) return '#10b981';
  if (temp <= 33) return '#f59e0b';
  if (temp <= 36) return '#f97316';
  return '#ef4444';
}

function findFirstSymbolLayerId(map: maplibregl.Map): string | undefined {
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return undefined;
    for (const layer of style.layers) {
      if (layer.type === 'symbol') {
        return layer.id;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function extractMatchingBoundaryFeatures(
  boundaries: GeoJSON.FeatureCollection | null | undefined,
  targetId: string
): GeoJSON.Feature[] {
  if (!boundaries || !Array.isArray(boundaries.features)) return [];

  if (targetId === 'vietnam_overview') {
    return boundaries.features.filter((f) => !f.properties?.is_sub_feature);
  }

  const regionMap: Record<string, string> = {
    region_north: 'north',
    region_central: 'central',
    region_highlands: 'highlands',
    region_south: 'south',
  };
  if (regionMap[targetId]) {
    const reg = regionMap[targetId];
    return boundaries.features.filter(
      (f) => !f.properties?.is_sub_feature && f.properties?.region === reg
    );
  }

  const exactMatches = boundaries.features.filter(
    (f) => f.properties?.place_id === targetId
  );
  if (exactMatches.length > 0) return exactMatches;

  return boundaries.features.filter((f) => {
    const aliases = f.properties?.aliases;
    if (Array.isArray(aliases)) {
      return aliases.includes(targetId);
    }
    if (typeof aliases === 'string') {
      return aliases.includes(targetId);
    }
    return false;
  });
}

export const RealMapCanvas: React.FC<RealMapCanvasProps> = ({
  scenes,
  forecasts,
  places,
  adminBoundaries,
  highlightedPlaceIdOverride,
  subtitleChunks,
  mapProviderId,
  mapProviders,
  enable3dTerrain,
  enableSubtitles,
  cameraStyle,
  aspectRatio,
  activeOverlayOverride,
  radarTileUrl,
  currentTimeSec,
  totalDurationSec,
  isRenderMode,
  forecastDate,
  onCameraTelemetryChange,
  onSelectPlaceFromMap,
  onMapReady,
  onSeekTimeFromRender,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapLoadError, setMapLoadError] = useState<string | null>(null);

  const frameState = computeCameraAtTime(scenes, currentTimeSec, cameraStyle);
  const activeScene = frameState.activeScene;
  const effectiveOverlay: WeatherOverlayType =
    activeOverlayOverride === 'auto' ? frameState.weatherOverlay : activeOverlayOverride;

  // Determine which location/region boundary is currently highlighted
  const effectiveHighlightId =
    highlightedPlaceIdOverride || activeScene?.location.place_id || 'vietnam_overview';

  const activeWeather: WeatherForecastItem | null =
    (highlightedPlaceIdOverride
      ? forecasts.find((f) => f.place_id === highlightedPlaceIdOverride)
      : null) ||
    activeScene?.weather_data ||
    forecasts.find((f) => f.place_id === activeScene?.location.place_id) ||
    forecasts[0] ||
    null;

  // Progress ratio (0..1) inside the currently narrated scene for synchronized intraday chart scanning
  const sceneProgressRatio = useMemo(() => {
    if (!activeScene || activeScene.duration_sec <= 0) return 0;
    const elapsed = currentTimeSec - activeScene.start_time;
    return Math.max(0, Math.min(1, elapsed / activeScene.duration_sec));
  }, [activeScene, currentTimeSec]);

  const activeHighlightFeatures = useMemo(
    () => extractMatchingBoundaryFeatures(adminBoundaries, effectiveHighlightId),
    [adminBoundaries, effectiveHighlightId]
  );

  const activeHighlightLabel = useMemo(() => {
    if (effectiveHighlightId === 'vietnam_overview') return 'TOÀN LÃNH THỔ VIỆT NAM';
    if (effectiveHighlightId === 'region_north') return 'KHU VỰC MIỀN BẮC';
    if (effectiveHighlightId === 'region_central') return 'KHU VỰC MIỀN TRUNG';
    if (effectiveHighlightId === 'region_highlands') return 'KHU VỰC TÂY NGUYÊN';
    if (effectiveHighlightId === 'region_south') return 'KHU VỰC NAM BỘ';
    if (activeHighlightFeatures.length > 0) {
      const prop = activeHighlightFeatures[0].properties;
      return prop?.admin_2025_unit || prop?.label || effectiveHighlightId.toUpperCase();
    }
    return activeScene?.location.admin_2025_unit || activeScene?.location.name || 'VIỆT NAM';
  }, [effectiveHighlightId, activeHighlightFeatures, activeScene]);

  const currentSubtitle = enableSubtitles
    ? findActiveSubtitle(scenes, subtitleChunks, currentTimeSec)
    : '';

  const setupCustomLayers = useCallback(
    (map: maplibregl.Map) => {
      try {
        // 1. Optional Real 3D Terrain DEM (AWS Open Data Terrarium)
        if (!map.getSource('aws-terrain-dem')) {
          map.addSource('aws-terrain-dem', {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 14,
          });
        }
        if (enable3dTerrain) {
          map.setTerrain({ source: 'aws-terrain-dem', exaggeration: 1.35 });
        } else {
          map.setTerrain(null);
        }

        const beforeSymbolId = findFirstSymbolLayerId(map);

        // 2. Administrative Provincial Boundaries Layer + Active Region Orange Highlight (matching user's reference photo)
        const baseFeatures = (adminBoundaries?.features || []).filter(
          (f) => !f.properties?.is_sub_feature
        );
        const baseGeoJSON: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: baseFeatures,
        };

        const highlightGeoJSON: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: activeHighlightFeatures,
        };

        const isOverviewHighlight = effectiveHighlightId === 'vietnam_overview';

        const existingBaseSrc = map.getSource('vn-admin-boundaries') as
          | maplibregl.GeoJSONSource
          | undefined;
        if (existingBaseSrc) {
          existingBaseSrc.setData(baseGeoJSON);
        } else {
          map.addSource('vn-admin-boundaries', {
            type: 'geojson',
            data: baseGeoJSON,
          });

          // Warm topographic tint across Vietnam provinces
          map.addLayer(
            {
              id: 'vn-admin-base-fill',
              type: 'fill',
              source: 'vn-admin-boundaries',
              paint: {
                'fill-color': '#d97706',
                'fill-opacity': 0.12,
              },
            },
            beforeSymbolId
          );

          // White dashed provincial boundaries (like Tuyên Quang, Cao Bằng, Lạng Sơn, Bắc Ninh in reference image)
          map.addLayer(
            {
              id: 'vn-admin-base-border',
              type: 'line',
              source: 'vn-admin-boundaries',
              paint: {
                'line-color': '#ffffff',
                'line-width': [
                  'interpolate',
                  ['linear'],
                  ['zoom'],
                  4.5,
                  0.8,
                  7,
                  1.4,
                  10,
                  2.0,
                ],
                'line-dasharray': [3, 2],
                'line-opacity': 0.78,
              },
            },
            beforeSymbolId
          );
        }

        const existingHighlightSrc = map.getSource('vn-active-highlight') as
          | maplibregl.GeoJSONSource
          | undefined;
        if (existingHighlightSrc) {
          existingHighlightSrc.setData(highlightGeoJSON);
          if (map.getLayer('vn-active-highlight-fill')) {
            map.setPaintProperty(
              'vn-active-highlight-fill',
              'fill-opacity',
              isOverviewHighlight ? 0.22 : 0.58
            );
          }
          if (map.getLayer('vn-active-highlight-outline')) {
            map.setPaintProperty(
              'vn-active-highlight-outline',
              'line-width',
              isOverviewHighlight ? 1.8 : 2.8
            );
          }
        } else {
          map.addSource('vn-active-highlight', {
            type: 'geojson',
            data: highlightGeoJSON,
          });

          // Vibrant warm orange highlight fill (#f97316) below road/place labels so roads, lakes & names shine through
          map.addLayer(
            {
              id: 'vn-active-highlight-fill',
              type: 'fill',
              source: 'vn-active-highlight',
              paint: {
                'fill-color': '#f97316',
                'fill-opacity': isOverviewHighlight ? 0.22 : 0.58,
              },
            },
            beforeSymbolId
          );

          // Soft orange-gold outer halo glow around highlighted region
          map.addLayer(
            {
              id: 'vn-active-highlight-glow',
              type: 'line',
              source: 'vn-active-highlight',
              paint: {
                'line-color': '#fb923c',
                'line-width': 9,
                'line-blur': 4,
                'line-opacity': 0.82,
              },
            },
            beforeSymbolId
          );

          // Crisp bright white solid border around the highlighted province/region
          map.addLayer(
            {
              id: 'vn-active-highlight-outline',
              type: 'line',
              source: 'vn-active-highlight',
              paint: {
                'line-color': '#ffffff',
                'line-width': isOverviewHighlight ? 1.8 : 2.8,
                'line-opacity': 0.98,
              },
            },
            beforeSymbolId
          );
        }

        // 3. RainViewer Real-time Radar Raster Layer
        if (radarTileUrl && !map.getSource('rainviewer-radar')) {
          map.addSource('rainviewer-radar', {
            type: 'raster',
            tiles: [radarTileUrl],
            tileSize: 256,
            // RainViewer public API only serves tiles up to z7; higher zooms return a
            // "Zoom Level Not Supported" placeholder, so let MapLibre overscale z7 tiles.
            maxzoom: 7,
            attribution: '© RainViewer Radar',
          });
          map.addLayer(
            {
              id: 'rainviewer-radar-layer',
              type: 'raster',
              source: 'rainviewer-radar',
              paint: {
                'raster-opacity':
                  effectiveOverlay === 'radar' || effectiveOverlay === 'precipitation' ? 0.68 : 0.18,
              },
            },
            beforeSymbolId
          );
        } else if (map.getLayer('rainviewer-radar-layer')) {
          map.setPaintProperty(
            'rainviewer-radar-layer',
            'raster-opacity',
            effectiveOverlay === 'radar' || effectiveOverlay === 'precipitation' ? 0.68 : 0.18
          );
        }

        // 4. Weather Stations GeoJSON Source (Real coordinates + Forecast metrics)
        const features = forecasts.map((f) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [f.lon, f.lat],
          },
          properties: {
            place_id: f.place_id,
            name: f.place_name,
            temp: f.temperature_c ?? 26,
            rain_mm: f.precipitation_mm ?? 0,
            rain_prob: f.precipitation_probability_pct ?? 0,
            wind_kmh: f.wind_speed_kmh ?? 10,
            uv: f.uv_index ?? 5,
            desc: f.weather_description_vi,
          },
        }));

        const geojsonData: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features,
        };

        const existingSource = map.getSource('weather-stations') as
          | maplibregl.GeoJSONSource
          | undefined;
        if (existingSource) {
          existingSource.setData(geojsonData);
        } else {
          map.addSource('weather-stations', {
            type: 'geojson',
            data: geojsonData,
          });

          // Core Station Ring
          map.addLayer({
            id: 'weather-station-core',
            type: 'circle',
            source: 'weather-stations',
            paint: {
              'circle-radius': 6,
              'circle-color': '#ffffff',
              'circle-stroke-width': 3,
              'circle-stroke-color': '#f97316',
            },
          });
        }
      } catch (err) {
        console.warn('Layer setup warning:', err);
      }
    },
    [
      enable3dTerrain,
      forecasts,
      radarTileUrl,
      effectiveOverlay,
      adminBoundaries,
      activeHighlightFeatures,
      effectiveHighlightId,
    ]
  );

  // Initialize MapLibre GL JS Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    setMapLoaded(false);
    setMapLoadError(null);
    window.__WEATHERCAST_READY__ = false;

    const styleSpec = buildStyleSpecification(mapProviderId, mapProviders);

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: styleSpec,
      center: [106.8, 16.2],
      zoom: 5.3,
      pitch: 35,
      bearing: -8,
      attributionControl: false,
      preserveDrawingBuffer: true,
      antialias: true,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    if (!isRenderMode) {
      map.addControl(
        new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }),
        'top-left'
      );
    }

    map.on('load', () => {
      setupCustomLayers(map);
      setMapLoaded(true);
      window.__WEATHERCAST_READY__ = true;
      if (onMapReady) onMapReady(map);
    });

    // Click on any province polygon to highlight and fly to it
    map.on('click', 'vn-admin-base-fill', (ev) => {
      if (ev.features && ev.features.length > 0) {
        const pid = ev.features[0].properties?.place_id;
        if (pid && onSelectPlaceFromMap) {
          onSelectPlaceFromMap(String(pid));
        }
      }
    });

    map.on('error', (ev) => {
      if (ev && ev.error && String(ev.error.message || '').includes('Failed to fetch')) {
        setMapLoadError('Cảnh báo kết nối tải một số ô bản đồ (Tile) từ máy chủ bản đồ.');
      }
    });

    map.on('move', () => {
      if (onCameraTelemetryChange) {
        const c = map.getCenter();
        onCameraTelemetryChange({
          center: [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))],
          zoom: Number(map.getZoom().toFixed(2)),
          pitch: Number(map.getPitch().toFixed(1)),
          bearing: Number(map.getBearing().toFixed(1)),
        });
      }
    });

    mapRef.current = map;

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [mapProviderId]);

  // Update layers when boundaries, active highlight, forecasts, radar, or terrain change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    setupCustomLayers(map);
  }, [mapLoaded, setupCustomLayers]);

  // Render HTML Weather Station Badges, Highlighted Province Centroid Banner & Sovereignty Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // 1. Add Weather Forecast Markers at exact geographic coordinates
    forecasts.forEach((f) => {
      const isTarget = effectiveHighlightId === f.place_id;
      const el = document.createElement('div');
      el.className = `wc-map-marker ${isTarget ? 'wc-map-marker-active' : ''}`;
      const badgeColor = isTarget ? '#f97316' : getTempColorHex(f.temperature_c);

      let metricSub = `${f.precipitation_probability_pct ?? 0}% mưa`;
      if (effectiveOverlay === 'wind') {
        metricSub = `${f.wind_speed_kmh ?? 0} km/h`;
      } else if (effectiveOverlay === 'uv') {
        metricSub = `UV ${f.uv_index ?? '-'}`;
      } else if (effectiveOverlay === 'precipitation' && (f.precipitation_mm ?? 0) > 0) {
        metricSub = `${f.precipitation_mm} mm`;
      }

      el.innerHTML = `
        <div class="wc-marker-pill" style="border-color: ${badgeColor}">
          <span class="wc-marker-temp" style="background: ${badgeColor}">
            ${f.temperature_c !== null ? `${Math.round(f.temperature_c)}°C` : '--'}
          </span>
          <div class="wc-marker-info">
            <div class="wc-marker-name">${f.place_name}</div>
            <div class="wc-marker-sub">${metricSub}</div>
          </div>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onSelectPlaceFromMap) onSelectPlaceFromMap(f.place_id);
        map.flyTo({
          center: [f.lon, f.lat],
          zoom: 8.6,
          pitch: 36,
          bearing: 8,
          duration: 1600,
        });
      });

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([f.lon, f.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });

    // 2. Render a prominent Region Highlight Callout Tag inside the active polygon if only 1 province is highlighted
    if (
      activeHighlightFeatures.length === 1 &&
      effectiveHighlightId !== 'vietnam_overview'
    ) {
      const feat = activeHighlightFeatures[0];
      const rawCent = feat.properties?.centroid;
      let cent: [number, number] | null = null;
      if (Array.isArray(rawCent) && rawCent.length === 2) {
        cent = [Number(rawCent[0]), Number(rawCent[1])];
      } else if (typeof rawCent === 'string') {
        try {
          const parsed = JSON.parse(rawCent);
          if (Array.isArray(parsed) && parsed.length === 2) {
            cent = [Number(parsed[0]), Number(parsed[1])];
          }
        } catch {
          // ignore
        }
      }
      if (cent) {
        const labelEl = document.createElement('div');
        labelEl.className = 'wc-region-highlight-label';
        labelEl.innerHTML = `<span>${feat.properties?.label || effectiveHighlightId.toUpperCase()}</span>`;
        const lblMarker = new maplibregl.Marker({ element: labelEl, anchor: 'center' })
          .setLngLat(cent)
          .addTo(map);
        markersRef.current.push(lblMarker);
      }
    }

    // 3. Always ensure Hoàng Sa & Trường Sa sovereignty markers are present on the map
    const sovereigntyIslands = places.filter(
      (p) => p.id === 'hoang_sa' || p.id === 'truong_sa'
    );
    sovereigntyIslands.forEach((island) => {
      const alreadyInForecasts = forecasts.some((f) => f.place_id === island.id);
      if (alreadyInForecasts) return;

      const el = document.createElement('div');
      el.className = 'wc-sovereignty-marker';
      el.innerHTML = `
        <div class="wc-sovereignty-badge">
          <span class="wc-vn-star">★</span>
          <span>${island.name} (Việt Nam)</span>
        </div>
      `;
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([island.lon, island.lat])
        .addTo(map);
      markersRef.current.push(marker);
    });
  }, [
    mapLoaded,
    forecasts,
    places,
    effectiveHighlightId,
    activeHighlightFeatures,
    effectiveOverlay,
  ]);

  // Synchronize MapLibre Camera with Timeline Playback
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || scenes.length === 0 || highlightedPlaceIdOverride) return;

    const cam = computeCameraAtTime(scenes, currentTimeSec, cameraStyle);
    map.jumpTo({
      center: cam.center,
      zoom: cam.zoom,
      pitch: cam.pitch,
      bearing: cam.bearing,
    });
  }, [currentTimeSec, scenes, cameraStyle, mapLoaded, highlightedPlaceIdOverride]);

  // Expose deterministic frame seek & tile pre-warming hooks for Playwright MP4 Renderer
  useEffect(() => {
    window.__seekWeatherCastFrame__ = async (timeSec: number) => {
      if (onSeekTimeFromRender) {
        onSeekTimeFromRender(timeSec);
      }
      const map = mapRef.current;
      if (!map) return false;

      const cam = computeCameraAtTime(scenes, timeSec, cameraStyle);
      map.jumpTo({
        center: cam.center,
        zoom: cam.zoom,
        pitch: cam.pitch,
        bearing: cam.bearing,
      });
      map.triggerRepaint();

      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });

      if (!map.areTilesLoaded()) {
        await new Promise((r) => setTimeout(r, 90));
      }
      return true;
    };

    window.__prewarmWeatherCastTiles__ = async () => {
      const map = mapRef.current;
      if (!map || scenes.length === 0) return false;
      for (const sc of scenes) {
        map.jumpTo({
          center: sc.camera.center,
          zoom: sc.camera.zoom,
          pitch: sc.camera.pitch,
          bearing: sc.camera.bearing,
        });
        map.triggerRepaint();
        await new Promise((r) => setTimeout(r, 380));
      }
      const initCam = computeCameraAtTime(scenes, 0, cameraStyle);
      map.jumpTo({
        center: initCam.center,
        zoom: initCam.zoom,
        pitch: initCam.pitch,
        bearing: initCam.bearing,
      });
      await new Promise((r) => setTimeout(r, 300));
      return true;
    };
  }, [scenes, cameraStyle, onSeekTimeFromRender]);

  const progressRatio =
    totalDurationSec > 0 ? Math.min(100, (currentTimeSec / totalDurationSec) * 100) : 0;

  return (
    <div
      className={`wc-stage-wrapper ${isRenderMode ? 'wc-stage-render-mode' : ''} wc-aspect-${aspectRatio.replace(':', '-')}`}
    >
      {/* Real MapLibre GL JS Interactive 3D Map Container */}
      <div ref={mapContainerRef} className="wc-maplibre-canvas" />

      {mapLoadError && !isRenderMode && (
        <div className="wc-map-error-banner">{mapLoadError}</div>
      )}

      {/* Broadcast TV HUD Overlay (Recorded directly into MP4 video) */}
      <div className="wc-broadcast-hud">
        {/* Top Broadcast Row: Left Brand + Right Meteorological Card & Intraday Chart */}
        <div className="wc-hud-top">
          <div className="wc-hud-brand">
            <div className="wc-live-badge">
              <span className="wc-pulse-dot" />
              <span>BẢN TIN THỜI TIẾT VIỆT NAM</span>
            </div>
            <div className="wc-hud-scene-title">
              {activeScene ? activeScene.title : 'Toàn cảnh Việt Nam'}
            </div>
            <div className="wc-hud-highlight-pill">
              <span className="wc-highlight-swatch" />
              <span>VÙNG ĐANG ĐỌC: {activeHighlightLabel}</span>
            </div>
            <div className="wc-hud-meta-line">
              <span>Ngày dự báo: {forecastDate}</span>
              <span>•</span>
              <span>UTC+7 (Việt Nam)</span>
              <span>•</span>
              <span>
                {enable3dTerrain ? '3D DEM Terrarium' : 'Camera 3D Pitch'}
              </span>
            </div>
          </div>

          {/* Right Stack: Active Location Weather Card + Synchronized Intraday Chart */}
          {activeWeather && (
            <div className="wc-hud-right-stack">
              <div className="wc-hud-weather-card">
                <div className="wc-card-header">
                  <div>
                    <div className="wc-card-place">{activeWeather.place_name}</div>
                    <div className="wc-card-coords">
                      {activeWeather.lat.toFixed(2)}°B, {activeWeather.lon.toFixed(2)}°Đ •{' '}
                      {activeWeather.weather_description_vi}
                    </div>
                  </div>
                  <div
                    className="wc-card-temp-main"
                    style={{ color: getTempColorHex(activeWeather.temperature_c) }}
                  >
                    {activeWeather.temperature_c !== null
                      ? `${activeWeather.temperature_c.toFixed(1)}°C`
                      : 'Chưa có'}
                  </div>
                </div>

                <div className="wc-card-metrics-grid">
                  <div className="wc-metric-box">
                    <span className="wc-metric-label">Cao / Thấp</span>
                    <span className="wc-metric-val">
                      {activeWeather.temp_max_c ?? '--'}° / {activeWeather.temp_min_c ?? '--'}°C
                    </span>
                  </div>
                  <div className="wc-metric-box">
                    <span className="wc-metric-label">Khả năng / Lượng mưa</span>
                    <span className="wc-metric-val">
                      {activeWeather.precipitation_probability_pct ?? 0}% (
                      {activeWeather.precipitation_mm ?? 0} mm)
                    </span>
                  </div>
                  <div className="wc-metric-box">
                    <span className="wc-metric-label">Gió & Gió giật</span>
                    <span className="wc-metric-val">
                      {activeWeather.wind_speed_kmh ?? '--'} /{' '}
                      {activeWeather.severe_weather_summary?.max_wind_gust_kmh ??
                        activeWeather.wind_speed_kmh ??
                        '--'}{' '}
                      km/h
                    </span>
                  </div>
                  <div className="wc-metric-box">
                    <span className="wc-metric-label">UV / Độ ẩm</span>
                    <span className="wc-metric-val">
                      UV {activeWeather.uv_index ?? '--'} • {activeWeather.relative_humidity_pct ?? '--'}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Intraday Hourly Timeline Chart (Nhiệt độ, Mưa, Bão/Giông lốc, Sấm sét) */}
              {aspectRatio !== '9:16' && (
                <IntradayWeatherChart
                  weather={activeWeather}
                  sceneProgressRatio={sceneProgressRatio}
                  compact={true}
                />
              )}
            </div>
          )}
        </div>

        {/* Bottom HUD: Legend, Subtitles, Attribution & Timeline Progress */}
        <div className="wc-hud-bottom">
          <div className="wc-hud-legend-row">
            <div className="wc-legend-box">
              <div className="wc-legend-title">
                VÙNG RANH GIỚI HIGHLIGHT CAM • LỚP: {effectiveOverlay.toUpperCase()}
              </div>
              <div className="wc-legend-scale">
                <span style={{ background: '#f97316', border: '1px solid #fff' }}>
                  Vùng Đang Đọc
                </span>
                <span style={{ background: '#3b82f6' }}>&le;15°C Rét</span>
                <span style={{ background: '#06b6d4' }}>16-22°C Mát</span>
                <span style={{ background: '#10b981' }}>23-28°C Dễ chịu</span>
                <span style={{ background: '#f59e0b' }}>29-34°C Nóng</span>
                <span style={{ background: '#ef4444' }}>&ge;35°C Nắng nóng</span>
              </div>
            </div>

            <div className="wc-timecode-pill">
              {formatTimeMMSS(currentTimeSec)} / {formatTimeMMSS(totalDurationSec)}
            </div>
          </div>

          {/* Synchronized Subtitle Box */}
          {enableSubtitles && currentSubtitle && (
            <div className="wc-subtitle-container">
              <div className="wc-subtitle-box">{currentSubtitle}</div>
            </div>
          )}

          {/* Data Source & Attribution Footer */}
          <div className="wc-hud-footer">
            <div className="wc-source-attribution">
              <span>Nguồn dự báo số trị & Khung giờ: Open-Meteo Forecast API</span>
              <span>•</span>
              <span>Cảnh báo chính thức: Trung tâm Dự báo KTTV Quốc gia (nchmf.gov.vn)</span>
              <span>•</span>
              <span>
                Bản đồ: {mapProviders[mapProviderId]?.attribution || '© OpenStreetMap contributors'}
              </span>
            </div>
            <div className="wc-hud-progress-track">
              <div
                className="wc-hud-progress-fill"
                style={{ width: `${progressRatio}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
