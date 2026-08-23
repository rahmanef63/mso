import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Camoufox noVNC webroot", () => {
  it("serves distro assets through a runtime overlay with the metadata noVNC fetches", () => {
    const script = readFileSync(new URL("../../scripts/camoufox-vnc-service", import.meta.url), "utf8");
    expect(script).toContain('NOVNC_SOURCE="${CAMOUFOX_NOVNC_SOURCE:-/usr/share/novnc}"');
    expect(script).toContain("mso-camoufox-novnc");
    expect(script).toContain('NOVNC_WEBROOT/package.json');
    expect(script).toContain('websockify --web="$NOVNC_WEBROOT"');
    expect(script).not.toContain("websockify --web=/usr/share/novnc");
  });
});
