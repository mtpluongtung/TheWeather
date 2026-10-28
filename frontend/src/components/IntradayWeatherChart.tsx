import React from 'react';
import { HourlyForecastSlot, SevereWeatherSummary, WeatherForecastItem } from '../types/weathercast';

interface IntradayWeatherChartProps {
  weather: WeatherForecastItem;
  sceneProgressRatio?: number; // 0..1 progress within active scene to animate active slot scanner
  chartRevealRatio?: number; // 0..1 progress to animate the reveal of curves & bars per region
  animPhase?: 'enter' | 'settled' | 'exit' | 'hidden';
  compact?: boolean;
}

function getSlotIcon(slot: HourlyForecastSlot): string {
  if (slot.wind_gusts_kmh >= 62 || slot.storm_squall_risk_pct >= 78) return '🌀';
  if (slot.weather_code >= 95 || slot.thunder_lightning_risk_pct >= 60) return '⛈️';
  if (slot.wind_gusts_kmh >= 39 || slot.storm_squall_risk_pct >= 52) return '🌪️';
  if (slot.precipitation_probability_pct >= 55 || slot.weather_code >= 61) return '🌧️';
  if (slot.precipitation_probability_pct >= 25 || slot.weather_code >= 51) return '🌦️';
  if (slot.weather_code >= 2) return '⛅';
  if (slot.hour >= 18 || slot.hour <= 5) return '🌙';
  return '☀️';
}

function getAlertBadgeStyle(level?: SevereWeatherSummary['storm_alert_level']): {
  bg: string;
  border: string;
  text: string;
  label: string;
} {
  switch (level) {
    case 'severe':
      return {
        bg: 'rgba(239, 68, 68, 0.22)',
        border: '#ef4444',
        text: '#fca5a5',
        label: '🌀 CẢNH BÁO BÃO / GIÓ GIẬT MẠNH',
      };
    case 'warning':
      return {
        bg: 'rgba(245, 158, 11, 0.22)',
        border: '#f59e0b',
        text: '#fde68a',
        label: '⚡ CẢNH BÁO DÔNG LỐC & SẤM SÉT',
      };
    case 'watch':
      return {
        bg: 'rgba(14, 165, 233, 0.2)',
        border: '#38bdf8',
        text: '#bae6fd',
        label: '🌧️ THEO DÕI MƯA & GIÓ GIẬT',
      };
    default:
      return {
        bg: 'rgba(16, 185, 129, 0.16)',
        border: '#10b981',
        text: '#6ee7b7',
        label: '✓ KHÔNG CÓ DẤU HIỆU BÃO / LỐC XOÁY',
      };
  }
}

