import type { TrendDay } from "@canvara/shared";

// Flat SVG trend: navy volume bars + gold net-support line (−1..1).
// Server-rendered, no chart library — brand is flat and authoritative.
const W = 720;
const H = 180;
const PAD = { top: 12, right: 44, bottom: 24, left: 32 };

export function TrendChart({ days }: { days: TrendDay[] }) {
  if (days.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-slate">
        No conversations yet — the trend appears as canvassing begins.
      </p>
    );
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxTotal = Math.max(...days.map((d) => d.total), 1);
  const slot = plotW / days.length;
  const barW = Math.min(28, slot * 0.6);

  const xCenter = (i: number) => PAD.left + slot * i + slot / 2;
  const yVolume = (n: number) => PAD.top + plotH * (1 - n / maxTotal);
  const yNet = (v: number) => PAD.top + plotH * (1 - (v + 1) / 2);

  const netPoints = days
    .map((d, i) => (d.netSupport === null ? null : `${xCenter(i)},${yNet(d.netSupport)}`))
    .filter((p): p is string => p !== null);

  const labelEvery = Math.max(1, Math.ceil(days.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Conversation trend">
      {/* zero line for net support */}
      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={yNet(0)}
        y2={yNet(0)}
        stroke="#D3D1C7"
        strokeDasharray="3 4"
      />
      {/* volume bars */}
      {days.map((d, i) => (
        <rect
          key={d.day}
          x={xCenter(i) - barW / 2}
          y={yVolume(d.total)}
          width={barW}
          height={PAD.top + plotH - yVolume(d.total)}
          fill="#0F2A4A"
          opacity={0.18}
          rx={2}
        >
          <title>{`${d.day}: ${d.total} conversations`}</title>
        </rect>
      ))}
      {/* net support line (gold — the one gold element on this page) */}
      {netPoints.length > 1 && (
        <polyline
          points={netPoints.join(" ")}
          fill="none"
          stroke="#C8973A"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {days.map(
        (d, i) =>
          d.netSupport !== null && (
            <circle key={d.day} cx={xCenter(i)} cy={yNet(d.netSupport)} r={3.5} fill="#C8973A">
              <title>{`${d.day}: net support ${(d.netSupport * 100).toFixed(0)}%`}</title>
            </circle>
          ),
      )}
      {/* x labels */}
      {days.map(
        (d, i) =>
          i % labelEvery === 0 && (
            <text
              key={d.day}
              x={xCenter(i)}
              y={H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="#888780"
            >
              {d.day.slice(5)}
            </text>
          ),
      )}
      {/* y axes hints */}
      <text x={PAD.left - 6} y={yVolume(maxTotal) + 4} textAnchor="end" fontSize={10} fill="#888780">
        {maxTotal}
      </text>
      <text x={PAD.left - 6} y={yVolume(0) + 4} textAnchor="end" fontSize={10} fill="#888780">
        0
      </text>
      <text x={W - PAD.right + 6} y={yNet(1) + 4} fontSize={10} fill="#C8973A">
        +100%
      </text>
      <text x={W - PAD.right + 6} y={yNet(-1) + 4} fontSize={10} fill="#C8973A">
        −100%
      </text>
    </svg>
  );
}
