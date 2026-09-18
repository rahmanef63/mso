import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowEmbedPanel } from "./workflow-embed-panel";
import type { WorkflowEmbed } from "@/lib/contracts/surface-app";
const app: WorkflowEmbed = { id: "editor", title: "Editor", origin: "https://editor.example.test", description: "", renderer: "iframe", sandbox: "allow-scripts", url: "https://editor.example.test/", loginUrl: "https://editor.example.test/login" };
describe("blocked external editor rendering", () => {
  it("never renders an iframe, navigation or login URL for a blocked destination", () => {
    const html = renderToStaticMarkup(<WorkflowEmbedPanel app={{ ...app, blocked: true, reason: "Blocked session cookie scope" }} />);
    expect(html).toContain("Blocked session cookie scope");
    expect(html).not.toContain("<iframe"); expect(html).not.toContain('href='); expect(html).not.toContain(app.origin);
  });
  it("fails closed if a destination is missing even without the blocked flag", () => {
    const html = renderToStaticMarkup(<WorkflowEmbedPanel app={{ ...app, url: undefined }} />);
    expect(html).not.toContain("<iframe"); expect(html).not.toContain('href=');
  });
});
