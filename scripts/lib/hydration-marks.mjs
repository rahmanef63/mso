// Hydration marks observer: captures client-side hydration milestones and LCP.
// Injected before page scripts (installMarks) and evaluated after load (readMarks).

export function installMarks() {
  localStorage.setItem("sv:shell", JSON.stringify({ desktop: "macos", mobile: "ios" }));
  localStorage.setItem("mso:onboarding:v1", "done");

  window.__marks = {
    fcp: null,
    lcp: null,
    lcpTag: null,
    ttfb: null,
    lastJsDone: null,
    mounted: null,
    icons: null,
    interactive: null,
  };
  window.__perfLcpElement = null;

  try {
    new PerformanceObserver((list) => {
      const last = list.getEntries().pop();
      if (last) {
        window.__marks.lcp = Math.round(last.renderTime || last.loadTime || last.startTime);
        window.__marks.lcpTag = last.element ? last.element.tagName : null;
        window.__perfLcpElement = last.element ?? null;
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}

  const poll = () => {
    const now = Math.round(performance.now());
    // Shell mount means #main-content received its surface data-shell (not SSR skeleton)
    if (window.__marks.mounted == null && document.querySelector("#main-content[data-shell]")) {
      window.__marks.mounted = now;
    }
    // Icons mark first appearance of squircle icons or shell wallpaper artwork
    if (window.__marks.icons == null && document.querySelector(".shell-icon-tile, .shell-artwork")) {
      window.__marks.icons = now;
    }
    // Interactive mark first appearance of dock buttons or primary app icons
    if (
      window.__marks.interactive == null &&
      document.querySelector(
        '[aria-label*="System Monitor"], .macos-dock button, .macos-dock a, [data-slot="ios-dock"] button, [data-dock] button',
      )
    ) {
      window.__marks.interactive = now;
    }
    // First contentful paint
    if (window.__marks.fcp == null) {
      const paint = performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint");
      if (paint) window.__marks.fcp = Math.round(paint.startTime);
    }
    // Time to first byte
    if (window.__marks.ttfb == null) {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.responseStart > 0) window.__marks.ttfb = Math.round(nav.responseStart);
    }
    // Last Next.js chunk response arrival
    const js = performance.getEntriesByType("resource").filter((e) => {
      try {
        return e.name.includes("/_next/") && new URL(e.name, location.href).pathname.endsWith(".js");
      } catch {
        return false;
      }
    });
    if (js.length > 0) {
      let max = 0;
      for (const r of js) if (r.responseEnd > max) max = r.responseEnd;
      if (max > 0) window.__marks.lastJsDone = Math.round(max);
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

export function readMarks() {
  const marks = { ...window.__marks };
  const js = performance.getEntriesByType("resource").filter((e) => {
    try {
      return e.name.includes("/_next/") && new URL(e.name, location.href).pathname.endsWith(".js");
    } catch {
      return false;
    }
  });
  if (js.length > 0) {
    let max = 0;
    for (const r of js) if (r.responseEnd > max) max = r.responseEnd;
    if (max > 0) marks.lastJsDone = Math.round(max);
  }
  const el = window.__perfLcpElement;
  let lcpElement = null;
  if (el) {
    const tag = el.tagName || "";
    const text = el.textContent ? el.textContent.trim().slice(0, 30) : "";
    lcpElement = tag + (text ? ` (${text})` : "");
  }
  return {
    ...marks,
    lcpElement: lcpElement ?? marks.lcpTag ?? null,
    firstLoadJsBytes: js.reduce((sum, r) => sum + (r.decodedBodySize || 0), 0),
    firstLoadJsFiles: js.length,
  };
}
