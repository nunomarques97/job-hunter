/**
 * Charts, drawn as inline SVG.
 *
 * Hand-drawn rather than pulled from a charting library, for three reasons: the
 * product needs four chart types, DESIGN.md dictates the exact area-fill and
 * axis treatment a library would fight, and every chart here has to read
 * correctly on the one dark theme the product ships.
 *
 * Every chart states its own units, renders an empty state rather than an empty
 * axis, and never animates on scroll.
 */
import { useId, useState } from 'react';

import { number as formatNumber } from '../lib/format';

/* ---------- Line chart ---------- */

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export function LineChart({
  labels,
  series,
  height = 180,
  valueSuffix = '',
}: {
  labels: string[];
  series: Series[];
  height?: number;
  valueSuffix?: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const width = 720;
  const padLeft = 34;
  const padRight = 26;
  const padTop = 10;
  const padBottom = 22;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const allValues = series.flatMap((item) => item.values);
  const rawMax = Math.max(1, ...allValues);
  // Round the axis up to something a person would choose.
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / step) * step || 1;

  const count = labels.length;
  const x = (index: number) => padLeft + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) => padTop + plotHeight - (value / max) * plotHeight;

  if (!count || !allValues.some((value) => value > 0)) {
    return (
      <div
        className="row"
        style={{ height, justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}
      >
        Nothing recorded in this period yet.
      </div>
    );
  }

  const ticks = [0, max / 2, max];
  const tickLabelEvery = Math.max(1, Math.round(count / 6));

  return (
    <div style={{ width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        role="img"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`${gradientId}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={padLeft - 8}
              y={y(tick) + 3.5}
              textAnchor="end"
              fill="var(--text-muted)"
              fontSize="10"
              fontFamily="var(--font-mono)"
            >
              {Math.round(tick)}
            </text>
          </g>
        ))}

        {series.map((item) => {
          const line = item.values.map((value, index) => `${x(index)},${y(value)}`).join(' L ');
          const area = `M ${x(0)},${y(0)} L ${line} L ${x(count - 1)},${y(0)} Z`;
          return (
            <g key={item.key}>
              <path d={area} fill={`url(#${gradientId}-${item.key})`} />
              <path
                d={`M ${line}`}
                fill="none"
                stroke={item.color}
                strokeWidth="1.8"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}

        {hover !== null && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padTop}
            y2={padTop + plotHeight}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
        )}
        {hover !== null &&
          series.map((item) => (
            <circle
              key={item.key}
              cx={x(hover)}
              cy={y(item.values[hover] ?? 0)}
              r="3.5"
              fill="var(--surface-1)"
              stroke={item.color}
              strokeWidth="2"
            />
          ))}

        {labels.map((label, index) => (
          <rect
            key={label + index}
            x={x(index) - plotWidth / count / 2}
            y={padTop}
            width={plotWidth / count}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}

        {labels.map((label, index) =>
          index % tickLabelEvery === 0 || index === count - 1 ? (
            <text
              key={`x-${label}-${index}`}
              x={x(index)}
              y={height - 6}
              textAnchor="middle"
              fill="var(--text-muted)"
              fontSize="10"
            >
              {label}
            </text>
          ) : null,
        )}
      </svg>

      <div className="row" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        {series.map((item) => (
          <span key={item.key} className="row t-caption secondary" style={{ gap: 6 }}>
            <span
              style={{ width: 8, height: 2, borderRadius: 2, background: item.color, flex: 'none' }}
            />
            {item.label}
            {hover !== null && (
              <span className="mono" style={{ color: 'var(--text-primary)' }}>
                {formatNumber(item.values[hover])}
                {valueSuffix}
              </span>
            )}
          </span>
        ))}
        {hover !== null && <span className="t-caption muted">{labels[hover]}</span>}
      </div>
    </div>
  );
}

/* ---------- Horizontal bar list ---------- */

export function BarList({
  items,
  valueLabel = '',
  max: providedMax,
}: {
  items: { label: string; value: number; color?: string; hint?: string }[];
  valueLabel?: string;
  max?: number;
}) {
  if (!items.length) {
    return (
      <p className="t-small muted" style={{ padding: '12px 0' }}>
        Nothing to show yet.
      </p>
    );
  }
  const max = providedMax ?? Math.max(1, ...items.map((item) => item.value));

  return (
    <div className="col" style={{ gap: 10 }}>
      {items.map((item) => (
        <div key={item.label} className="col" style={{ gap: 5 }}>
          <div className="row" style={{ gap: 8 }}>
            <span className="t-small truncate" style={{ flex: 1 }} title={item.label}>
              {item.label}
            </span>
            {item.hint && <span className="t-caption muted">{item.hint}</span>}
            <span className="mono t-small" style={{ color: 'var(--text-primary)' }}>
              {formatNumber(item.value)}
              {valueLabel}
            </span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                background: item.color ?? 'var(--accent)',
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Funnel ---------- */

export function Funnel({
  steps,
}: {
  steps: { stage: string; count: number; share: number }[];
}) {
  if (!steps.length || steps[0].count === 0) {
    return (
      <p className="t-small muted" style={{ padding: '12px 0' }}>
        The funnel fills in once jobs are discovered and scored.
      </p>
    );
  }

  return (
    <div className="col" style={{ gap: 2 }}>
      {steps.map((step, index) => {
        const previous = index > 0 ? steps[index - 1].count : step.count;
        const conversion = previous > 0 ? (step.count / previous) * 100 : 0;
        return (
          <div key={step.stage} className="col" style={{ gap: 4, paddingBottom: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <span className="t-small" style={{ flex: 1 }}>
                {step.stage}
              </span>
              {index > 0 && (
                <span className="t-caption muted mono">{conversion.toFixed(0)}% of previous</span>
              )}
              <span className="mono t-small" style={{ color: 'var(--text-primary)', minWidth: 44, textAlign: 'right' }}>
                {formatNumber(step.count)}
              </span>
            </div>
            <div
              style={{
                height: 22,
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.max(1.5, step.share)}%`,
                  background: `linear-gradient(90deg, var(--accent) , ${
                    index > 3 ? 'var(--status-success)' : 'var(--status-pipeline)'
                  })`,
                  transition: 'width var(--t-layout) var(--ease-in)',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Donut ---------- */

export function Donut({
  slices,
  size = 132,
  centerLabel,
  centerValue,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const radius = size / 2 - 10;
  const circumference = 2 * Math.PI * radius;

  if (!total) {
    return (
      <div className="row" style={{ height: size, justifyContent: 'center' }}>
        <span className="t-small muted">No data yet.</span>
      </div>
    );
  }

  let offset = 0;

  return (
    <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" style={{ flex: 'none' }}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map((slice) => {
            const share = slice.value / total;
            const dash = share * circumference;
            const element = (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return element;
          })}
        </g>
        {centerValue && (
          <text
            x={size / 2}
            y={size / 2 - 2}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="19"
            fontWeight="640"
            fontFamily="var(--font-mono)"
          >
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text
            x={size / 2}
            y={size / 2 + 14}
            textAnchor="middle"
            fill="var(--text-muted)"
            fontSize="10.5"
          >
            {centerLabel}
          </text>
        )}
      </svg>

      <div className="col" style={{ gap: 7, flex: 1, minWidth: 140 }}>
        {slices.map((slice) => (
          <div key={slice.label} className="row" style={{ gap: 8 }}>
            <span
              style={{ width: 8, height: 8, borderRadius: 2, background: slice.color, flex: 'none' }}
            />
            <span className="t-small truncate" style={{ flex: 1 }}>
              {slice.label}
            </span>
            <span className="mono t-small secondary">{formatNumber(slice.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Sparkline ---------- */

export function Sparkline({
  values,
  color = 'var(--accent)',
  width = 88,
  height = 26,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = height - (value / max) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' L ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`M ${points}`} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
