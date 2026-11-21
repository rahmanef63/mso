import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { N8nConnectPanel } from "./n8n-connect-panel";
import N8nApp from "../app";

describe("dedicated n8n surface", () => {
  it("renders a dedicated n8n connection panel with no Workflows, Organization, or Integrations shortcuts", () => {
    const html = renderToStaticMarkup(
      <N8nConnectPanel
        existing={null}
        configurable
        revision="rev-1"
        loadMessage=""
        onSaved={vi.fn(async () => {})}
        onRefresh={vi.fn()}
      />,
    );
    expect(html).toContain("n8n");
    expect(html).toContain("Connect n8n");
    expect(html).toContain("Embed inside MSO");
    expect(html).not.toContain("Native Workflows");
    expect(html).not.toContain("Organization");
    expect(html).not.toContain("Integrations");
    expect(html).not.toContain("\u2014");
  });

  it("prefills existing n8n settings and exposes a close header when editing", () => {
    const html = renderToStaticMarkup(
      <N8nConnectPanel
        existing={{
          id: "n8n",
          title: "n8n",
          description: "n8n",
          origin: "https://n8n.example.test",
          url: "https://n8n.example.test/home/workflows",
          loginUrl: "https://n8n.example.test/signin",
          renderer: "iframe",
          sandbox: "allow-scripts allow-same-origin allow-forms",
        }}
        configurable
        revision="rev-2"
        loadMessage=""
        onSaved={vi.fn(async () => {})}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("https://n8n.example.test/home/workflows");
    expect(html).toContain("/signin");
    expect(html).toContain("Save connection");
    expect(html).toContain("Close n8n settings");
  });

  it("disables edits when the surface registry is managed by deployment configuration", () => {
    const html = renderToStaticMarkup(
      <N8nConnectPanel
        existing={null}
        configurable={false}
        revision="env"
        loadMessage=""
        onSaved={vi.fn(async () => {})}
        onRefresh={vi.fn()}
      />,
    );
    expect(html).toContain("managed by deployment configuration");
    expect(html).toContain("disabled");
  });

  it("starts in a clean loading state without unrelated feature links or a duplicate outer toolbar", () => {
    const html = renderToStaticMarkup(<N8nApp winId="n8n-1" />);
    expect(html).toContain("Loading n8n");
    expect(html).not.toContain("app-frame-toolbar");
    expect(html).not.toContain("Native Workflows");
    expect(html).not.toContain("Organization");
    expect(html).not.toContain("Integrations");
  });
});
