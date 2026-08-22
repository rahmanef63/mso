"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  ResponsiveContext,
  type DeviceMode,
  type Pane,
  type Responsive,
  type SafeArea,
} from "./use-responsive";

export const MOBILE_W = 768; // phone-width cutoff — THE breakpoint (useIsMobile fallback imports it)
const TABLET_W = 1024; // touch-portrait tablets below this read as mobile

/** Whole-shell surface policy. Phones are mobile only in portrait; landscape is
 * deliberately the desktop surface so a rotated phone gets the denser desktop
 * workspace instead of a stretched phone shell. A forced phone preview follows
 * the same rule — the override selects the portrait persona, not orientation. */
export function shouldUseMobileSurface(device: DeviceMode, vw: number, vh: number, coarse: boolean): boolean {
  const portrait = vh >= vw;
  if (device === "desktop") return false;
  // Keep the explicit Phone preview usable on a wide desktop: it renders inside
  // PhoneFrame. On an actual phone-width landscape viewport, switch to desktop.
  if (device === "phone") return portrait || vw >= TABLET_W;
  if (!portrait) return false;
  return vw < MOBILE_W || (coarse && vw < TABLET_W);
}

function bucket(vw: number): Pane {
  if (vw < 480) return "xs";
  if (vw < MOBILE_W) return "sm";
  if (vw < TABLET_W) return "md";
  return "lg";
}

function readSafeArea(): SafeArea {
  if (typeof window === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  const s = getComputedStyle(document.documentElement);
  const px = (v: string) => parseInt(s.getPropertyValue(v)) || 0;
  return {
    top: px("--sai-top"),
    right: px("--sai-right"),
    bottom: px("--sai-bottom"),
    left: px("--sai-left"),
  };
}

/** Every observable field except `safeArea`, which is a pure function of the
 *  geometry compared here (device inset × orientation) — so an equal result means
 *  the safe area is equal too, and we can skip reading it. Reading it is a
 *  SYNCHRONOUS style recalc (getComputedStyle), and it used to run on every
 *  single resize event. */
export function sameGeometry(a: Responsive | null, b: Responsive): boolean {
  return (
    a !== null &&
    a.isMobile === b.isMobile &&
    a.device === b.device &&
    a.vw === b.vw &&
    a.vh === b.vh &&
    a.pointer === b.pointer &&
    a.orientation === b.orientation &&
    a.breakpoint === b.breakpoint
  );
}

// Deterministic SSR/first-paint default: desktop, so the window manager renders
// until the on-mount measurement corrects it (same no-flash behaviour the old
// inline useIsMobile had — it treated "unknown" as not-mobile).
function initial(device: DeviceMode): Responsive {
  const forced = device === "phone";
  return {
    formFactor: forced ? "mobile" : "desktop",
    isMobile: forced,
    device,
    vw: 1024,
    vh: 768,
    pointer: "fine",
    orientation: "landscape",
    breakpoint: "lg",
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

/**
 * Computes the responsive state once and provides it to the whole shell. Ports
 * the old desktop.tsx `useIsMobile` logic: auto = phone-width OR a coarse-pointer
 * portrait tablet. `device` (from the consumer/appearance) can force phone/desktop.
 */
export function ResponsiveProvider({
  device = "auto",
  children,
}: {
  device?: DeviceMode;
  children: ReactNode;
}) {
  const [state, setState] = useState<Responsive>(() => initial(device));

  useEffect(() => {
    let last: Responsive | null = null;
    let raf = 0;

    const measure = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
      const portrait = vh >= vw;
      const isMobile = shouldUseMobileSurface(device, vw, vh, coarse);
      const next: Responsive = {
        formFactor: isMobile ? "mobile" : "desktop",
        isMobile,
        device,
        vw,
        vh,
        pointer: coarse ? "coarse" : "fine",
        orientation: portrait ? "portrait" : "landscape",
        breakpoint: bucket(vw),
        safeArea: last?.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
      };
      if (sameGeometry(last, next)) return; // same viewport → no new object, no re-render
      next.safeArea = readSafeArea();
      last = next;
      setState(next);
    };

    // This value is consumed at the shell ROOT (Surface), so a new object here
    // re-renders the entire tree. resize fires in bursts — a mobile URL-bar
    // collapse, a soft keyboard, a desktop window drag — so coalesce to one
    // measurement per frame (which is also when layout is settled, rather than
    // mid-gesture with the layout already dirtied) and bail when nothing moved.
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    measure();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [device]);

  return <ResponsiveContext.Provider value={state}>{children}</ResponsiveContext.Provider>;
}
