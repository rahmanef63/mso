"use client";

// iPhone-style home indicator with gestures. In a standalone PWA the OS bottom
// gesture is suppressed, so the pill owns it:
//   • tap            → app switcher
//   • swipe up quick → home
//   • swipe up + hold→ app switcher
//   • swipe left/rt  → previous / next open app
// Pointer-based (no lib); thresholds tuned for thumbs. touch-action:none so a
// vertical swipe here is never stolen by page scroll.
export function HomeIndicator({
  light = true,
  onHome,
  onSwitcher,
  onSwitchApp,
}: {
  light?: boolean;
  onHome: () => void;
  onSwitcher: () => void;
  onSwitchApp?: (dir: -1 | 1) => void;
}) {
  const onPointerDown = (e: React.PointerEvent) => {
    // Capture the pointer: without it Safari/Chrome can reclaim the touch for
    // scrolling mid-gesture and fire pointercancel — the horizontal swipe then
    // silently no-ops (this is exactly how left/right app switching died on
    // real iPhones; touch-action:none alone wasn't enough).
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const t0 = performance.now();
    let moved = false;
    let lastX = sx;
    let lastY = sy;
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      const dx = lastX - sx;
      const dy = lastY - sy;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) moved = true;
      // Horizontal switch fires AT the threshold, not on release — robust even
      // if the browser cancels the pointer stream right after (and it matches
      // the real-iPhone feel of switching as you swipe).
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        cleanup();
        onSwitchApp?.(dx > 0 ? 1 : -1);
      }
    };
    const up = (ev: PointerEvent) => {
      cleanup();
      // pointercancel can report (0,0) — trust the last move coords instead.
      const ex = ev.type === "pointercancel" ? lastX : ev.clientX;
      const ey = ev.type === "pointercancel" ? lastY : ev.clientY;
      const dx = ex - sx;
      const dy = ey - sy;
      const dt = performance.now() - t0;
      if (!moved) return onSwitcher(); // tap
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) return onSwitchApp?.(dx > 0 ? 1 : -1);
      if (dy < -36) return dt > 320 ? onSwitcher() : onHome(); // up: quick = home, hold = switcher
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      className="flex justify-center pt-[5px] [touch-action:none]"
      style={{ paddingBottom: "calc(7px + var(--sai-bottom))" }}
      onPointerDown={onPointerDown}
    >
      <button
        type="button"
        aria-label="Home: swipe up for home, hold for app switcher"
        // min-h-6: the bar itself is 5px and py-1.5 left the control 17px tall, under
        // the WCAG 2.5.8 24×24 floor. Height only — the 134px bar and px-12 are
        // untouched, so the affordance looks identical.
        className="flex min-h-6 items-center justify-center px-12 py-1.5"
      >
        <span
          className="h-[5px] w-[134px] rounded-full"
          style={{ background: light ? "rgba(255,255,255,.75)" : "rgba(0,0,0,.3)" }}
        />
      </button>
    </div>
  );
}
