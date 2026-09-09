import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./use-session.tsx", import.meta.url)), "utf8");

describe("session provider revalidation contract", () => {
  it("reconciles immediately even when SSR supplied initial state", () => {
    expect(source).toContain("void probe().then");
    expect(source).not.toContain("initialStatus !== undefined) return");
  });

  it("revalidates browser restores and connectivity recovery", () => {
    expect(source).toContain('window.addEventListener("pageshow", sync)');
    expect(source).toContain('window.addEventListener("online", sync)');
    expect(source).toContain('window.addEventListener("focus", sync)');
    expect(source).toContain('document.addEventListener("visibilitychange", sync)');
  });
});
