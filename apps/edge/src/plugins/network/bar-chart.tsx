import { formatBytes } from "../../shared/format";

export interface Bar {
  label: string;
  /** Short axis label; shown for every few bars. */
  tick: string;
  dl: number;
  ul: number;
}

const W = 720;
const H = 200;
const PAD = { top: 10, right: 8, bottom: 22, left: 52 };

/**
 * Stacked download/upload bars as plain SVG (no chart library, to keep the
 * bundle small — the shop views this over the metered hotspot).
 */
export function BarChart({
  bars,
  reference,
  onSelect,
  selected,
  single = false,
  label = "Usage chart",
}: {
  bars: Bar[];
  /** Optional dashed line, e.g. the even-pace daily allowance or the average day. */
  reference?: { value: number; label: string };
  /** Makes each bar a button (a click, Enter or Space): the bar's index. */
  onSelect?: (index: number) => void;
  /** The bar shown as chosen. */
  selected?: number | null;
  /** One series (`dl` is the value, `ul` unused): no upload part, and plain tooltips. */
  single?: boolean;
  /** What the chart shows, for screen readers. */
  label?: string;
}) {
  const max = Math.max(1, reference?.value ?? 0, ...bars.map((b) => b.dl + b.ul)) * 1.1;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, bars.length);
  const barW = Math.max(2, slot * 0.7);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const tickEvery = Math.ceil(bars.length / 10);

  return (
    // Keeps a readable minimum size on phones; the chart scrolls sideways instead.
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full min-w-[540px] h-auto"
        role={onSelect ? "group" : "img"}
        aria-label={label}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(max * f * 0.909)}
              y2={y(max * f * 0.909)}
              className="stroke-secondary-100"
            />
            <text
              x={PAD.left - 6}
              y={y(max * f * 0.909) + 4}
              textAnchor="end"
              className="fill-secondary-400 text-[11px]"
            >
              {formatBytes(max * f * 0.909)}
            </text>
          </g>
        ))}
        {bars.map((b, i) => {
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const text = single
            ? `${b.label}: ${formatBytes(b.dl)}`
            : `${b.label}: ${formatBytes(b.dl)} down, ${formatBytes(b.ul)} up`;
          const dim = selected !== undefined && selected !== null && selected !== i;
          return (
            <g
              key={b.label}
              className={`${onSelect ? "cursor-pointer outline-none focus-visible:opacity-70" : ""} ${dim ? "opacity-40" : ""}`}
              {...(onSelect
                ? {
                    role: "button",
                    tabIndex: 0,
                    "aria-label": text,
                    "aria-pressed": selected === i,
                    onClick: () => onSelect(i),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(i);
                      }
                    },
                  }
                : {})}
            >
              <title>{text}</title>
              {/* The whole column answers a click, not just the bar (small days are thin). */}
              {onSelect && (
                <rect
                  x={PAD.left + i * slot}
                  width={slot}
                  y={PAD.top}
                  height={plotH}
                  fill="transparent"
                />
              )}
              <rect
                x={x}
                width={barW}
                y={y(b.dl)}
                height={y(0) - y(b.dl)}
                className="fill-primary-500"
              />
              {!single && (
                <rect
                  x={x}
                  width={barW}
                  y={y(b.dl + b.ul)}
                  height={y(b.dl) - y(b.dl + b.ul)}
                  className="fill-primary-200"
                />
              )}
              {i % tickEvery === 0 && (
                <text
                  x={x + barW / 2}
                  y={H - 6}
                  textAnchor="middle"
                  className="fill-secondary-400 text-[11px]"
                >
                  {b.tick}
                </text>
              )}
            </g>
          );
        })}
        {reference && (
          <g>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(reference.value)}
              y2={y(reference.value)}
              strokeDasharray="4 4"
              className="stroke-secondary-500"
            />
            <text
              x={W - PAD.right}
              y={y(reference.value) - 4}
              textAnchor="end"
              className="fill-secondary-500 text-[11px]"
            >
              {reference.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

export function ChartLegend() {
  return (
    <div className="flex gap-4 text-xs text-secondary-500 mt-2">
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm bg-primary-500" /> Download
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm bg-primary-200" /> Upload
      </span>
    </div>
  );
}
