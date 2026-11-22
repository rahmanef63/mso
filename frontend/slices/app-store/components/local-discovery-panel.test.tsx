import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LocalDiscoveryPanel } from "./local-discovery-panel";

describe("LocalDiscoveryPanel", () => {
  it("renders initial host scan heading and controls without em dashes", () => {
    const html = renderToStaticMarkup(
      <LocalDiscoveryPanel query="" onConnectDetected={vi.fn()} />,
    );
    expect(html).toContain("Detected on this computer");
    expect(html).toContain("Scan host");
    expect(html).not.toContain("\u2014");
  });
});
