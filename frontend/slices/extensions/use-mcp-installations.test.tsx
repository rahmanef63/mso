import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMcpInstallations } from "./use-mcp-installations";

afterEach(() => vi.unstubAllGlobals());
describe("MCP installation initial readiness", () => {
  it.each(["@host", "fixture-project", "/tmp/mso-fixture-project"])("keeps %s busy before its first inspection", project => {
    function Probe() {
      const state = useMcpInstallations(project);
      return createElement("output", { "data-busy": String(state.busy), "data-snapshot": state.snapshot ? "ready" : "missing" });
    }
    expect(renderToStaticMarkup(createElement(Probe))).toContain('data-busy="true"');
  });
  it("does not mutate an uninspected target", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    let mutation: ReturnType<typeof useMcpInstallations>["mutate"] | undefined;
    function Probe() { mutation = useMcpInstallations("@host").mutate; return null; }
    renderToStaticMarkup(createElement(Probe));
    expect(mutation).toBeDefined();
    await expect(mutation!("upsert", { server: "si-coder", plugin: "si-coder" })).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
