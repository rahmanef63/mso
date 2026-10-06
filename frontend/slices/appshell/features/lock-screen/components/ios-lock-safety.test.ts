import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = "frontend/slices/appshell/features/lock-screen/components/";
const source = (name: string) => readFileSync(root + name, "utf8");

describe("iOS lock privacy and cross-shell boundaries", () => {
  it("does not request device location or load external weather", () => {
    for (const file of ["ios-lock-screen.tsx", "ios-lock-complications.tsx", "ios-lock-weather.ts"]) {
      const text = source(file);
      expect(text).not.toMatch(/getCurrentPosition|navigator\.geolocation|loadDeviceWeather|fetch\(/);
      expect(text).not.toMatch(/open-meteo|bigdatacloud/);
    }
    expect(readFileSync("proxy.ts", "utf8")).not.toMatch(/open-meteo|bigdatacloud/);
  });

  it("keeps the existing non-iOS curtain and native keyboard unlock", () => {
    const curtain = source("lock-screen.tsx");
    expect(curtain).toContain('shell.id === "ios" ? <IosLockScreen /> : <LockCurtain />');
    expect(curtain).toContain("text-6xl font-light tracking-tight");
    expect(curtain).toContain('window.addEventListener("keydown", onKey)');
    expect(curtain).not.toContain("ios-lock-camera");
    expect(curtain).not.toContain("ios-lock-time");
  });

  it("provides a focused native unlock button with a 44px target", () => {
    const face = source("ios-lock-screen.tsx");
    expect(face).toContain('aria-label="Unlock"');
    expect(face).toContain("button.current?.focus()");
    expect(face).toContain("min-h-11");
    expect(face).toContain("ios-lock-focus");
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("outline: 2px solid Canvas");
    expect(css).toContain("box-shadow: 0 0 0 4px CanvasText");
    expect(face).not.toContain("ios-lock-camera");
  });
});
