// Browser-side measurement primitives shared by perf-probe and perf-app-open.
// Kept out of the CLI files so the "what counts as a measurement" decisions live in one
// place: the same TBT formula, the same shell-ready selector, the same throttle profile.
//
// Two traps this file exists to prevent:
//   `#main-content` exists in the server-rendered skeleton, so it is not "the shell".
//   `data-shell` is set on mount, and its value differs per surface (macos vs ios).

export const SHELL_READY = "#main-content[data-shell]";

// Lighthouse "Slow 4G": 150 ms RTT, 1.6 Mbps down, 750 kbps up. CDP takes bytes/second.
// 200 kbps is Slow 3G — at that rate the ~900 KB shell needs ~37 s to arrive and the
// measurement becomes a network benchmark instead of a shell benchmark.
export const SLOW_4G = { latency: 150, downloadThroughput: 204800, uploadThroughput: 93750 };

// Runs in the page before any document script. Collected here so every entry point
// observes the same entry types with the same buffering.
export function installPerfObservers() {
  localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
  localStorage.setItem("mso:onboarding:v1", "done");

  window.__perfLongTasks = [];
  window.__perfLCP = null;
  window.__perfCLS = 0;
  window.__perfResetLongTasks = () => {
    window.__perfLongTasks = [];
  };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__perfLongTasks.push({ duration: entry.duration, startTime: entry.startTime });
    }).observe({ type: "longtask", buffered: true });
  } catch {}

  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().pop();
      if (last) window.__perfLCP = last.renderTime || last.loadTime || last.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__perfCLS += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
}

// Evaluated in the page. Same definitions the gate reports, so a number taken by hand
// with the devtools console matches the number in the report.
export function readPerfMetrics() {
  const paint = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
  const longTasks = window.__perfLongTasks ?? [];
  const resources = performance.getEntriesByType("resource");
  const js = resources.filter((e) => e.name.includes("/_next/static/") && new URL(e.name).pathname.endsWith(".js"));

  return {
    fcpMs: paint ? Math.round(paint.startTime) : null,
    lcpMs: window.__perfLCP == null ? null : Math.round(window.__perfLCP),
    // TBT clamps each task at 50 ms. Summing raw durations is a different, much larger
    // number and is not TBT — that mistake produced the retracted figures in
    // docs/MSO-MIGRATION.md §1.5.
    tbtMs: Math.round(longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0)),
    cls: Number((window.__perfCLS ?? 0).toFixed(4)),
    longTasks: longTasks.length,
    maxLongTaskMs: Math.round(longTasks.reduce((max, task) => Math.max(max, task.duration), 0)),
    firstLoadJsBytes: js.reduce((sum, r) => sum + r.decodedBodySize, 0),
    firstLoadJsFiles: js.length,
    transferBytes: resources.reduce((sum, r) => sum + (r.encodedBodySize || 0), 0),
    domNodes: document.querySelectorAll("*").length,
  };
}
