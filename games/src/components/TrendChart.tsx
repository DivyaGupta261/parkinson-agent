import { useEffect, useRef, useState } from "react";

// A small hand-drawn SVG line chart: no chart library, about 100 lines.
// The trick is two "scale" functions that map data values to pixels.

export interface Series {
  key: string;
  label: string;
  /** CSS colour, usually a CSS variable such as var(--series-1). */
  color: string;
  marker: "circle" | "square";
  points: { x: number; y: number; title: string }[];
}

interface Props {
  series: Series[];
  yLabel: string;
  /** Text summary for screen readers; the table below the chart has the detail. */
  description: string;
  formatX: (x: number) => string;
}

const H = 240;
const PAD = { top: 24, right: 16, bottom: 36, left: 44 };

/**
 * Draw in real pixels: the viewBox width follows the container width, so
 * text stays the same size on a phone and on a desktop instead of scaling.
 */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / step) * step;
}

export function TrendChart({ series, yLabel, description, formatX }: Props) {
  const [figRef, W] = useWidth<HTMLElement>(640);
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMax = niceMax(Math.max(...all.map((p) => p.y)));

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  // Scales: data value → pixel. A single point sits in the middle.
  const sx = (x: number) => PAD.left + (xMax === xMin ? plotW / 2 : ((x - xMin) / (xMax - xMin)) * plotW);
  const sy = (y: number) => PAD.top + plotH - (y / yMax) * plotH;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTicks = xMax === xMin ? [xMin] : [xMin, (xMin + xMax) / 2, xMax];

  return (
    <figure className="chart" ref={figRef}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={description}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} />
            <text className="chart-tick" x={PAD.left - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {Number.isInteger(t) ? t : t.toFixed(1)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} className="chart-tick" x={sx(t)} y={H - PAD.bottom + 22} textAnchor={i === 0 && xTicks.length > 1 ? "start" : i === xTicks.length - 1 && xTicks.length > 1 ? "end" : "middle"}>
            {formatX(t)}
          </text>
        ))}
        <text className="chart-tick" x={PAD.left} y={PAD.top - 10}>
          {yLabel}
        </text>
        {series.map((s) => {
          const pts = [...s.points].sort((a, b) => a.x - b.x);
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {pts.length > 1 && <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />}
              {pts.map((p, i) =>
                s.marker === "circle" ? (
                  <circle key={i} className="chart-marker" cx={sx(p.x)} cy={sy(p.y)} r={5} fill={s.color}>
                    <title>{p.title}</title>
                  </circle>
                ) : (
                  <rect key={i} className="chart-marker" x={sx(p.x) - 5} y={sy(p.y) - 5} width={10} height={10} rx={1} fill={s.color}>
                    <title>{p.title}</title>
                  </rect>
                ),
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        {series.map((s) => (
          <span key={s.key} className="legend-item">
            <svg width="16" height="16" aria-hidden="true">
              {s.marker === "circle" ? <circle cx="8" cy="8" r="6" fill={s.color} /> : <rect x="2" y="2" width="12" height="12" rx="1" fill={s.color} />}
            </svg>
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
