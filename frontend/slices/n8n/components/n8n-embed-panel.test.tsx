import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { N8nEmbedPanel } from "./n8n-embed-panel";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
const app: WorkflowEmbed = { id: "editor", title: "Editor", origin: "https://editor.example.test", description: "", renderer: "iframe", sandbox: "allow-scripts", url: "https://editor.example.test/", loginUrl: "https://editor.example.test/login" };
describe("blocked external editor rendering", () => {
  it("never renders an iframe, navigation or login URL for a blocked destination", () => {
    const html = renderToStaticMarkup(<N8nEmbedPanel app={{ ...app, blocked: true, reason: "Blocked session cookie scope" }} />);
    expect(html).toContain("Blocked session cookie scope");
    expect(html).not.toContain("<iframe"); expect(html).not.toContain('href='); expect(html).not.toContain(app.origin);
  });

  it("remounts the iframe whenever the reviewed sandbox policy changes", () => {
    const source = readFileSync(new URL("./n8n-embed-panel.tsx", import.meta.url), "utf8");
    expect(source).toContain('key={`${revision}:${app.sandbox}`}');
  });
  it("fails closed if a destination is missing even without the blocked flag", () => {
    const html = renderToStaticMarkup(<N8nEmbedPanel app={{ ...app, url: undefined }} />);
    expect(html).not.toContain("<iframe"); expect(html).not.toContain('href=');
  });
});
