import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Film,
  Download,
  Volume2,
  VolumeX,
  Compass,
  Shield,
  Crosshair,
  ListOrdered,
  Layers,
  ChevronRight,
  ChevronLeft,
  X,
  Sparkles,
  Swords,
  Maximize2,
} from 'lucide-react';
import { api } from './services/api';
import {
  BattleScenario,
  BattleTimelineStep,
  MilitaryUnit,
  ScenarioRenderProgress,
} from './types/military';
import { TacticalMilitaryCanvas } from './components/TacticalMilitaryCanvas';
import { MilitaryDocumentaryHUD } from './components/MilitaryDocumentaryHUD';
import {
  evaluateTimelineAtTime,
  InterpolatedTimelineState,
} from './services/militaryTimelineEngine';

function formatMMSS(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const App: React.FC = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const isRenderMode =
    urlParams.get('renderMode') === '1' || urlParams.get('renderMode') === 'military';
  const urlScenarioId = urlParams.get('scenarioId') || 'dien_bien_phu_1954';

  // Scenario list & active scenario
  const [availableScenarios, setAvailableScenarios] = useState<any[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>(urlScenarioId);
  const [scenario, setScenario] = useState<BattleScenario | null>(null);
  const [isLoadingScenario, setIsLoadingScenario] = useState<boolean>(true);
  const [apiError, setApiError] = useState<string | null>(null);

  // Playback & Timeline State
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Studio UI state
  const [viewMode, setViewMode] = useState<'documentary' | 'tactical'>('documentary');
  const [is3DEnabled, setIs3DEnabled] = useState<boolean>(true);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState<boolean>(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState<boolean>(false);
  const [renderModalOpen, setRenderModalOpen] = useState<boolean>(false);

  // Render modal configuration
  const [renderResolution, setRenderResolution] = useState<'720p' | '1080p'>('720p');
  const [renderAspectRatio, setRenderAspectRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [renderFps, setRenderFps] = useState<number>(30);
  const [renderVoiceId, setRenderVoiceId] = useState<string>('vi-VN-NamMinhNeural');
  const [renderProgress, setRenderProgress] = useState<ScenarioRenderProgress | null>(null);
  const [isStartingRender, setIsStartingRender] = useState<boolean>(false);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const timelineStateRef = useRef<InterpolatedTimelineState | null>(null);

  // 1. Fetch available scenarios and load current scenario
  useEffect(() => {
    async function loadScenariosList() {
      try {
        const res = await api.listScenarios();
        setAvailableScenarios(res.scenarios || []);
      } catch (err) {
        console.warn('Could not load scenario list:', err);
      }
    }
    loadScenariosList();
  }, []);

  useEffect(() => {
    async function loadScenarioData(id: string) {
      try {
        setIsLoadingScenario(true);
        setApiError(null);
        const data = await api.getScenario(id);
        setScenario(data);
        setCurrentTimeSec(0);
        setIsPlaying(false);
      } catch (err: any) {
        setApiError(err?.message || `Lỗi nạp kịch bản ${id}`);
      } finally {
        setIsLoadingScenario(false);
      }
    }
    loadScenarioData(selectedScenarioId);
  }, [selectedScenarioId]);

  // Compute interpolated timeline state at currentTimeSec
  const timelineState = scenario
    ? evaluateTimelineAtTime(scenario, currentTimeSec)
    : null;
  timelineStateRef.current = timelineState;

  // 2. Playwright / Puppeteer Bridge for frame-by-frame rendering
  useEffect(() => {
    if (!scenario) return;

    // Expose frame seeking hook
    (window as any).__seekMilitaryHistoryFrame__ = (timeSec: number) => {
      setCurrentTimeSec(timeSec);
      return true;
    };

    // Pre-warm function
    (window as any).__prewarmMilitaryMapTiles__ = () => {
      return true;
    };

    // Mark as ready when scenario loaded
    (window as any).__MILITARY_MAP_READY__ = true;
    // Also support legacy variable name if renderer checks it
    (window as any).__WEATHERCAST_READY__ = true;
    (window as any).__seekWeatherCastFrame__ = (t: number) => {
      setCurrentTimeSec(t);
      return true;
    };
  }, [scenario]);

  // 3. Playback Loop
  useEffect(() => {
    if (!isPlaying || !scenario) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTimeRef.current = null;
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      return;
    }

    const maxDuration = scenario.total_duration_sec || 60.0;

    const tick = (nowMs: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = nowMs;
      }
      const deltaSec = ((nowMs - lastTimeRef.current) / 1000) * playbackSpeed;
      lastTimeRef.current = nowMs;

      setCurrentTimeSec((prev) => {
        const next = prev + deltaSec;
        if (next >= maxDuration) {
          setIsPlaying(false);
          return maxDuration;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, playbackSpeed, scenario]);

  // 4. Poll render progress when modal is open and status is active
  useEffect(() => {
    if (!renderProgress || renderProgress.status === 'completed' || renderProgress.status === 'failed') {
      return;
    }

    const timer = setInterval(async () => {
      try {
        const prog = await api.getScenarioRenderProgress(selectedScenarioId);
        setRenderProgress(prog);
      } catch (err) {
        console.warn('Polling error:', err);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [renderProgress?.status, selectedScenarioId]);

  // Handlers
  const handleTogglePlay = () => {
    if (!scenario) return;
    if (currentTimeSec >= (scenario.total_duration_sec || 60.0)) {
      setCurrentTimeSec(0);
    }
    setIsPlaying((prev) => !prev);
  };

  const handleStepJump = (stepIndex: number) => {
    if (!scenario || !scenario.timeline_steps[stepIndex]) return;
    const step = scenario.timeline_steps[stepIndex];
    setIsPlaying(false);
    setCurrentTimeSec(step.start_time);
  };

  const handleNextStep = () => {
    if (!scenario || !timelineState) return;
    const nextIdx = Math.min(
      scenario.timeline_steps.length - 1,
      timelineState.currentStepIndex + 1
    );
    handleStepJump(nextIdx);
  };

  const handlePrevStep = () => {
    if (!scenario || !timelineState) return;
    const prevIdx = Math.max(0, timelineState.currentStepIndex - 1);
    handleStepJump(prevIdx);
  };

  const handleResetTimeline = () => {
    setIsPlaying(false);
    setCurrentTimeSec(0);
  };

  const handleStartRender = async () => {
    if (!scenario) return;
    try {
      setIsStartingRender(true);
      setApiError(null);
      const res = await api.startScenarioRender(scenario.id, {
        aspect_ratio: renderAspectRatio,
        resolution: renderResolution,
        fps: renderFps,
        voice_id: renderVoiceId,
        enable_bgm: true,
        enable_subtitles: true,
      });
      setRenderProgress(res.progress);
    } catch (err: any) {
      setApiError(err?.message || 'Không thể bắt đầu render video.');
    } finally {
      setIsStartingRender(false);
    }
  };

  // Fullscreen Render Mode for Puppeteer / Playwright
  if (isRenderMode && scenario && timelineState) {
    return (
      <div className="wc-fullscreen-render-root w-screen h-screen overflow-hidden bg-black select-none">
        <div className="w-full h-full relative">
          <TacticalMilitaryCanvas
            scenario={scenario}
            currentTime={currentTimeSec}
            camera={timelineState.camera}
            activeUnitIds={timelineState.activeUnitIds}
            activeCombatEvents={timelineState.activeCombatEvents}
            activeTerritoryIds={timelineState.activeTerritoryIds}
            isInteractive={false}
          />
          <MilitaryDocumentaryHUD
            scenario={scenario}
            currentTime={currentTimeSec}
            currentStep={timelineState.currentStep}
            factionsStatus={timelineState.factionsStatus}
            subtitleText={timelineState.subtitleText}
            showCinematicBars={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-screen h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* 1. TOP STUDIO HEADER */}
      <header className="h-14 border-b border-slate-800 bg-slate-950/95 backdrop-blur px-4 flex items-center justify-between z-30 flex-shrink-0">
        {/* Brand / Logo */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-rose-600/20 border border-rose-500/50 flex items-center justify-center text-rose-500 shadow-lg shadow-rose-950/50">
            <Swords className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-white text-base">ARES</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                TACTICAL 3D
              </span>
            </div>
            <p className="text-[11px] text-slate-400 -mt-0.5">
              Animated Military History Map Studio
            </p>
          </div>
        </div>

        {/* Center: Scenario Selector */}
        <div className="flex items-center gap-2 max-w-md">
          <select
            value={selectedScenarioId}
            onChange={(e) => setSelectedScenarioId(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-lg px-3 py-1.5 font-medium focus:outline-none focus:border-rose-500 max-w-xs truncate"
          >
            {availableScenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.title}
              </option>
            ))}
          </select>

          {/* View Mode Toggle */}
          <div className="flex bg-slate-900 border border-slate-700 rounded-lg p-0.5 text-xs">
            <button
              onClick={() => setViewMode('documentary')}
              className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition-colors ${
                viewMode === 'documentary'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Phim tài liệu</span>
            </button>
            <button
              onClick={() => setViewMode('tactical')}
              className={`px-2.5 py-1 rounded font-medium flex items-center gap-1.5 transition-colors ${
                viewMode === 'tactical'
                  ? 'bg-rose-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Tác chiến</span>
            </button>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Order of Battle Drawer Button */}
          <button
            onClick={() => setLeftDrawerOpen((prev) => !prev)}
            className={`p-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              leftDrawerOpen
                ? 'bg-slate-800 border-slate-600 text-rose-400'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
            title="Biên chế lực lượng & Đơn vị tác chiến"
          >
            <Shield className="w-4 h-4" />
            <span className="hidden md:inline">Biên chế quân sự</span>
          </button>

          {/* Timeline Steps Drawer Button */}
          <button
            onClick={() => setRightDrawerOpen((prev) => !prev)}
            className={`p-2 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors ${
              rightDrawerOpen
                ? 'bg-slate-800 border-slate-600 text-rose-400'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
            }`}
            title="Các bước chiến dịch & Lời bình"
          >
            <ListOrdered className="w-4 h-4" />
            <span className="hidden md:inline">Diễn biến</span>
          </button>

          {/* Export Video MP4 Button */}
          <button
            onClick={() => setRenderModalOpen(true)}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-lg shadow-lg shadow-rose-950/60 flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Download className="w-4 h-4" />
            <span>Xuất Video MP4</span>
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE / 3D MAP VIEWPORT */}
      <div className="relative flex-1 w-full h-full overflow-hidden">
        {isLoadingScenario && (
          <div className="absolute inset-0 z-40 bg-slate-950/90 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-sm text-slate-300 font-mono">
              Đang nạp sa bàn 3D & dữ liệu chiến dịch...
            </div>
          </div>
        )}

        {scenario && timelineState && (
          <>
            <TacticalMilitaryCanvas
              scenario={scenario}
              currentTime={currentTimeSec}
              camera={timelineState.camera}
              activeUnitIds={timelineState.activeUnitIds}
              activeCombatEvents={timelineState.activeCombatEvents}
              activeTerritoryIds={timelineState.activeTerritoryIds}
              isInteractive={true}
            />

            {viewMode === 'documentary' && (
              <MilitaryDocumentaryHUD
                scenario={scenario}
                currentTime={currentTimeSec}
                currentStep={timelineState.currentStep}
                factionsStatus={timelineState.factionsStatus}
                subtitleText={timelineState.subtitleText}
              />
            )}
          </>
        )}

        {/* LEFT DRAWER: ORDER OF BATTLE (BIÊN CHẾ LỰC LƯỢNG) */}
        {leftDrawerOpen && scenario && (
          <div className="absolute top-4 left-4 bottom-4 w-80 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-4 flex flex-col z-30">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-rose-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  Biên chế & Tướng Lĩnh
                </h2>
              </div>
              <button
                onClick={() => setLeftDrawerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Faction Cards */}
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {scenario.factions.map((fac) => (
                <div
                  key={fac.id}
                  className="bg-slate-900/90 rounded-lg p-3 border border-slate-800"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-bold text-xs" style={{ color: fac.color }}>
                      {fac.flag_icon} {fac.name}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-300 mb-2">
                    Chỉ huy: <span className="font-semibold text-white">{fac.commander}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                    <div>Quân số: <span className="text-white font-bold">{fac.initial_manpower.toLocaleString()}</span></div>
                    <div>Pháo binh: <span className="text-white font-bold">{fac.artillery_count}</span></div>
                    <div>Xe tăng: <span className="text-white font-bold">{fac.tanks_count}</span></div>
                    <div>Máy bay: <span className="text-white font-bold">{fac.aircraft_count}</span></div>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <h3 className="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-2">
                  Danh sách đơn vị ({scenario.units.length})
                </h3>
                <div className="space-y-1.5">
                  {scenario.units.map((unit) => {
                    const isActive = timelineState?.activeUnitIds.has(unit.id);
                    return (
                      <div
                        key={unit.id}
                        className={`p-2 rounded border text-xs flex justify-between items-center transition-all ${
                          isActive
                            ? 'bg-rose-950/40 border-rose-500/50 text-white'
                            : 'bg-slate-900/50 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-[11px]">{unit.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            {unit.type.toUpperCase()} • Cấp {unit.echelon}
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px]">
                          <span className="text-emerald-400">{unit.strength_current.toLocaleString()}</span>
                          <span className="text-slate-500"> / {unit.strength_initial.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RIGHT DRAWER: CAMPAIGN STEPS & SCRIPT (DIỄN BIẾN & LỜI BÌNH) */}
        {rightDrawerOpen && scenario && (
          <div className="absolute top-4 right-4 bottom-4 w-96 bg-slate-950/95 backdrop-blur-md border border-slate-800 rounded-xl shadow-2xl p-4 flex flex-col z-30">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800 mb-3">
              <div className="flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-rose-500" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-white">
                  Diễn biến chiến dịch ({scenario.timeline_steps.length} đợt)
                </h2>
              </div>
              <button
                onClick={() => setRightDrawerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {scenario.timeline_steps.map((step, idx) => {
                const isCurrent = timelineState?.currentStepIndex === idx;
                return (
                  <div
                    key={step.step_id}
                    onClick={() => handleStepJump(idx)}
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                      isCurrent
                        ? 'bg-rose-950/40 border-rose-500 text-white shadow-lg shadow-rose-950/40'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-900 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-mono text-amber-400 font-bold">
                        {step.timestamp_label}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {step.duration_sec.toFixed(1)}s
                      </span>
                    </div>
                    <h3 className="font-bold text-xs text-white mb-1">{step.title}</h3>
                    <p className="text-[11px] text-slate-300 line-clamp-3 leading-relaxed">
                      {step.narration_text}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 3. BOTTOM TIMELINE CONTROLLER */}
      {scenario && (
        <footer className="h-16 border-t border-slate-800 bg-slate-950 px-4 md:px-6 flex items-center justify-between z-30 flex-shrink-0">
          {/* Left Controls: Play, Reset, Step Prev/Next */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrevStep}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition"
              title="Giai đoạn trước"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <button
              onClick={handleTogglePlay}
              className="w-10 h-10 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-950/80 transition-all hover:scale-105 active:scale-95"
              title={isPlaying ? 'Tạm dừng (Phím cách)' : 'Bắt đầu phát (Phím cách)'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button
              onClick={handleNextStep}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition"
              title="Giai đoạn kế tiếp"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <button
              onClick={handleResetTimeline}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition ml-1"
              title="Quay lại từ đầu"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <div className="font-mono text-xs text-slate-300 ml-2">
              <span className="font-bold text-white">{formatMMSS(currentTimeSec)}</span>
              <span className="text-slate-500"> / {formatMMSS(scenario.total_duration_sec || 60)}</span>
            </div>
          </div>

          {/* Middle Scrubber Bar */}
          <div className="flex-1 max-w-2xl mx-4 flex flex-col justify-center">
            <div className="relative w-full flex items-center">
              <input
                type="range"
                min={0}
                max={scenario.total_duration_sec || 60}
                step={0.1}
                value={currentTimeSec}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentTimeSec(parseFloat(e.target.value));
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500"
              />
            </div>
            {/* Step Markers along scrubber */}
            <div className="relative w-full h-3 mt-1">
              {scenario.timeline_steps.map((st, i) => {
                const pct = ((st.start_time) / (scenario.total_duration_sec || 60)) * 100;
                return (
                  <div
                    key={st.step_id}
                    onClick={() => handleStepJump(i)}
                    className="absolute top-0 w-1.5 h-1.5 bg-slate-600 hover:bg-amber-400 rounded-full cursor-pointer -translate-x-1/2"
                    style={{ left: `${pct}%` }}
                    title={st.title}
                  />
                );
              })}
            </div>
          </div>

          {/* Right Controls: Speed Selector, Audio Mute */}
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-0.5 text-xs font-mono">
              {[0.5, 1.0, 1.5, 2.0].map((s) => (
                <button
                  key={s}
                  onClick={() => setPlaybackSpeed(s)}
                  className={`px-2 py-0.5 rounded ${
                    playbackSpeed === s
                      ? 'bg-slate-800 text-rose-400 font-bold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <button
              onClick={() => setIsMuted((prev) => !prev)}
              className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition"
              title={isMuted ? 'Bật âm thanh' : 'Tắt âm thanh'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </footer>
      )}

      {/* 4. EXPORT VIDEO MP4 MODAL */}
      {renderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 text-slate-100">
            <div className="flex justify-between items-center pb-4 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-rose-600/20 text-rose-500 flex items-center justify-center">
                  <Film className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">Xuất Video Sa Bàn MP4</h3>
                  <p className="text-xs text-slate-400">Playwright Chromium 3D + FFmpeg render</p>
                </div>
              </div>
              <button
                onClick={() => setRenderModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Render Config Options */}
            {!renderProgress || renderProgress.status === 'idle' ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase text-slate-400 mb-1.5">
                    Tỷ lệ khung hình (Aspect Ratio)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: '16:9', label: '16:9 (Ngang / Youtube / TV)' },
                      { id: '9:16', label: '9:16 (Dọc / Shorts / Reels)' },
                      { id: '1:1', label: '1:1 (Vuông)' },
                    ].map((opt) => (
                      <button
                        key={opt.id}
                        onClick={() => setRenderAspectRatio(opt.id as any)}
                        className={`p-2.5 rounded-lg border text-xs font-medium text-center transition ${
                          renderAspectRatio === opt.id
                            ? 'bg-rose-600/20 border-rose-500 text-rose-300 font-bold'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono uppercase text-slate-400 mb-1.5">
                      Độ phân giải
                    </label>
                    <select
                      value={renderResolution}
                      onChange={(e) => setRenderResolution(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                    >
                      <option value="720p">720p HD (Tốc độ cao)</option>
                      <option value="1080p">1080p Full HD (Chất lượng phát sóng)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase text-slate-400 mb-1.5">
                      Tốc độ khung hình (FPS)
                    </label>
                    <select
                      value={renderFps}
                      onChange={(e) => setRenderFps(parseInt(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                    >
                      <option value={30}>30 FPS (Chuẩn)</option>
                      <option value={60}>60 FPS (Mượt mà nhất)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase text-slate-400 mb-1.5">
                    Giọng đọc thuyết minh (Edge Neural TTS)
                  </label>
                  <select
                    value={renderVoiceId}
                    onChange={(e) => setRenderVoiceId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200"
                  >
                    <option value="vi-VN-NamMinhNeural">Nam Minh (Giọng Nam - Hào hùng, truyền hình)</option>
                    <option value="vi-VN-HoaiMyNeural">Hoài My (Giọng Nữ - Truyền cảm, tin tức)</option>
                  </select>
                </div>

                <div className="pt-3">
                  <button
                    onClick={handleStartRender}
                    disabled={isStartingRender}
                    className="w-full py-3 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold rounded-xl shadow-lg shadow-rose-950/70 flex items-center justify-center gap-2 transition"
                  >
                    {isStartingRender ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Film className="w-4 h-4" />
                    )}
                    <span>Bắt đầu tiến trình Render MP4</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Render In Progress or Completed */
              <div className="space-y-4 py-2">
                <div className="text-center">
                  <div className="text-xs font-mono uppercase text-rose-400 mb-1">
                    {renderProgress.status === 'completed' ? 'XUẤT VIDEO HOÀN TẤT' : 'ĐANG XỬ LÝ'}
                  </div>
                  <h4 className="text-sm font-semibold text-white">
                    {renderProgress.current_step}
                  </h4>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-700 p-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-amber-500 rounded-full transition-all duration-300"
                    style={{ width: `${renderProgress.progress_pct}%` }}
                  />
                </div>

                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span>Tiến độ: {renderProgress.progress_pct.toFixed(1)}%</span>
                  {renderProgress.total_frames > 0 && (
                    <span>
                      Khung hình: {renderProgress.frames_rendered} / {renderProgress.total_frames}
                    </span>
                  )}
                </div>

                {renderProgress.status === 'completed' && renderProgress.output_file && (
                  <div className="pt-2">
                    <a
                      href={`/api/scenarios/${selectedScenarioId}/download`}
                      download
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-950/70 flex items-center justify-center gap-2 transition"
                    >
                      <Download className="w-4 h-4" />
                      <span>Tải xuống Video MP4 ngay</span>
                    </a>
                  </div>
                )}

                {renderProgress.status === 'failed' && (
                  <div className="p-3 bg-rose-950/50 border border-rose-500/50 rounded-lg text-rose-300 text-xs">
                    Lỗi: {renderProgress.error_message || 'Không thể render video.'}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
