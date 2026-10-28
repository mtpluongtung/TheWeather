import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import {
  Play,
  Pause,
  RotateCcw,
  Film,
  Download,
  RefreshCw,
  Compass,
  Volume2,
  FileText,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Layers,
  Mountain,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  ExternalLink,
  Sparkles,
  Video,
} from 'lucide-react';
import { api } from './services/api';
import {
  CameraPreset,
  CameraSpec,
  HealthResponse,
  PlaceMeta,
  ProjectData,
  RenderProgress,
  SceneItem,
  WeatherForecastItem,
  WeatherOverlayType,
} from './types/weathercast';
import { RealMapCanvas } from './components/RealMapCanvas';
import { IntradayWeatherChart } from './components/IntradayWeatherChart';
import { formatTimeMMSS } from './services/cameraMath';

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isRenderMode = urlParams.get('renderMode') === '1';
  const renderProjectIdParam = urlParams.get('projectId');

  // Catalog & System State
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [presets, setPresets] = useState<CameraPreset[]>([]);
  const [places, setPlaces] = useState<PlaceMeta[]>([]);
  const [adminBoundaries, setAdminBoundaries] = useState<GeoJSON.FeatureCollection | null>(null);
  const [highlightedPlaceIdOverride, setHighlightedPlaceIdOverride] = useState<string | null>(null);
  const [adminSchemaVersion, setAdminSchemaVersion] = useState<string>('2025.2-VN-ADMIN');
  const [radarTileUrl, setRadarTileUrl] = useState<string | null>(null);

  // Project & Configuration State
  const [project, setProject] = useState<ProjectData | null>(null);
  const [projectName, setProjectName] = useState('Bản tin Dự báo Thời tiết Việt Nam');
  const [scope, setScope] = useState<'nationwide' | 'region' | 'custom_places'>('nationwide');
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([
    'ha_noi',
    'thai_nguyen',
    'bac_ninh',
    'da_nang',
    'tp_hcm',
  ]);
  const [placeToAdd, setPlaceToAdd] = useState<string>('lam_dong');
  const [forecastDate, setForecastDate] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  });
  const [targetDurationSec, setTargetDurationSec] = useState<number>(45);
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = useState<'720p' | '1080p'>('720p');
  const [voiceId, setVoiceId] = useState<string>('vi-VN-HoaiMyNeural');
  const [voiceRate, setVoiceRate] = useState<string>('+0%');
  const [tone, setTone] = useState<'broadcast' | 'concise' | 'friendly' | 'detailed'>('broadcast');
  const [cameraStyle, setCameraStyle] = useState<
    'cinematic_fly' | 'broadcast_smooth' | 'dynamic_orbit' | 'direct_pan'
  >('cinematic_fly');
  const [mapProviderId, setMapProviderId] = useState<string>('openfreemap_liberty');
  const [enable3dTerrain, setEnable3dTerrain] = useState<boolean>(true);
  const [enableSubtitles, setEnableSubtitles] = useState<boolean>(true);
  const [enableBgm, setEnableBgm] = useState<boolean>(true);
  const [activeOverlayOverride, setActiveOverlayOverride] = useState<WeatherOverlayType | 'auto'>(
    'auto'
  );

  // Weather, Scenes & Playback State
  const [forecasts, setForecasts] = useState<WeatherForecastItem[]>([]);
  const [scenes, setScenes] = useState<SceneItem[]>([]);
  const [scriptDirty, setScriptDirty] = useState<boolean>(false);
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [cameraTelemetry, setCameraTelemetry] = useState<CameraSpec>({
    center: [106.8, 16.2],
    zoom: 5.3,
    pitch: 35,
    bearing: -8,
  });

  // Loading, Error & Render Progress State
  const [isLoadingWeather, setIsLoadingWeather] = useState<boolean>(false);
  const [isPreparingPreview, setIsPreparingPreview] = useState<boolean>(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState<RenderProgress | null>(null);
  const [activeBottomTab, setActiveBottomTab] = useState<'timeline' | 'script' | 'weather' | 'video'>(
    'script'
  );

  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);

  const totalDurationSec =
    scenes.length > 0 ? scenes[scenes.length - 1].end_time : targetDurationSec;

  // 1. Initial Bootstrap: Load Health, Places, Radar, and either RenderMode project or initial project
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        setIsLoadingWeather(true);
        setApiError(null);

        const [healthRes, placesRes, boundariesRes, radarRes] = await Promise.all([
          api.getHealth(),
          api.getPlaces(),
          api.getBoundaries().catch(() => ({
            type: 'FeatureCollection' as const,
            features: [],
          })),
          api.getRadarMetadata().catch(() => ({
            available: false,
            radar_tile_url: null,
            satellite_tile_url: null,
            attribution: '',
          })),
        ]);

        if (cancelled) return;
        setHealth(healthRes);
        setPresets(placesRes.camera_presets || []);
        setPlaces(placesRes.places || []);
        setAdminBoundaries(boundariesRes);
        setAdminSchemaVersion(placesRes.schema_version || '2025.2-VN-ADMIN');
        if (radarRes.radar_tile_url) {
          setRadarTileUrl(radarRes.radar_tile_url);
        }

        if (isRenderMode && renderProjectIdParam) {
          const loadedProj = await api.getProject(renderProjectIdParam);
          if (cancelled) return;
          applyProjectToState(loadedProj);
          return;
        }

        // Normal Studio Mode: Create an initial project with real weather data for Ha Noi, Thai Nguyen, Bac Ninh, Da Nang, TP.HCM
        const initialProj = await api.createProject({
          name: 'Bản tin Dự báo Thời tiết Việt Nam',
          scope: 'nationwide',
          place_ids: ['ha_noi', 'thai_nguyen', 'bac_ninh', 'da_nang', 'tp_hcm'],
          forecast_date: forecastDate,
          target_duration_sec: 45,
          aspect_ratio: '16:9',
          resolution: '720p',
          voice_id: 'vi-VN-HoaiMyNeural',
          voice_rate: '+0%',
          tone: 'broadcast',
          camera_style: 'cinematic_fly',
          map_provider: healthRes.map_config.default_provider || 'openfreemap_liberty',
          enable_3d_terrain: healthRes.map_config.enable_real_3d_terrain,
          enable_subtitles: true,
          enable_bgm: true,
        });
        if (cancelled) return;
        applyProjectToState(initialProj);
      } catch (err: any) {
        if (!cancelled) {
          setApiError(err?.message || 'Không thể kết nối tới Backend API.');
        }
      } finally {
        if (!cancelled) {
          setIsLoadingWeather(false);
        }
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyProjectToState = (proj: ProjectData) => {
    setProject(proj);
    setProjectName(proj.name);
    setScope(proj.scope);
    setSelectedPlaceIds(proj.place_ids);
    setForecastDate(proj.forecast_date);
    setTargetDurationSec(proj.target_duration_sec);
    setAspectRatio(proj.aspect_ratio);
    setResolution(proj.resolution);
    setVoiceId(proj.voice_id);
    setVoiceRate(proj.voice_rate);
    setTone(proj.tone);
    setCameraStyle(proj.camera_style);
    setMapProviderId(proj.map_provider || 'openfreemap_liberty');
    setEnable3dTerrain(proj.enable_3d_terrain);
    setEnableSubtitles(proj.enable_subtitles);
    setEnableBgm(proj.enable_bgm);
    setScenes(proj.scenes || []);
    setRenderProgress(proj.progress || null);
    setScriptDirty(false);

    // Extract forecasts from scenes
    const extractedForecasts: WeatherForecastItem[] = [];
    const seen = new Set<string>();
    for (const sc of proj.scenes || []) {
      if (sc.weather_data && !seen.has(sc.weather_data.place_id)) {
        seen.add(sc.weather_data.place_id);
        extractedForecasts.push(sc.weather_data);
      }
    }
    if (extractedForecasts.length > 0) {
      setForecasts(extractedForecasts);
    }
  };

  // 2. Animation Loop for Browser Camera & Audio Preview
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastFrameTsRef.current = null;
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      return;
    }

    const hasMasterAudio = Boolean(project?.audio_info?.master_audio_url);
    if (hasMasterAudio && audioRef.current) {
      if (Math.abs(audioRef.current.currentTime - currentTimeSec) > 0.35) {
        audioRef.current.currentTime = currentTimeSec;
      }
      audioRef.current.play().catch(() => {
        // Autoplay fallback if browser blocks audio
      });
    }

    const tick = (nowMs: number) => {
      if (lastFrameTsRef.current === null) {
        lastFrameTsRef.current = nowMs;
      }
      const deltaSec = (nowMs - lastFrameTsRef.current) / 1000;
      lastFrameTsRef.current = nowMs;

      if (hasMasterAudio && audioRef.current && !audioRef.current.paused) {
        const audioTime = audioRef.current.currentTime;
        setCurrentTimeSec(audioTime);
        if (audioTime >= totalDurationSec) {
          setIsPlaying(false);
          setCurrentTimeSec(0);
          return;
        }
      } else {
        setCurrentTimeSec((prev) => {
          const next = prev + deltaSec;
          if (next >= totalDurationSec) {
            setIsPlaying(false);
            return 0;
          }
          return next;
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, totalDurationSec, project?.audio_info?.master_audio_url]);

  // 3. Poll Render Progress when a render job is active
  useEffect(() => {
    if (!project) return;
    const status = renderProgress?.status;
    if (
      status !== 'preparing_audio' &&
      status !== 'syncing_timeline' &&
      status !== 'rendering_map' &&
      status !== 'encoding_video'
    ) {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const prog = await api.getRenderProgress(project.id);
        setRenderProgress(prog);
        if (prog.status === 'completed') {
          const refreshed = await api.getProject(project.id);
          applyProjectToState(refreshed);
          setStatusBanner('Xuất video MP4 hoàn tất! Bạn có thể xem trước hoặc tải xuống ngay.');
          setActiveBottomTab('video');
        } else if (prog.status === 'failed') {
          setApiError(prog.error_message || 'Quá trình render video MP4 gặp lỗi.');
        }
      } catch (err) {
        console.warn('Progress poll error:', err);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [project?.id, renderProgress?.status]);

  // Handlers
  const handleSelectScope = (newScope: 'nationwide' | 'region' | 'custom_places') => {
    setScope(newScope);
    if (newScope === 'nationwide') {
      setSelectedPlaceIds(['ha_noi', 'bac_ninh', 'da_nang', 'lam_dong', 'tp_hcm', 'can_tho']);
    } else if (newScope === 'region') {
      setSelectedPlaceIds(['ha_noi', 'bac_ninh', 'hai_phong', 'quang_ninh', 'lao_cai']);
    }
  };

  const handleFlyToPresetOrPlace = async (target: {
    id: string;
    name: string;
    lat: number;
    lon: number;
    zoom: number;
    pitch: number;
    bearing: number;
    isPlace?: boolean;
  }) => {
    setIsPlaying(false);
    setHighlightedPlaceIdOverride(target.id);
    const map = mapInstanceRef.current;
    if (map) {
      map.flyTo({
        center: [target.lon, target.lat],
        zoom: target.zoom,
        pitch: target.pitch,
        bearing: target.bearing,
        duration: 2000,
        essential: true,
      });
    }

    if (target.isPlace) {
      try {
        setIsLoadingWeather(true);
        setApiError(null);
        const res = await api.getForecast([target.id], forecastDate);
        if (res.items && res.items.length > 0) {
          const newItem = res.items[0];
          setForecasts((prev) => {
            const exists = prev.some((p) => p.place_id === newItem.place_id);
            if (exists) {
              return prev.map((p) => (p.place_id === newItem.place_id ? newItem : p));
            }
            return [...prev, newItem];
          });
          setStatusBanner(
            `Đã tải dữ liệu thời tiết thực tế cho ${newItem.place_name}: ${newItem.temperature_c}°C (${newItem.weather_description_vi})`
          );
        }
      } catch (err: any) {
        setApiError(err?.message || 'Lỗi khi lấy dự báo thời tiết từ Open-Meteo.');
      } finally {
        setIsLoadingWeather(false);
      }
    }
  };

  const handleAddPlace = () => {
    if (!placeToAdd) return;
    if (!selectedPlaceIds.includes(placeToAdd)) {
      setSelectedPlaceIds([...selectedPlaceIds, placeToAdd]);
    }
  };

  const handleRemovePlace = (id: string) => {
    if (selectedPlaceIds.length <= 1) {
      setApiError('Cần chọn ít nhất 1 địa điểm trong kịch bản.');
      return;
    }
    setSelectedPlaceIds(selectedPlaceIds.filter((p) => p !== id));
  };

  const handleMovePlace = (idx: number, dir: -1 | 1) => {
    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= selectedPlaceIds.length) return;
    const copy = [...selectedPlaceIds];
    const temp = copy[idx];
    copy[idx] = copy[targetIdx];
    copy[targetIdx] = temp;
    setSelectedPlaceIds(copy);
  };

  const handleGenerateNewProject = async () => {
    try {
      setIsPlaying(false);
      setIsLoadingWeather(true);
      setApiError(null);
      setStatusBanner('Đang lấy dữ liệu thời tiết mới nhất từ Open-Meteo và sinh kịch bản...');

      const created = await api.createProject({
        name: projectName,
        scope,
        place_ids: selectedPlaceIds,
        forecast_date: forecastDate,
        target_duration_sec: targetDurationSec,
        aspect_ratio: aspectRatio,
        resolution,
        voice_id: voiceId,
        voice_rate: voiceRate,
        tone,
        camera_style: cameraStyle,
        map_provider: mapProviderId,
        enable_3d_terrain: enable3dTerrain,
        enable_subtitles: enableSubtitles,
        enable_bgm: enableBgm,
      });

      applyProjectToState(created);
      setCurrentTimeSec(0);
      setStatusBanner(
        `Đã cập nhật dữ liệu thời tiết thực tế và tạo kịch bản (${created.scenes.length} phân cảnh).`
      );
    } catch (err: any) {
      setApiError(err?.message || 'Lỗi khi tạo dự án mới.');
    } finally {
      setIsLoadingWeather(false);
    }
  };

  const handleSceneNarrationEdit = (sceneIndex: number, newText: string) => {
    setScenes((prev) =>
      prev.map((sc, idx) =>
        idx === sceneIndex
          ? {
              ...sc,
              narration: newText,
              subtitle: newText,
            }
          : sc
      )
    );
    setScriptDirty(true);
  };

  const handleSaveEditedScript = async () => {
    if (!project) return;
    try {
      setIsLoadingWeather(true);
      setApiError(null);
      const updated = await api.updateProject(project.id, {
        name: projectName,
        aspect_ratio: aspectRatio,
        resolution,
        voice_id: voiceId,
        voice_rate: voiceRate,
        tone,
        camera_style: cameraStyle,
        map_provider: mapProviderId,
        enable_3d_terrain: enable3dTerrain,
        enable_subtitles: enableSubtitles,
        enable_bgm: enableBgm,
        scenes,
      });
      applyProjectToState(updated);
      setStatusBanner('Đã lưu nội dung lời dẫn chỉnh sửa và cấu hình dự án.');
    } catch (err: any) {
      setApiError(err?.message || 'Không thể lưu chỉnh sửa kịch bản.');
    } finally {
      setIsLoadingWeather(false);
    }
  };

  const handlePrepareTTSAndPreview = async () => {
    if (!project) return;
    try {
      setIsPlaying(false);
      setIsPreparingPreview(true);
      setApiError(null);
      setStatusBanner('Đang tạo giọng đọc tiếng Việt (Edge Neural TTS) và đồng bộ hóa timeline camera...');

      if (scriptDirty) {
        await api.updateProject(project.id, {
          name: projectName,
          aspect_ratio: aspectRatio,
          resolution,
          voice_id: voiceId,
          voice_rate: voiceRate,
          tone,
          camera_style: cameraStyle,
          map_provider: mapProviderId,
          enable_3d_terrain: enable3dTerrain,
          enable_subtitles: enableSubtitles,
          enable_bgm: enableBgm,
          scenes,
        });
      }

      const syncedProj = await api.preparePreview(project.id);
      applyProjectToState(syncedProj);
      setCurrentTimeSec(0);
      setStatusBanner(
        `Đã tạo xong giọng đọc TTS (${syncedProj.total_duration_sec.toFixed(1)}s). Đang phát hành trình camera đồng bộ!`
      );
      setTimeout(() => {
        setIsPlaying(true);
      }, 250);
    } catch (err: any) {
      setApiError(err?.message || 'Lỗi khi tạo giọng đọc xem trước.');
    } finally {
      setIsPreparingPreview(false);
    }
  };

  const handleStartRenderMP4 = async () => {
    if (!project) return;
    try {
      setIsPlaying(false);
      setApiError(null);

      await api.updateProject(project.id, {
        name: projectName,
        aspect_ratio: aspectRatio,
        resolution,
        voice_id: voiceId,
        voice_rate: voiceRate,
        tone,
        camera_style: cameraStyle,
        map_provider: mapProviderId,
        enable_3d_terrain: enable3dTerrain,
        enable_subtitles: enableSubtitles,
        enable_bgm: enableBgm,
        scenes,
      });

      const res = await api.startRender(project.id);
      setRenderProgress(res.progress);
      setStatusBanner(res.message);
    } catch (err: any) {
      setApiError(err?.message || 'Không thể khởi chạy tiến trình render MP4.');
    }
  };

  const handleSeekFromRender = useCallback((t: number) => {
    setCurrentTimeSec(t);
  }, []);

  // In Playwright RenderMode (`/?renderMode=1&projectId=...`), render ONLY the fullscreen broadcast canvas
  if (isRenderMode) {
    return (
      <div className="wc-fullscreen-render-root">
        <RealMapCanvas
          scenes={scenes}
          forecasts={forecasts}
          places={places}
          adminBoundaries={adminBoundaries}
          subtitleChunks={project?.audio_info?.subtitle_chunks}
          mapProviderId={mapProviderId}
          mapProviders={health?.map_config.providers || {}}
          enable3dTerrain={enable3dTerrain}
          enableSubtitles={enableSubtitles}
          cameraStyle={cameraStyle}
          aspectRatio={aspectRatio}
          activeOverlayOverride={activeOverlayOverride}
          radarTileUrl={radarTileUrl}
          currentTimeSec={currentTimeSec}
          totalDurationSec={totalDurationSec}
          isPlaying={false}
          isRenderMode={true}
          forecastDate={forecastDate}
          onSeekTimeFromRender={handleSeekFromRender}
        />
      </div>
    );
  }

  const isRenderingNow =
    renderProgress?.status === 'preparing_audio' ||
    renderProgress?.status === 'syncing_timeline' ||
    renderProgress?.status === 'rendering_map' ||
    renderProgress?.status === 'encoding_video';

  return (
    <div className="wc-studio-app">
      {/* Hidden Master Audio Element for Synchronized Browser Preview */}
      {project?.audio_info?.master_audio_url && (
        <audio
          ref={audioRef}
          src={`${project.audio_info.master_audio_url}?t=${encodeURIComponent(project.updated_at || '')}`}
          preload="auto"
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* TOP STUDIO HEADER */}
      <header className="wc-header">
        <div className="wc-header-left">
          <div className="wc-logo-mark">
            <Globe className="wc-icon-spin-slow" size={22} />
          </div>
          <div>
            <h1 className="wc-studio-title">WEATHERCAST STUDIO</h1>
            <p className="wc-studio-subtitle">
              Hệ thống AI Tạo Video Dự Báo Thời Tiết Việt Nam • Bản đồ 3D MapLibre GL JS & Open-Meteo
            </p>
          </div>
        </div>

        {/* Quick Camera Presets (Regions & Key Cities required by Acceptance Criteria) */}
        <div className="wc-preset-bar">
          <span className="wc-preset-label">
            <Compass size={14} /> Bay nhanh Camera:
          </span>
          {presets.map((pr) => (
            <button
              key={pr.id}
              type="button"
              className="wc-preset-btn"
              onClick={() =>
                handleFlyToPresetOrPlace({
                  id: pr.id,
                  name: pr.name,
                  lat: pr.lat,
                  lon: pr.lon,
                  zoom: pr.zoom,
                  pitch: pr.pitch,
                  bearing: pr.bearing,
                  isPlace: false,
                })
              }
            >
              {pr.name.replace('Khu vực ', '')}
            </button>
          ))}
          <span className="wc-preset-divider">|</span>
          {['ha_noi', 'bac_ninh', 'da_nang', 'tp_hcm'].map((pid) => {
            const p = places.find((item) => item.id === pid);
            if (!p) return null;
            return (
              <button
                key={p.id}
                type="button"
                className="wc-preset-btn wc-preset-city"
                onClick={() =>
                  handleFlyToPresetOrPlace({
                    id: p.id,
                    name: p.name,
                    lat: p.lat,
                    lon: p.lon,
                    zoom: p.zoom,
                    pitch: p.pitch,
                    bearing: p.bearing,
                    isPlace: true,
                  })
                }
              >
                {p.name}
              </button>
            );
          })}
        </div>

        <div className="wc-header-right">
          <a
            href={health?.weather_sources.official_warning_reference.url || 'https://www.nchmf.gov.vn/kttv/'}
            target="_blank"
            rel="noreferrer"
            className="wc-nchmf-link"
            title="Đối chiếu bản tin cảnh báo khí tượng thủy văn chính thức của NCHMF"
          >
            <span>Cảnh báo KTTV Quốc gia (NCHMF)</span>
            <ExternalLink size={13} />
          </a>
          <div
            className={`wc-health-pill ${
              health?.status === 'ok' ? 'wc-health-ok' : 'wc-health-warn'
            }`}
          >
            <CheckCircle2 size={14} />
            <span>
              {health?.status === 'ok' ? 'FFmpeg & API Sẵn sàng' : 'Đang kiểm tra hệ thống'}
            </span>
          </div>
        </div>
      </header>

      {/* NOTIFICATION & ERROR BANNERS */}
      {apiError && (
        <div className="wc-alert-bar wc-alert-error">
          <div className="wc-alert-content">
            <AlertTriangle size={16} />
            <span>
              <strong>Lỗi:</strong> {apiError}
            </span>
          </div>
          <button type="button" onClick={() => setApiError(null)}>
            Đóng
          </button>
        </div>
      )}

      {statusBanner && !apiError && (
        <div className="wc-alert-bar wc-alert-info">
          <div className="wc-alert-content">
            <Sparkles size={16} />
            <span>{statusBanner}</span>
          </div>
          <button type="button" onClick={() => setStatusBanner(null)}>
            Ẩn
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE GRID */}
      <main className="wc-workspace">
        {/* LEFT / CENTER: INTERACTIVE 3D MAPLIBRE STAGE & BOTTOM TIMELINE/SCRIPT */}
        <section className="wc-main-column">
          {/* Map Toolbar */}
          <div className="wc-map-toolbar">
            <div className="wc-toolbar-group">
              <label className="wc-toolbar-item">
                <Layers size={14} />
                <span>Nền bản đồ:</span>
                <select
                  value={mapProviderId}
                  onChange={(e) => setMapProviderId(e.target.value)}
                >
                  {Object.values(health?.map_config.providers || {}).map((prov) => (
                    <option
                      key={prov.id}
                      value={prov.id}
                      disabled={prov.requires_key && !prov.available}
                    >
                      {prov.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="wc-toolbar-item">
                <span>Lớp thời tiết:</span>
                <select
                  value={activeOverlayOverride}
                  onChange={(e) =>
                    setActiveOverlayOverride(e.target.value as WeatherOverlayType | 'auto')
                  }
                >
                  <option value="auto">Tự động theo kịch bản</option>
                  <option value="overview">Tổng quan toàn quốc</option>
                  <option value="temperature">Nhiệt độ (°C)</option>
                  <option value="precipitation">Lượng mưa & Xác suất mưa (mm/%)</option>
                  <option value="radar">Radar mưa thời gian thực (RainViewer)</option>
                  <option value="wind">Tốc độ & Hướng gió (km/h)</option>
                  <option value="uv">Bức xạ tia cực tím (UV)</option>
                </select>
              </label>

              <button
                type="button"
                className={`wc-toggle-chip ${enable3dTerrain ? 'active' : ''}`}
                onClick={() => setEnable3dTerrain(!enable3dTerrain)}
                title="Bật/tắt dữ liệu độ cao địa hình DEM thật (AWS Open Data Terrarium)"
              >
                <Mountain size={14} />
                <span>{enable3dTerrain ? 'Địa hình 3D DEM: BẬT' : 'Địa hình 3D DEM: TẮT'}</span>
              </button>
            </div>

            {/* Live Camera Telemetry Readout */}
            <div className="wc-telemetry-bar">
              <span>Vĩ độ: {cameraTelemetry.center[1].toFixed(3)}°B</span>
              <span>Kinh độ: {cameraTelemetry.center[0].toFixed(3)}°Đ</span>
              <span>Zoom: {cameraTelemetry.zoom.toFixed(2)}</span>
              <span>Pitch: {cameraTelemetry.pitch.toFixed(0)}°</span>
              <span>Bearing: {cameraTelemetry.bearing.toFixed(0)}°</span>
            </div>
          </div>

          {/* Real 3D MapLibre GL JS Stage */}
          <div className="wc-viewport-container">
            <RealMapCanvas
              scenes={scenes}
              forecasts={forecasts}
              places={places}
              adminBoundaries={adminBoundaries}
              highlightedPlaceIdOverride={isPlaying ? null : highlightedPlaceIdOverride}
              subtitleChunks={project?.audio_info?.subtitle_chunks}
              mapProviderId={mapProviderId}
              mapProviders={health?.map_config.providers || {}}
              enable3dTerrain={enable3dTerrain}
              enableSubtitles={enableSubtitles}
              cameraStyle={cameraStyle}
              aspectRatio={aspectRatio}
              activeOverlayOverride={activeOverlayOverride}
              radarTileUrl={radarTileUrl}
              currentTimeSec={currentTimeSec}
              totalDurationSec={totalDurationSec}
              isPlaying={isPlaying}
              isRenderMode={false}
              forecastDate={forecastDate}
              onSelectPlaceFromMap={(pid) => {
                setIsPlaying(false);
                setHighlightedPlaceIdOverride(pid);
              }}
              onCameraTelemetryChange={setCameraTelemetry}
              onMapReady={(m) => {
                mapInstanceRef.current = m;
              }}
            />
          </div>

          {/* Transport & Timeline Playback Bar */}
          <div className="wc-transport-bar">
            <div className="wc-transport-controls">
              <button
                type="button"
                className="wc-btn-icon wc-btn-play"
                onClick={() => {
                  setHighlightedPlaceIdOverride(null);
                  setIsPlaying(!isPlaying);
                }}
                title={isPlaying ? 'Tạm dừng hành trình' : 'Phát hành trình camera'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                <span>{isPlaying ? 'Tạm dừng' : 'Phát Hành Trình'}</span>
              </button>

              <button
                type="button"
                className="wc-btn-icon"
                onClick={() => {
                  setIsPlaying(false);
                  setCurrentTimeSec(0);
                  if (audioRef.current) audioRef.current.currentTime = 0;
                }}
                title="Về đầu bản tin (00:00)"
              >
                <RotateCcw size={16} />
              </button>

              <span className="wc-transport-time">
                {formatTimeMMSS(currentTimeSec)} / {formatTimeMMSS(totalDurationSec)}
              </span>
            </div>

            <input
              type="range"
              className="wc-timeline-scrubber"
              min={0}
              max={Math.max(1, totalDurationSec)}
              step={0.1}
              value={currentTimeSec}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setHighlightedPlaceIdOverride(null);
                setCurrentTimeSec(val);
                if (audioRef.current) {
                  audioRef.current.currentTime = val;
                }
              }}
            />

            <div className="wc-transport-status">
              {project?.audio_info ? (
                <span className="wc-tts-ready-badge">
                  <Volume2 size={14} /> Đã đồng bộ âm thanh TTS ({project.audio_info.total_duration_sec.toFixed(1)}s)
                </span>
              ) : (
                <span className="wc-tts-est-badge">
                  Thời lượng ước tính ({totalDurationSec.toFixed(1)}s) • Nhấn "Tạo TTS & Xem Trước" để khớp giọng đọc
                </span>
              )}
            </div>
          </div>

          {/* BOTTOM STUDIO DECK: TIMELINE / SCRIPT EDITOR / WEATHER DATA / MP4 PLAYER */}
          <div className="wc-bottom-deck">
            <div className="wc-deck-tabs">
              <button
                type="button"
                className={`wc-deck-tab ${activeBottomTab === 'script' ? 'active' : ''}`}
                onClick={() => setActiveBottomTab('script')}
              >
                <FileText size={15} />
                <span>Kịch Bản Lời Dẫn & Chỉnh Sửa ({scenes.length} cảnh)</span>
              </button>
              <button
                type="button"
                className={`wc-deck-tab ${activeBottomTab === 'timeline' ? 'active' : ''}`}
                onClick={() => setActiveBottomTab('timeline')}
              >
                <Compass size={15} />
                <span>Timeline Phân Cảnh & Camera</span>
              </button>
              <button
                type="button"
                className={`wc-deck-tab ${activeBottomTab === 'weather' ? 'active' : ''}`}
                onClick={() => setActiveBottomTab('weather')}
              >
                <Globe size={15} />
                <span>Bảng Số Liệu Thời Tiết Thật ({forecasts.length} trạm)</span>
              </button>
              <button
                type="button"
                className={`wc-deck-tab ${activeBottomTab === 'video' ? 'active' : ''}`}
                onClick={() => setActiveBottomTab('video')}
              >
                <Video size={15} />
                <span>
                  Trình Phát & Tải Video MP4 {project?.output_file ? '✓' : ''}
                </span>
              </button>

              {scriptDirty && (
                <button
                  type="button"
                  className="wc-save-script-btn"
                  onClick={handleSaveEditedScript}
                  disabled={isLoadingWeather}
                >
                  Lưu Kịch Bản Đã Sửa
                </button>
              )}
            </div>

            <div className="wc-deck-body">
              {activeBottomTab === 'script' && (
                <div className="wc-script-list">
                  {scenes.map((sc, idx) => {
                    const isCurrent =
                      currentTimeSec >= sc.start_time && currentTimeSec <= sc.end_time;
                    return (
                      <div
                        key={sc.scene_id}
                        className={`wc-script-row ${isCurrent ? 'wc-script-row-active' : ''}`}
                      >
                        <div className="wc-script-meta">
                          <div className="wc-script-time-badge">
                            {formatTimeMMSS(sc.start_time)} – {formatTimeMMSS(sc.end_time)}
                          </div>
                          <div className="wc-script-scene-title">{sc.title}</div>
                          <div className="wc-script-coords">
                            Tọa độ: {sc.location.lat.toFixed(2)}°B, {sc.location.lon.toFixed(2)}°Đ • Zoom{' '}
                            {sc.camera.zoom}
                          </div>
                          <button
                            type="button"
                            className="wc-mini-jump-btn"
                            onClick={() => {
                              setIsPlaying(false);
                              setHighlightedPlaceIdOverride(null);
                              setCurrentTimeSec(sc.start_time + 0.05);
                            }}
                          >
                            Bay tới cảnh này
                          </button>
                        </div>
                        <div className="wc-script-editor-col">
                          <textarea
                            value={sc.narration}
                            rows={2}
                            onChange={(e) => handleSceneNarrationEdit(idx, e.target.value)}
                            placeholder="Nhập lời dẫn tiếng Việt cho phân cảnh này..."
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeBottomTab === 'timeline' && (
                <div className="wc-timeline-cards">
                  {scenes.map((sc, idx) => {
                    const isCurrent =
                      currentTimeSec >= sc.start_time && currentTimeSec <= sc.end_time;
                    return (
                      <div
                        key={sc.scene_id}
                        className={`wc-timeline-card ${isCurrent ? 'active' : ''}`}
                        onClick={() => {
                          setIsPlaying(false);
                          setHighlightedPlaceIdOverride(null);
                              setCurrentTimeSec(sc.start_time + 0.05);
                        }}
                      >
                        <div className="wc-tl-card-top">
                          <span className="wc-tl-index">Cảnh {idx + 1}</span>
                          <span className="wc-tl-time">
                            {formatTimeMMSS(sc.start_time)} - {formatTimeMMSS(sc.end_time)} (
                            {sc.duration_sec.toFixed(1)}s)
                          </span>
                        </div>
                        <div className="wc-tl-title">{sc.title}</div>
                        <div className="wc-tl-cam-specs">
                          <span>
                            Center: [{sc.camera.center[0].toFixed(2)}, {sc.camera.center[1].toFixed(2)}]
                          </span>
                          <span>
                            Z:{sc.camera.zoom} | P:{sc.camera.pitch}° | B:{sc.camera.bearing}°
                          </span>
                        </div>
                        <div className="wc-tl-overlay-tag">
                          Lớp hiển thị: {sc.weather_overlay.toUpperCase()} • Chuyển cảnh:{' '}
                          {sc.transition}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeBottomTab === 'weather' && (
                <div className="wc-weather-table-wrap">
                  <table className="wc-weather-table">
                    <thead>
                      <tr>
                        <th>Địa phương</th>
                        <th>Đơn vị hành chính (2025)</th>
                        <th>Tọa độ (WGS84)</th>
                        <th>Hiện tại (°C)</th>
                        <th>Cao / Thấp (°C)</th>
                        <th>Mưa (% / mm)</th>
                        <th>Gió (km/h)</th>
                        <th>UV</th>
                        <th>Trạng thái WMO</th>
                        <th>Thời điểm lấy mẫu</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecasts.map((f) => (
                        <tr key={f.place_id}>
                          <td>
                            <strong>{f.place_name}</strong>
                          </td>
                          <td>
                            {places.find((p) => p.id === f.place_id)?.admin_2025_unit ||
                              f.place_name}
                          </td>
                          <td>
                            {f.lat.toFixed(3)}°B, {f.lon.toFixed(3)}°Đ
                          </td>
                          <td>
                            <strong>{f.temperature_c ?? '--'}°C</strong>
                          </td>
                          <td>
                            {f.temp_max_c ?? '--'}° / {f.temp_min_c ?? '--'}°C
                          </td>
                          <td>
                            {f.precipitation_probability_pct ?? 0}% ({f.precipitation_mm ?? 0} mm)
                          </td>
                          <td>
                            {f.wind_speed_kmh ?? '--'} km/h ({f.wind_direction_label})
                          </td>
                          <td>{f.uv_index ?? '--'}</td>
                          <td>{f.weather_description_vi}</td>
                          <td>{f.fetched_at.replace('T', ' ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="wc-weather-charts-grid">
                    {forecasts.map((f) => (
                      <IntradayWeatherChart key={`chart-${f.place_id}`} weather={f} compact={false} />
                    ))}
                  </div>
                </div>
              )}

              {activeBottomTab === 'video' && (
                <div className="wc-video-preview-pane">
                  {project?.output_file ? (
                    <div className="wc-video-ready-grid">
                      <video
                        key={project.output_file}
                        className="wc-rendered-video-player"
                        controls
                        src={`/api/projects/${project.id}/download`}
                      />
                      <div className="wc-video-meta-panel">
                        <h4>Video MP4 Đã Xuất Thành Công</h4>
                        <p>
                          File: <code>{project.output_file}</code>
                        </p>
                        {renderProgress?.video_metadata && (
                          <ul className="wc-video-specs-list">
                            <li>
                              Độ phân giải: {renderProgress.video_metadata.width} ×{' '}
                              {renderProgress.video_metadata.height}
                            </li>
                            <li>
                              Thời lượng: {renderProgress.video_metadata.duration_sec} giây
                            </li>
                            <li>
                              Codec: Video {renderProgress.video_metadata.video_codec?.toUpperCase()}{' '}
                              / Audio {renderProgress.video_metadata.audio_codec?.toUpperCase()}
                            </li>
                            <li>
                              Dung lượng:{' '}
                              {(renderProgress.video_metadata.file_size_bytes / (1024 * 1024)).toFixed(
                                2
                              )}{' '}
                              MB
                            </li>
                          </ul>
                        )}
                        <a
                          className="wc-btn-primary wc-download-link"
                          href={`/api/projects/${project.id}/download`}
                          download={project.output_file}
                        >
                          <Download size={16} />
                          <span>Tải Xuống Video MP4</span>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <div className="wc-video-empty">
                      <Film size={32} />
                      <p>
                        Chưa có file MP4 cho dự án này. Hãy nhấn nút{' '}
                        <strong>"Render Video MP4"</strong> ở cột bên phải để hệ thống ghi lại hành
                        trình bản đồ MapLibre 3D thật và ghép giọng đọc tiếng Việt.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: STUDIO CONFIGURATION & RENDER CONTROLS */}
        <aside className="wc-sidebar">
          <div className="wc-sidebar-scroll">
            <div className="wc-panel-section">
              <h3 className="wc-section-heading">
                <Sliders size={16} />
                <span>1. Phạm Vi & Địa Điểm Dự Báo</span>
              </h3>

              <label className="wc-field-label">
                <span>Tên bản tin dự án</span>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </label>

              <div className="wc-field-row">
                <label className="wc-field-label">
                  <span>Phạm vi bản tin</span>
                  <select
                    value={scope}
                    onChange={(e) =>
                      handleSelectScope(e.target.value as 'nationwide' | 'region' | 'custom_places')
                    }
                  >
                    <option value="nationwide">Toàn quốc (Bắc - Trung - Nam)</option>
                    <option value="region">Theo miền trọng điểm</option>
                    <option value="custom_places">Chọn tỉnh/thành tùy chỉnh</option>
                  </select>
                </label>

                <label className="wc-field-label">
                  <span>Ngày dự báo</span>
                  <input
                    type="date"
                    value={forecastDate}
                    onChange={(e) => setForecastDate(e.target.value)}
                  />
                </label>
              </div>

              {/* Ordered Places Selector for Camera Flight Path */}
              <div className="wc-places-manager">
                <div className="wc-places-header">
                  <span>Thứ tự điểm bay Camera ({selectedPlaceIds.length} địa điểm)</span>
                  <span className="wc-schema-tag">{adminSchemaVersion}</span>
                </div>

                <div className="wc-selected-places-list">
                  {selectedPlaceIds.map((pid, idx) => {
                    const meta = places.find((p) => p.id === pid);
                    return (
                      <div key={pid} className="wc-place-chip-row">
                        <span className="wc-place-order">{idx + 1}.</span>
                        <div
                          className="wc-place-chip-name"
                          onClick={() => {
                            if (meta) {
                              handleFlyToPresetOrPlace({
                                id: meta.id,
                                name: meta.name,
                                lat: meta.lat,
                                lon: meta.lon,
                                zoom: meta.zoom,
                                pitch: meta.pitch,
                                bearing: meta.bearing,
                                isPlace: true,
                              });
                            }
                          }}
                        >
                          <strong>{meta ? meta.name : pid}</strong>
                          {meta && (
                            <small>
                              ({meta.lat.toFixed(2)}°B, {meta.lon.toFixed(2)}°Đ)
                            </small>
                          )}
                        </div>
                        <div className="wc-place-chip-actions">
                          <button
                            type="button"
                            onClick={() => handleMovePlace(idx, -1)}
                            disabled={idx === 0}
                            title="Đưa lên trước"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMovePlace(idx, 1)}
                            disabled={idx === selectedPlaceIds.length - 1}
                            title="Đưa xuống sau"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemovePlace(pid)}
                            title="Xóa địa điểm này"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="wc-add-place-row">
                  <select
                    value={placeToAdd}
                    onChange={(e) => setPlaceToAdd(e.target.value)}
                  >
                    {places.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.region_label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="wc-btn-secondary" onClick={handleAddPlace}>
                    <Plus size={14} /> Thêm
                  </button>
                </div>
              </div>
            </div>

            <div className="wc-panel-section">
              <h3 className="wc-section-heading">
                <Volume2 size={16} />
                <span>2. Lời Dẫn AI & Giọng Đọc Tiếng Việt</span>
              </h3>

              <div className="wc-field-row">
                <label className="wc-field-label">
                  <span>Phong cách lời dẫn</span>
                  <select value={tone} onChange={(e) => setTone(e.target.value as any)}>
                    <option value="broadcast">Truyền hình chuyên nghiệp</option>
                    <option value="concise">Ngắn gọn, súc tích</option>
                    <option value="friendly">Thân thiện, đời thường</option>
                    <option value="detailed">Chi tiết các chỉ số khí tượng</option>
                  </select>
                </label>

                <label className="wc-field-label">
                  <span>Thời lượng mục tiêu</span>
                  <select
                    value={targetDurationSec}
                    onChange={(e) => setTargetDurationSec(Number(e.target.value))}
                  >
                    <option value={25}>Ngắn (~25 giây)</option>
                    <option value={45}>Tiêu chuẩn (~45 giây)</option>
                    <option value={60}>Đầy đủ (~60 giây)</option>
                    <option value={90}>Chuyên sâu (~90 giây)</option>
                  </select>
                </label>
              </div>

              <label className="wc-field-label">
                <span>Giọng đọc biên tập viên (Edge Neural TTS)</span>
                <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
                  {(health?.voices || [
                    { id: 'vi-VN-HoaiMyNeural', name: 'Hoài My (Nữ - Biên tập viên Truyền hình)' },
                    { id: 'vi-VN-NamMinhNeural', name: 'Nam Minh (Nam - Biên tập viên Truyền hình)' },
                  ]).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="wc-field-row">
                <label className="wc-field-label">
                  <span>Tốc độ đọc</span>
                  <select value={voiceRate} onChange={(e) => setVoiceRate(e.target.value)}>
                    <option value="-10%">Chậm rãi (-10%)</option>
                    <option value="-5%">Hơi chậm (-5%)</option>
                    <option value="+0%">Chuẩn truyền hình (+0%)</option>
                    <option value="+5%">Hơi nhanh (+5%)</option>
                    <option value="+10%">Nhanh (+10%)</option>
                    <option value="+15%">Rất nhanh (+15%)</option>
                  </select>
                </label>

                <label className="wc-field-label">
                  <span>Chuyển động Camera</span>
                  <select
                    value={cameraStyle}
                    onChange={(e) => setCameraStyle(e.target.value as any)}
                  >
                    <option value="cinematic_fly">Cinematic Fly (Bay parabol 3D)</option>
                    <option value="broadcast_smooth">Broadcast Smooth (Truyền hình mượt)</option>
                    <option value="dynamic_orbit">Dynamic Orbit (Xoay góc nhìn 3D)</option>
                    <option value="direct_pan">Direct Pan (Di chuyển phẳng)</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="wc-panel-section">
              <h3 className="wc-section-heading">
                <Film size={16} />
                <span>3. Định Dạng Khung Hình & Xuất MP4</span>
              </h3>

              <div className="wc-field-row">
                <label className="wc-field-label">
                  <span>Tỷ lệ khung hình</span>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16' | '1:1')}
                  >
                    <option value="16:9">16:9 (Ngang TV / YouTube)</option>
                    <option value="9:16">9:16 (Dọc Shorts / TikTok / Reels)</option>
                    <option value="1:1">1:1 (Vuông Mạng xã hội)</option>
                  </select>
                </label>

                <label className="wc-field-label">
                  <span>Độ phân giải</span>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as '720p' | '1080p')}
                  >
                    <option value="720p">720p HD (Nhanh, nhẹ)</option>
                    <option value="1080p">1080p Full HD (Sắc nét)</option>
                  </select>
                </label>
              </div>

              <div className="wc-checkbox-group">
                <label className="wc-checkbox-item">
                  <input
                    type="checkbox"
                    checked={enableSubtitles}
                    onChange={(e) => setEnableSubtitles(e.target.checked)}
                  />
                  <span>Hiển thị phụ đề tiếng Việt đồng bộ theo giọng đọc</span>
                </label>

                <label className="wc-checkbox-item">
                  <input
                    type="checkbox"
                    checked={enableBgm}
                    onChange={(e) => setEnableBgm(e.target.checked)}
                  />
                  <span>Ghép nhạc nền ambient bản tin thời tiết</span>
                </label>
              </div>
            </div>

            {/* ACTION BUTTONS */}
            <div className="wc-action-stack">
              <button
                type="button"
                className="wc-btn-action wc-btn-refresh"
                onClick={handleGenerateNewProject}
                disabled={isLoadingWeather || isRenderingNow}
              >
                <RefreshCw className={isLoadingWeather ? 'wc-spin' : ''} size={16} />
                <span>
                  {isLoadingWeather
                    ? 'Đang tải thời tiết & tạo kịch bản...'
                    : '1. Lấy Thời Tiết Mới & Tạo Kịch Bản'}
                </span>
              </button>

              <button
                type="button"
                className="wc-btn-action wc-btn-preview"
                onClick={handlePrepareTTSAndPreview}
                disabled={isPreparingPreview || isRenderingNow || scenes.length === 0}
              >
                <Volume2 className={isPreparingPreview ? 'wc-spin' : ''} size={16} />
                <span>
                  {isPreparingPreview
                    ? 'Đang tổng hợp giọng đọc TTS...'
                    : '2. Tạo Giọng Đọc TTS & Xem Trước Hành Trình'}
                </span>
              </button>

              <button
                type="button"
                className="wc-btn-action wc-btn-render"
                onClick={handleStartRenderMP4}
                disabled={isRenderingNow || scenes.length === 0}
              >
                <Film className={isRenderingNow ? 'wc-spin' : ''} size={17} />
                <span>
                  {isRenderingNow
                    ? `Đang Render MP4 (${renderProgress?.progress_pct ?? 0}%)...`
                    : '3. Render Video MP4 (MapLibre + FFmpeg)'}
                </span>
              </button>
            </div>

            {/* RENDER PROGRESS BOX */}
            {renderProgress && renderProgress.status !== 'idle' && (
              <div className={`wc-render-status-card status-${renderProgress.status}`}>
                <div className="wc-rs-header">
                  <strong>Trạng thái Render MP4</strong>
                  <span>{renderProgress.progress_pct}%</span>
                </div>
                <div className="wc-rs-bar-bg">
                  <div
                    className="wc-rs-bar-fill"
                    style={{ width: `${renderProgress.progress_pct}%` }}
                  />
                </div>
                <p className="wc-rs-step">{renderProgress.current_step}</p>
                {renderProgress.total_frames > 0 && (
                  <p className="wc-rs-frames">
                    Khung hình bản đồ thật: {renderProgress.frames_rendered} /{' '}
                    {renderProgress.total_frames} frames
                  </p>
                )}
                {renderProgress.status === 'completed' && project?.output_file && (
                  <a
                    className="wc-btn-download-now"
                    href={`/api/projects/${project.id}/download`}
                    download={project.output_file}
                  >
                    <Download size={16} />
                    <span>Tải Xuống Video MP4 ({project.output_file})</span>
                  </a>
                )}
              </div>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
};