export const IntradayWeatherChart: React.FC<IntradayWeatherChartProps> = ({
  weather,
  sceneProgressRatio = 0,
  chartRevealRatio = 1,
  animPhase = 'settled',
  compact = true,
}) => {
  const slots: HourlyForecastSlot[] =
    weather.hourly_timeline && weather.hourly_timeline.length > 0
      ? weather.hourly_timeline
      : [0, 3, 6, 9, 12, 15, 18, 21].map((h) => {
          const baseTemp = weather.temperature_c ?? 27;
          const tMin = weather.temp_min_c ?? baseTemp - 3;
          const tMax = weather.temp_max_c ?? baseTemp + 3;
          const curve = Math.sin(((h - 5) / 24) * Math.PI * 2);
          const temp = Number(((tMin + tMax) / 2 + ((tMax - tMin) / 2) * curve).toFixed(1));
          const rainProb = weather.precipitation_probability_pct ?? 10;
          const windSpd = weather.wind_speed_kmh ?? 12;
          const windGust = Number((windSpd * 1.35).toFixed(1));
          return {
            time_iso: `${weather.forecast_date}T${String(h).padStart(2, '0')}:00`,
            time_label: `${String(h).padStart(2, '0')}h`,
            hour: h,
            temperature_c: temp,
            precipitation_probability_pct: rainProb,
            precipitation_mm: weather.precipitation_mm ? Number((weather.precipitation_mm / 8).toFixed(1)) : 0,
            wind_speed_kmh: windSpd,
            wind_gusts_kmh: windGust,
            cape_jkg: 120,
            weather_code: weather.weather_code ?? 1,
            weather_label_vi: weather.weather_description_vi,
            storm_squall_risk_pct: Math.min(100, Math.round(windGust * 1.1)),
            thunder_lightning_risk_pct: Math.min(100, Math.round(rainProb * 0.4)),
            hazard_label: '☀️ Ổn định',
          };
        });

  const severe = weather.severe_weather_summary;
  const alertStyle = getAlertBadgeStyle(severe?.storm_alert_level);

  const n = slots.length;
  const activeSlotIdx =
    sceneProgressRatio > 0.02 && sceneProgressRatio < 0.98
      ? Math.min(n - 1, Math.floor(sceneProgressRatio * n))
      : -1;

  // SVG coordinate system
  const svgW = compact ? 340 : 680;
  const svgH = compact ? 118 : 155;
  const padL = 22;
  const padR = 22;
  const padTop = 22;
  const padBot = 24;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padTop - padBot;

  const temps = slots.map((s) => s.temperature_c);
  const minTemp = Math.min(...temps) - 1.5;
  const maxTemp = Math.max(...temps) + 1.5;
  const tempSpan = Math.max(4, maxTemp - minTemp);

  const getX = (idx: number) =>
    n <= 1 ? padL + plotW / 2 : padL + (idx / (n - 1)) * plotW;

  const getTempY = (t: number) =>
    padTop + plotH - ((t - minTemp) / tempSpan) * plotH;

  const getPctY = (pct: number) =>
    padTop + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;

  // Polylines
  const tempPoints = slots.map((s, i) => `${getX(i).toFixed(1)},${getTempY(s.temperature_c).toFixed(1)}`).join(' ');
  const tempAreaPoints = `${getX(0).toFixed(1)},${(padTop + plotH).toFixed(1)} ${tempPoints} ${getX(n - 1).toFixed(1)},${(padTop + plotH).toFixed(1)}`;

  const stormPoints = slots
    .map((s, i) => `${getX(i).toFixed(1)},${getPctY(s.storm_squall_risk_pct).toFixed(1)}`)
    .join(' ');

  const thunderPoints = slots
    .map((s, i) => `${getX(i).toFixed(1)},${getPctY(s.thunder_lightning_risk_pct).toFixed(1)}`)
    .join(' ');

  const barWidth = compact ? 18 : 30;

  return (
    <div
      className={`wc-intraday-chart-card ${compact ? 'wc-chart-compact' : 'wc-chart-expanded'} wc-chart-anim-${animPhase}`}
      style={{
        opacity: Math.min(1, chartRevealRatio * 1.5),
        transform: `scale(${0.96 + 0.04 * Math.min(1, chartRevealRatio)})`,
      }}
    >
      {/* Header */}
      <div className="wc-chart-header">
        <div className="wc-chart-title-wrap">
          <span className="wc-chart-title-dot" />
          <span className="wc-chart-title">
            BIỂU ĐỒ KHUNG GIỜ TRONG NGÀY • {weather.place_name.toUpperCase()}
          </span>
        </div>
        <span
          className="wc-chart-alert-pill"
          style={{
            background: alertStyle.bg,
            borderColor: alertStyle.border,
            color: alertStyle.text,
          }}
        >
          {alertStyle.label}
        </span>
      </div>

      {/* Legend for the 4 requested metrics: Nhiệt độ, Khả năng mưa, Bão/Giông lốc, Sấm sét */}
      <div className="wc-chart-legend">
        <span className="wc-cleg-item">
          <i className="wc-cleg-line" style={{ background: '#fb923c' }} />
          Nhiệt độ (°C)
        </span>
        <span className="wc-cleg-item">
          <i className="wc-cleg-box" style={{ background: 'rgba(56, 189, 248, 0.65)' }} />
          Khả năng mưa (%)
        </span>
        <span className="wc-cleg-item">
          <i className="wc-cleg-line" style={{ background: '#c084fc' }} />
          Bão / Giông lốc (%)
        </span>
        <span className="wc-cleg-item">
          <i className="wc-cleg-line wc-cleg-dashed" style={{ background: '#facc15' }} />
          Sấm sét (%)
        </span>
      </div>

      {/* SVG Multi-Metric Chart */}
      <div className="wc-chart-svg-wrap">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="wc-chart-svg"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="wcTempAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.36" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="wcRainBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.2" />
            </linearGradient>
            <clipPath id={`wcChartRevealClip-${weather.place_id}`}>
              <rect
                x="0"
                y="0"
                width={Math.max(0, svgW * Math.min(1, Math.max(0, chartRevealRatio)))}
                height={svgH}
              />
            </clipPath>
          </defs>

          {/* Horizontal Grid Lines (25%, 50%, 75%, 100%) */}
          {[0, 50, 100].map((pct) => {
            const y = getPctY(pct);
            return (
              <g key={pct}>
                <line
                  x1={padL}
                  y1={y}
                  x2={svgW - padR}
                  y2={y}
                  stroke="rgba(148, 163, 184, 0.16)"
                  strokeDasharray="3 3"
                  strokeWidth="1"
                />
              </g>
            );
          })}

          {/* Active Time-Slot Scanner Column during scene playback */}
          {activeSlotIdx >= 0 && (
            <rect
              x={getX(activeSlotIdx) - barWidth * 0.85}
              y={padTop - 14}
              width={barWidth * 1.7}
              height={plotH + 30}
              rx={5}
              fill="rgba(249, 115, 22, 0.16)"
              stroke="rgba(249, 115, 22, 0.55)"
              strokeWidth="1"
            />
          )}

          {/* 1-4. Animated Multi-Metric Series with Left-to-Right Reveal */}
          <g clipPath={chartRevealRatio < 0.999 ? `url(#wcChartRevealClip-${weather.place_id})` : undefined}>
            {/* 1. Precipitation Probability Bars (%) */}
            {slots.map((s, i) => {
              const x = getX(i);
              const barH = (Math.max(2, s.precipitation_probability_pct) / 100) * plotH;
              const y = padTop + plotH - barH;
              return (
                <g key={`rain-${s.hour}`}>
                  <rect
                    x={x - barWidth / 2}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx={3}
                    fill="url(#wcRainBarGrad)"
                    stroke="rgba(56, 189, 248, 0.45)"
                    strokeWidth="0.8"
                  />
                  {s.precipitation_probability_pct >= 10 && (
                    <text
                      x={x}
                      y={Math.max(padTop + 10, y - 3)}
                      textAnchor="middle"
                      fill="#7dd3fc"
                      fontSize={compact ? '8.5' : '10'}
                      fontWeight="700"
                    >
                      {s.precipitation_probability_pct}%
                    </text>
                  )}
                </g>
              );
            })}

            {/* 2. Storm / Squall Risk Line (Bão / Giông lốc %) */}
            <polyline
              fill="none"
              stroke="#c084fc"
              strokeWidth="1.8"
              points={stormPoints}
            />
            {slots.map((s, i) => (
              <circle
                key={`storm-pt-${s.hour}`}
                cx={getX(i)}
                cy={getPctY(s.storm_squall_risk_pct)}
                r={2.5}
                fill="#c084fc"
              />
            ))}

            {/* 3. Thunder / Lightning Risk Line (Sấm sét %) */}
            <polyline
              fill="none"
              stroke="#facc15"
              strokeWidth="1.6"
              strokeDasharray="4 2"
              points={thunderPoints}
            />
            {slots.map((s, i) => (
              <circle
                key={`thunder-pt-${s.hour}`}
                cx={getX(i)}
                cy={getPctY(s.thunder_lightning_risk_pct)}
                r={2.3}
                fill="#facc15"
              />
            ))}

            {/* 4. Temperature Area & Curve (°C) */}
            <polygon fill="url(#wcTempAreaGrad)" points={tempAreaPoints} />
            <polyline
              fill="none"
              stroke="#fb923c"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              points={tempPoints}
            />

            {/* Temperature Nodes & Labels */}
            {slots.map((s, i) => {
              const cx = getX(i);
              const cy = getTempY(s.temperature_c);
              const isHighlighted = i === activeSlotIdx;
              return (
                <g key={`temp-node-${s.hour}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHighlighted ? 4.5 : 3.2}
                    fill={isHighlighted ? '#ffffff' : '#fb923c'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  <text
                    x={cx}
                    y={cy - 6}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize={compact ? '9.5' : '11'}
                    fontWeight="800"
                    style={{ textShadow: '0 1px 3px rgba(0,0,0,0.9)' }}
                  >
                    {Math.round(s.temperature_c)}°
                  </text>
                </g>
              );
            })}
          </g>

          {/* Bottom Time Labels (00h..21h) */}
          {slots.map((s, i) => (
            <text
              key={`tlabel-${s.hour}`}
              x={getX(i)}
              y={svgH - 6}
              textAnchor="middle"
              fill={i === activeSlotIdx ? '#fb923c' : '#cbd5e1'}
              fontSize={compact ? '9.5' : '11'}
              fontWeight={i === activeSlotIdx ? '800' : '600'}
            >
              {s.time_label}
            </text>
          ))}
        </svg>
      </div>

      {/* Hourly Weather Icons & Wind Gust / Lightning Micro-Row */}
      <div className="wc-chart-slots-strip">
        {slots.map((s, i) => (
          <div
            key={`strip-${s.hour}`}
            className={`wc-chart-slot-cell ${i === activeSlotIdx ? 'active' : ''}`}
            title={`${s.time_label}: ${s.temperature_c}°C, Mưa ${s.precipitation_probability_pct}%, Gió giật ${s.wind_gusts_kmh} km/h, Giông lốc ${s.storm_squall_risk_pct}%, Sấm sét ${s.thunder_lightning_risk_pct}%`}
          >
            <span className="wc-slot-icon">{getSlotIcon(s)}</span>
            <span className="wc-slot-gust">{Math.round(s.wind_gusts_kmh)}km/h</span>
            <span
              className={`wc-slot-thunder ${
                s.thunder_lightning_risk_pct >= 50 || s.storm_squall_risk_pct >= 50
                  ? 'wc-slot-hazard-high'
                  : ''
              }`}
            >
              ⚡{s.thunder_lightning_risk_pct}%
            </span>
          </div>
        ))}
      </div>

      {/* Severe Weather / Storm / Squall / Lightning Summary Footer */}
      <div className="wc-chart-hazard-footer">
        <div className="wc-hazard-metric">
          <span className="wc-hm-label">🌀 Bão / Cấp gió:</span>
          <span className="wc-hm-val">{severe?.beaufort_scale || 'Cấp 2-3 (Gió nhẹ)'}</span>
        </div>
        <div className="wc-hazard-metric">
          <span className="wc-hm-label">🌪️ Giông lốc / Gió giật:</span>
          <span className="wc-hm-val">
            {severe?.max_wind_gust_kmh ?? weather.wind_speed_kmh ?? 12} km/h ({severe?.max_storm_squall_risk_pct ?? 15}%)
          </span>
        </div>
        <div className="wc-hazard-metric">
          <span className="wc-hm-label">⚡ Sấm sét / Đối lưu:</span>
          <span className="wc-hm-val">
            {severe?.max_thunder_lightning_risk_pct ?? 10}% (CAPE {Math.round(severe?.max_cape_jkg ?? 0)} J/kg)
          </span>
        </div>
      </div>
    </div>
  );
};
