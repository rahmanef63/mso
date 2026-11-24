<script lang="ts">
  import { sparklinePoints } from "./history";

  let {
    series,
    label,
    value,
    tone = "cpu",
    peak = 100,
  }: {
    series: readonly number[];
    label: string;
    value: string;
    tone?: "cpu" | "mem";
    peak?: number;
  } = $props();

  const WIDTH = 300;
  const HEIGHT = 48;

  let points = $derived(sparklinePoints(series, WIDTH, HEIGHT, peak));
  let area = $derived(`0,${HEIGHT} ${points} ${WIDTH},${HEIGHT}`);
</script>

<figure class="sparkline" data-tone={tone}>
  <figcaption>
    <span class="spark-label">{label}</span>
    <span class="spark-value">{value}</span>
  </figcaption>
  <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" role="img" aria-label="{label}: {value}">
    <polygon {points} data-role="area" />
    <polyline {points} data-role="line" vector-effect="non-scaling-stroke" />
  </svg>
</figure>

<style>
  .sparkline { margin: 0; display: grid; gap: 0.25rem; min-width: 0; }
  figcaption {
    display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem;
    font-size: 0.75rem; color: var(--muted); min-width: 0;
  }
  .spark-label { font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .spark-value { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
  svg { width: 100%; height: 3rem; display: block; }
  polygon[data-role="area"] { fill: var(--accent); opacity: 0.14; stroke: none; }
  polyline[data-role="line"] { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linejoin: round; }
  [data-tone="mem"] polygon[data-role="area"] { fill: var(--ok); }
  [data-tone="mem"] polyline[data-role="line"] { stroke: var(--ok); }
</style>
