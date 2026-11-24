/** Rolling sample math for the System Monitor sparklines. Pure so it can be unit tested. */
export const SPAN = 40;

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function pct(used: number, total: number): number {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return 0;
  return clampPct((used / total) * 100);
}

/** Append one clamped sample, dropping the oldest point past `span`. */
export function pushSample(series: readonly number[], value: number, span = SPAN): number[] {
  return [...series, clampPct(value)].slice(-Math.max(1, span));
}

/** Left-pad with zeroes so a young series still spans the full chart width. */
export function padSeries(series: readonly number[], span = SPAN): number[] {
  const tail = series.slice(-span);
  return [...Array(Math.max(0, span - tail.length)).fill(0), ...tail];
}

/** SVG polyline points for a fixed 0..peak scale (defaults to a 0..100 percentage). */
export function sparklinePoints(
  series: readonly number[],
  width = 300,
  height = 48,
  peak = 100,
): string {
  const data = padSeries(series);
  if (data.length < 2) return `0,${height} ${width},${height}`;
  const scale = peak > 0 ? peak : 100;
  return data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - (clampPct(value) / scale) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
