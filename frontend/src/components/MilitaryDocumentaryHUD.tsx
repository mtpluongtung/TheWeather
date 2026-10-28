import React from 'react';
import { BattleScenario, BattleTimelineStep } from '../types/military';

interface MilitaryDocumentaryHUDProps {
  scenario: BattleScenario;
  currentTime: number;
  currentStep: BattleTimelineStep | null;
  factionsStatus: Record<string, { current_manpower: number; casualties: number }>;
  subtitleText: string;
  showCinematicBars?: boolean;
}

export const MilitaryDocumentaryHUD: React.FC<MilitaryDocumentaryHUDProps> = ({
  scenario,
  currentTime,
  currentStep,
  factionsStatus,
  subtitleText,
  showCinematicBars = false,
}) => {
  const factionA = scenario.factions[0];
  const factionB = scenario.factions[1];

  const statusA = factionA ? factionsStatus[factionA.id] : null;
  const statusB = factionB ? factionsStatus[factionB.id] : null;

  const currentManpowerA = statusA ? statusA.current_manpower : (factionA?.current_manpower || 0);
  const currentManpowerB = statusB ? statusB.current_manpower : (factionB?.current_manpower || 0);

  const casualtiesA = statusA ? statusA.casualties : (factionA?.casualties || 0);
  const casualtiesB = statusB ? statusB.casualties : (factionB?.casualties || 0);

  const totalForce = Math.max(1, currentManpowerA + currentManpowerB);
  const pctA = Math.round((currentManpowerA / totalForce) * 100);
  const pctB = 100 - pctA;

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-4 md:p-6 overflow-hidden z-20">
      {/* Top Bar: Strategic Header & Chronometer */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 w-full">
        {/* Top Left: Campaign Title & Phase */}
        <div className="bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-lg p-3 shadow-2xl max-w-lg pointer-events-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-[11px] font-mono tracking-widest uppercase text-rose-400 font-bold">
              SA BÀN TÁC CHIẾN LỊCH SỬ 3D
            </span>
            <span className="text-slate-500 text-xs">•</span>
            <span className="text-[11px] font-mono text-slate-300">
              {scenario.historical_date_range}
            </span>
          </div>
          <h1 className="text-lg md:text-xl font-black tracking-tight text-white uppercase drop-shadow">
            {scenario.title}
          </h1>
          {currentStep && (
            <div className="text-xs text-amber-300/90 font-medium mt-0.5 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 bg-amber-400 rounded-sm" />
              <span>{currentStep.phase_name}</span>
            </div>
          )}
        </div>

        {/* Top Right: Campaign Chronometer */}
        <div className="bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-lg px-4 py-2.5 shadow-2xl flex flex-col items-end pointer-events-auto">
          <div className="text-[10px] font-mono tracking-wider text-slate-400 uppercase">
            MỐC THỜI GIAN LỊCH SỬ
          </div>
          <div className="text-lg md:text-xl font-mono font-bold text-amber-400 tracking-wider flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-none stroke-current" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{currentStep?.timestamp_label || '00:00:00'}</span>
          </div>
          <div className="text-[11px] font-mono text-slate-400">
            T+ {currentTime.toFixed(1)}s / {scenario.total_duration_sec.toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Middle Top: Force Balance / Order of Battle HUD */}
      {factionA && factionB && (
        <div className="self-center w-full max-w-2xl bg-slate-950/85 backdrop-blur-md border border-slate-700/80 rounded-lg p-3 shadow-2xl pointer-events-auto">
          <div className="flex justify-between items-center text-xs font-mono font-bold mb-1.5">
            {/* Faction A (Việt Minh / Left) */}
            <div className="flex items-center gap-2" style={{ color: factionA.color }}>
              <span className="text-base">{factionA.flag_icon}</span>
              <div className="text-left">
                <div className="font-bold uppercase tracking-tight">{factionA.short_name}</div>
                <div className="text-[10px] text-slate-400 font-normal">
                  Chỉ huy: <span className="text-slate-200">{factionA.commander}</span>
                </div>
              </div>
            </div>

            {/* VS Badge */}
            <div className="px-2 py-0.5 bg-slate-800 rounded text-[10px] text-slate-300 font-bold border border-slate-600">
              TƯƠNG QUAN LỰC LƯỢNG
            </div>

            {/* Faction B (French Army / Right) */}
            <div className="flex items-center gap-2 text-right" style={{ color: factionB.color }}>
              <div className="text-right">
                <div className="font-bold uppercase tracking-tight">{factionB.short_name}</div>
                <div className="text-[10px] text-slate-400 font-normal">
                  Chỉ huy: <span className="text-slate-200">{factionB.commander}</span>
                </div>
              </div>
              <span className="text-base">{factionB.flag_icon}</span>
            </div>
          </div>

          {/* Dynamic Force Balance Split Bar */}
          <div className="w-full h-3.5 bg-slate-900 rounded-full overflow-hidden flex border border-slate-700 p-0.5">
            <div
              className="h-full rounded-l-full transition-all duration-300 relative"
              style={{ width: `${pctA}%`, backgroundColor: factionA.color }}
            />
            <div
              className="h-full rounded-r-full transition-all duration-300 relative"
              style={{ width: `${pctB}%`, backgroundColor: factionB.color }}
            />
          </div>

          {/* Manpower & Casualty Counters */}
          <div className="flex justify-between items-center text-[11px] font-mono mt-1.5 text-slate-300">
            <div>
              Quân số: <span className="font-bold text-white">{currentManpowerA.toLocaleString()}</span>
              {casualtiesA > 0 && (
                <span className="text-rose-400 ml-1">(-{casualtiesA.toLocaleString()})</span>
              )}
            </div>
            <div className="text-slate-500 text-[10px]">
              Tỷ lệ: {pctA}% : {pctB}%
            </div>
            <div>
              {casualtiesB > 0 && (
                <span className="text-rose-400 mr-1">(-{casualtiesB.toLocaleString()})</span>
              )}
              Quân số: <span className="font-bold text-white">{currentManpowerB.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Area: Tactical Objective Banner & 16:9 Subtitle Box */}
      <div className="flex flex-col items-center gap-2.5 w-full">
        {/* Tactical Objective Banner */}
        {currentStep?.tactical_objective && (
          <div className="bg-slate-950/80 backdrop-blur-sm border border-amber-500/40 rounded-full px-4 py-1 text-xs text-amber-200 flex items-center gap-2 shadow-lg max-w-3xl pointer-events-auto">
            <span className="text-amber-400 font-bold uppercase tracking-wider text-[10px]">
              🎯 MỤC TIÊU CHIẾN THUẬT:
            </span>
            <span className="line-clamp-1">{currentStep.tactical_objective}</span>
          </div>
        )}

        {/* 16:9 Cinematic Subtitle Box */}
        {subtitleText && (
          <div className="w-full max-w-4xl bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-xl px-6 py-3.5 shadow-2xl pointer-events-auto text-center">
            <p className="text-sm md:text-base text-slate-100 font-medium leading-relaxed drop-shadow">
              {subtitleText}
            </p>
          </div>
        )}
      </div>

      {/* Cinematic Letterbox Aspect Ratio Borders (if enabled) */}
      {showCinematicBars && (
        <>
          <div className="absolute top-0 left-0 right-0 h-8 bg-black pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-black pointer-events-none" />
        </>
      )}
    </div>
  );
};
