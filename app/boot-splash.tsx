"use client";

import { useSyncExternalStore } from "react";
const subscribe = () => () => {};

export function BootSplash() {
  const booting = useSyncExternalStore(subscribe, () => false, () => true);
  if (!booting) return null;
  return (
    <div id="mso-boot-splash" aria-hidden="true" style={{
      position: "fixed", inset: 0, zIndex: 2147483000, display: "grid",
      placeItems: "center", pointerEvents: "none",
      background: "var(--mso-boot-background, linear-gradient(145deg, #d3c5bd 0%, #d9dce7 56%, #b7c8dc 100%))",
    }}>
      <div className="mso-boot-spinner" />
    </div>
  );
}
