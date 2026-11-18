// The cockpit CSP is delivered by proxy.ts, so this pins the two font origins the
// appearance presets need while proving the relaxation stayed data-only.
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

async function cockpitPolicy(): Promise<string> {
  // proxy.ts reads env at module load; a fresh import per test keeps that honest.
  const { proxy } = await import("./proxy");
  const res = await proxy(
    new NextRequest(new URL("https://mso.example.com/apps"), {
      headers: { host: "mso.example.com" },
    }),
  );
  return res.headers.get("content-security-policy") ?? "";
}

const directive = (csp: string, name: string): string =>
  csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? "";

describe("cockpit CSP font origins", () => {
  it("allows the preset stylesheet and font files", async () => {
    // lib/appearance/presets/fonts.ts injects fonts.googleapis.com and the woff2
    // files come from fonts.gstatic.com. Blocking them made every preset except
    // the bundled Geist pair fall back to system fonts, silently.
    const csp = await cockpitPolicy();
    expect(directive(csp, "style-src")).toContain("https://fonts.googleapis.com");
    expect(directive(csp, "font-src")).toContain("https://fonts.gstatic.com");
  });

  it("keeps script execution nonce-gated", async () => {
    const csp = await cockpitPolicy();
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("fonts.googleapis.com");
  });
});
